import type { WorkflowGraphDocument, WorkflowGraphNode } from './email-workflow-graph';

// Mirror of packages/core/src/workflow/graph-validate.ts for the electron /
// renderer transport (which uses the shared graph types, not @simplecrm/core).
// Keep both copies in sync.

function registryType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  return typeof data?.nodeType === 'string' ? data.nodeType : '';
}

/**
 * Laufzeit-Typ eines Knotens — identisch zu nodeRuntimeType in
 * workflow-execution: `data.nodeType` zaehlt AUSSCHLIESSLICH bei den
 * Canvas-Typen `registry` und `action`. Ein als `condition` gespeicherter
 * Knoten mit `data.nodeType = "email.release_outbound"` wird zur Laufzeit nur
 * als Bedingung ausgefuehrt und gibt nie frei; wuerde die Trap-Erkennung ihn
 * als Freigabe (oder als beabsichtigtes Hold-Ende) akzeptieren, liesse sie
 * einen aktiven Ausgangs-Workflow durch, der jede Mail dauerhaft festhaelt.
 */
function runtimeType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  if (node.type === 'registry') {
    return typeof data?.nodeType === 'string' ? data.nodeType : 'registry.unknown';
  }
  if (node.type === 'action') {
    if (typeof data?.nodeType === 'string' && data.nodeType) return data.nodeType;
    if (typeof data?.actionType === 'string' && data.actionType) return data.actionType;
    return 'action';
  }
  return node.type;
}

function nodeConfig(node: WorkflowGraphNode): Record<string, unknown> {
  const data = node.data as Record<string, unknown> | undefined;
  const config = data?.config;
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

function isReleaseNode(node: WorkflowGraphNode): boolean {
  const type = runtimeType(node);
  if (type === 'email.release_outbound') return nodeConfig(node).autoSend === true;
  if (type === 'email.send_draft') {
    const config = nodeConfig(node);
    return (
      typeof config.draftId === 'number' ||
      (typeof config.draftIdVariable === 'string' && config.draftIdVariable.trim() !== '')
    );
  }
  return false;
}

function isHoldNode(node: WorkflowGraphNode): boolean {
  const data = node.data as Record<string, unknown> | undefined;
  return (
    (node.type === 'action' && data?.actionType === 'hold_outbound') ||
    runtimeType(node) === 'email.hold_outbound'
  );
}

function isYesNoBranchNode(node: WorkflowGraphNode): boolean {
  return node.type === 'condition' || registryType(node) === 'logic.threshold';
}

const NAMED_PORT_BRANCH_NODES: Readonly<
  Record<string, { ports: readonly string[]; releasePorts: readonly string[] }>
> = {
  'ai.outbound_review': { ports: ['ok', 'block', 'error'], releasePorts: ['ok'] },
  'ai.review_draft': { ports: ['send', 'hold'], releasePorts: ['send'] },
};

function edgeIsDefaultLabel(edge: { label?: string | null }): boolean {
  const label = (edge.label ?? '').toLowerCase();
  return !label || label === 'default' || label === 'standard' || label === 'fallback';
}

function namedPortBranch(
  node: WorkflowGraphNode,
): { ports: readonly string[]; releasePorts: readonly string[] } | null {
  return NAMED_PORT_BRANCH_NODES[runtimeType(node)] ?? null;
}

function triggerKind(doc: WorkflowGraphDocument): string | null {
  const trigger = doc.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return null;
  const kind = (trigger.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

function nodeTriggerKind(node: WorkflowGraphNode): string {
  const kind = (node.data as Record<string, unknown> | undefined)?.kind;
  return typeof kind === 'string' ? kind : '';
}

function labelIsYes(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'yes' || l === 'ja' || l === 'true' || l === 'success';
}
function labelIsNo(label: string): boolean {
  const l = label.toLowerCase();
  return l === 'no' || l === 'nein' || l === 'false' || l === 'error';
}
function labelIsDefault(label: string): boolean {
  const l = label.toLowerCase();
  return l === '' || l === 'default' || l === 'standard' || l === 'fallback';
}

export type OutboundGraphIssue =
  | { code: 'dangling_condition_port'; nodeId: string; missing: 'yes' | 'no' }
  | { code: 'dead_end'; nodeId: string };

export type FindOutboundGraphTrapsOptions = {
  effectiveTrigger?: string;
};

/**
 * Models the SERVER outbound runtime (hold-then-release). Best-effort: every
 * reachable path that terminates without sending or an explicit hold traps
 * clean mail; exotic multi-port graphs fail SAFE at runtime. The standalone
 * Electron runtime is run-then-block and must NOT enforce this.
 */
export function findOutboundGraphTraps(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): OutboundGraphIssue[] {
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return [];
  const effTrigger = opts?.effectiveTrigger ?? triggerKind(doc);
  if (effTrigger !== 'outbound') return [];
  const triggerNode =
    doc.nodes.find((node) => node.type === 'trigger' && nodeTriggerKind(node) === effTrigger) ??
    doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) return [];

  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const outgoing = (id: string) =>
    doc.edges
      .filter((edge) => edge.source === id)
      .sort((a, b) => a.id.localeCompare(b.id));

  const issues: OutboundGraphIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: OutboundGraphIssue) => {
    const key =
      issue.code === 'dangling_condition_port'
        ? `d:${issue.nodeId}:${issue.missing}`
        : `e:${issue.nodeId}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(issue);
    }
  };

  const walk = (nodeId: string, pathVisited: Set<string>, holdPath = false): void => {
    const node = byId.get(nodeId);
    if (!node) {
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (pathVisited.has(nodeId)) {
      add({ code: 'dead_end', nodeId });
      return;
    }
    if (isReleaseNode(node)) {
      // Release on a hold/block/error path would send mail after a fail verdict.
      if (holdPath) add({ code: 'dead_end', nodeId });
      return;
    }
    if (isHoldNode(node)) return;
    const next = new Set(pathVisited).add(nodeId);
    const outs = outgoing(nodeId);

    if (isYesNoBranchNode(node)) {
      const yesEdge = outs.find((edge) => labelIsYes(edge.label ?? ''));
      const noEdge = outs.find((edge) => labelIsNo(edge.label ?? ''));
      if (yesEdge) walk(yesEdge.target, next, holdPath);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'yes' });
      if (noEdge) walk(noEdge.target, next, holdPath);
      else add({ code: 'dangling_condition_port', nodeId, missing: 'no' });
      return;
    }

    const portBranch = namedPortBranch(node);
    if (portBranch) {
      for (const port of portBranch.ports) {
        const labelled = outs.find((candidate) => (candidate.label ?? '').toLowerCase() === port);
        // Parität zu pickEdge/pickCompileEdge: `ok` fällt auf eine unbeschriftete
        // Default-Kante zurück (Altgraphen vor den benannten Ports). Ohne diesen
        // Fallback meldet der Validator einen lauffähigen Graphen als dead_end
        // und das Speichern scheitert mit 422.
        const edge = labelled ?? (port === 'ok' ? outs.find(edgeIsDefaultLabel) : undefined);
        const isReleasePort = portBranch.releasePorts.includes(port);
        if (edge) {
          walk(edge.target, next, holdPath || !isReleasePort);
        } else if (isReleasePort) {
          add({ code: 'dead_end', nodeId });
        }
      }
      return;
    }

    if (outs.length === 0) {
      if (!holdPath) add({ code: 'dead_end', nodeId });
      return;
    }
    const defaultEdge = outs.find((edge) => labelIsDefault(edge.label ?? ''));
    if (defaultEdge) {
      walk(defaultEdge.target, next, holdPath);
      return;
    }
    // Every outgoing edge is labeled and none is a default/unlabeled edge, so
    // pickEdge(..., 'default') returns undefined: the runtime stops here and the
    // draft is never released — a dead end.
    if (!holdPath) add({ code: 'dead_end', nodeId });
  };

  for (const edge of outgoing(triggerNode.id)) walk(edge.target, new Set([triggerNode.id]));
  if (outgoing(triggerNode.id).length === 0) add({ code: 'dead_end', nodeId: triggerNode.id });

  return issues;
}

export function formatOutboundGraphTraps(issues: OutboundGraphIssue[]): string {
  if (issues.length === 0) return '';
  const parts: string[] = [];

  const dangling = issues.filter(
    (issue): issue is Extract<OutboundGraphIssue, { code: 'dangling_condition_port' }> =>
      issue.code === 'dangling_condition_port',
  );
  if (dangling.length > 0) {
    const detail = dangling
      .map((issue) => `Bedingung „${issue.nodeId}" ohne „${issue.missing === 'no' ? 'nein' : 'ja'}"-Zweig`)
      .join('; ');
    parts.push(
      `Mindestens eine Bedingung hat einen offenen Port, der Mails hängen lässt (${detail}).`,
    );
  }

  const deadEnds = issues.filter(
    (issue): issue is Extract<OutboundGraphIssue, { code: 'dead_end' }> => issue.code === 'dead_end',
  );
  if (deadEnds.length > 0) {
    const ids = deadEnds.map((issue) => `„${issue.nodeId}"`).join(', ');
    parts.push(
      `Mindestens ein Pfad endet ohne Freigabe (${ids}) und lässt die Mail dauerhaft im ` +
        'Posteingang hängen.',
    );
  }

  parts.push(
    'Verbinde jeden offenen/endenden Zweig mit einem Freigabe-Knoten ' +
      '(email.release_outbound mit autoSend=true, oder ein konfiguriertes email.send_draft).',
  );
  return parts.join(' ');
}

export function outboundGraphReleasesMail(
  doc: WorkflowGraphDocument,
  opts?: FindOutboundGraphTrapsOptions,
): boolean {
  return findOutboundGraphTraps(doc, opts).length === 0;
}

// --- Side-effect detection (mirror of packages/core workflowGraphHasSideEffectNode) ---

/** Exportiert fuer den Spiegel-Test gegen packages/core (workflow-side-effect-mirror). */
export const READ_ONLY_WORKFLOW_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'email.auth_check',
  'email.read_tracking_evidence',
  'email.sender_filter',
  'returns.evaluate',
  'jtl.lookup',
  'jtl.prepare_action',
]);

/** Exportiert fuer den Spiegel-Test gegen packages/core (workflow-side-effect-mirror). */
export const LOGIC_INMEMORY_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'logic.stop',
  // Reiner Kontrollknoten (Spam-Kette abbrechen) — wie logic.stop kein
  // Seiteneffekt. Fehlte er hier, haette der Editor Workflows mit diesem
  // Knoten (mehrere Vorlagen nutzen ihn) fuer workflows.edit gesperrt,
  // obwohl der Server sie zulaesst.
  'logic.stop_after_spam',
  'logic.set_variable',
  'logic.merge',
  'logic.threshold',
  'logic.switch',
  'logic.loop',
]);

function sideEffectRuntimeType(node: WorkflowGraphNode): string {
  const data = node.data as Record<string, unknown> | undefined;
  if (node.type === 'registry') {
    return typeof data?.nodeType === 'string' ? data.nodeType : 'registry.unknown';
  }
  if (node.type === 'action') {
    if (typeof data?.nodeType === 'string' && data.nodeType) return data.nodeType;
    if (typeof data?.actionType === 'string' && data.actionType) return data.actionType;
    return 'action';
  }
  return node.type;
}

/**
 * True if the graph has at least one side-effecting node when run live.
 * Keep in sync with packages/core/src/workflow/graph-validate.ts.
 */
export function workflowGraphHasSideEffectNode(graph: unknown): boolean {
  let candidate: unknown = graph;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object') return false;
  const nodes = (candidate as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as WorkflowGraphNode;
    if (node.type === 'trigger' || node.type === 'condition') continue;
    if (node.type !== 'action' && node.type !== 'registry') return true;
    const type = sideEffectRuntimeType(node);
    if (LOGIC_INMEMORY_NODE_TYPES.has(type)) continue;
    if (READ_ONLY_WORKFLOW_NODE_TYPES.has(type)) continue;
    return true;
  }
  return false;
}

/** Spiegel von packages/core/src/workflow/node-chain-stop.ts. */
const NODE_CHAIN_STOP_CONFIG_KEY = 'stopFurtherWorkflows';

function chainStopFlagEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

/**
 * Kann dieser Graph die gesamte Inbound-Priority-Kette abbrechen?
 *
 * Zwei Wege fuehren dorthin (workflow-execution): jeder Knoten mit
 * `stopFurtherWorkflows: true` (nodeRequestsChainStop) und `logic.stop_after_spam`,
 * das bei Spam `inboundChainStop` setzt — wobei `email.is_spam` vorher per
 * `logic.set_variable` frei gesetzt werden kann. Ein solcher Workflow schaltet
 * alle nachrangigen Inbound-Workflows ab (z. B. globale Spam- oder
 * Compliance-Automation), ohne einen einzigen schreibenden Knoten zu enthalten.
 * Die Berechtigungsschicht behandelt ihn deshalb wie einen Seiteneffekt-
 * Workflow — in der Seiteneffekt-Allowlist bleiben die Knoten dagegen bewusst
 * ausgenommen, denn sie schreiben selbst nichts.
 */
export function workflowGraphHasChainStopNode(graph: unknown): boolean {
  let candidate: unknown = graph;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object') return false;
  const nodes = (candidate as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as WorkflowGraphNode;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const config = (data.config ?? {}) as Record<string, unknown>;
    if (chainStopFlagEnabled(config[NODE_CHAIN_STOP_CONFIG_KEY])) return true;
    if (chainStopFlagEnabled(data[NODE_CHAIN_STOP_CONFIG_KEY])) return true;
    if (sideEffectRuntimeType(node) === 'logic.stop_after_spam') return true;
  }
  return false;
}

/**
 * Platzhalter, deren Inhalt aus der eingegangenen Mail stammt — und damit von
 * dem, der sie geschickt hat. Der Server fuellt sie in stringsFromMessage.
 */
const MAIL_DERIVED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'text',
  'combined_text',
  'subject',
  'body_text',
  'snippet',
  'from_address',
  'to_address',
  'cc_address',
  'attachment_names',
  'attachment_types',
]);

/**
 * Felder, bei denen ein absendergesteuerter Wert das ZIEL verschiebt, statt nur
 * den Inhalt zu faerben. In einem Textbaustein ist fremder Text unschoen; in
 * einem Empfaengerfeld entscheidet er, wer die Kopie bekommt.
 */
const RISKY_TARGET_FIELD_KEYS: ReadonlySet<string> = new Set(['to', 'cc', 'bcc', 'url']);

export type WorkflowConfigRisk =
  | { code: 'mail_derived_target'; nodeId: string; nodeType: string; field: string; placeholder: string }
  | { code: 'auto_send_without_review'; nodeId: string; nodeType: string };

function placeholdersIn(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1] ?? '');
}

/**
 * Konfigurationen, bei denen der Absender einer Mail mitbestimmt, wohin etwas
 * geht oder was ungeprueft rausgeht.
 *
 * Das ist KEIN Fehler und darf nichts blockieren: einen Platzhalter im
 * Empfaengerfeld kann man bewusst wollen, und {{from_address}} als Rueckantwort
 * an den Absender ist ein voellig normaler Bauplan. Es ist eine Warnung, weil
 * derselbe Bauplan mit einem anderen Knoten davor eine vollstaendige Kopie
 * samt Anhaengen an eine vom Angreifer gewaehlte Adresse schickt — und weil man
 * das dem Feld beim Ausfuellen nicht ansieht.
 *
 * Ebenso autoSend: der Freigabeknoten existiert, aber ob er im Graphen steht,
 * entscheidet der Autor. Bei einer KI-Antwort auf fremden Text ist "ohne
 * Freigabe versenden" die Stelle, an der Prompt Injection nach draussen wirkt.
 */
export function findWorkflowConfigRisks(doc: WorkflowGraphDocument): WorkflowConfigRisk[] {
  if (!doc || !Array.isArray(doc.nodes)) return [];
  const risks: WorkflowConfigRisk[] = [];
  for (const node of doc.nodes) {
    // Laufzeit-Typ und config liegen unter node.data — dieselben Helfer, die
    // auch die Trap-Erkennung oben benutzt. Direkt an node.config zu greifen
    // faende schlicht nie etwas.
    const nodeType = runtimeType(node);
    const config = nodeConfig(node);
    for (const [key, value] of Object.entries(config)) {
      if (!RISKY_TARGET_FIELD_KEYS.has(key) || typeof value !== 'string') continue;
      for (const placeholder of placeholdersIn(value)) {
        if (!MAIL_DERIVED_PLACEHOLDERS.has(placeholder)) continue;
        risks.push({ code: 'mail_derived_target', nodeId: node.id, nodeType, field: key, placeholder });
      }
    }
  }

  // Versand ohne Freigabe wird nur gemeldet, wenn der Graph ueberhaupt einen
  // KI-Knoten enthaelt. Sonst waere es eine Warnung an jeder gewoehnlichen
  // Automatisierung — und eine Warnung, die immer erscheint, liest niemand
  // mehr. Der Anlass ist die Verbindung: KI formuliert aus fremdem Text, und
  // das Ergebnis geht ohne menschlichen Blick hinaus.
  const hasAiNode = doc.nodes.some((node) => runtimeType(node).startsWith('ai.'));
  if (hasAiNode) {
    for (const node of doc.nodes) {
      const nodeType = runtimeType(node);
      const config = nodeConfig(node);
      const autoSends =
        (nodeType === 'email.release_outbound' && config.autoSend === true) ||
        (nodeType === 'email.send_draft' && config.runOutboundReview !== true);
      if (autoSends) {
        risks.push({ code: 'auto_send_without_review', nodeId: node.id, nodeType });
      }
    }
  }
  return risks;
}

export function formatWorkflowConfigRisks(risks: readonly WorkflowConfigRisk[]): string {
  return risks.map((risk) => (
    risk.code === 'mail_derived_target'
      ? `„${risk.field}" in ${risk.nodeType} enthält {{${risk.placeholder}}} — dieser Wert kommt aus der eingegangenen Mail, der Absender bestimmt das Ziel also mit.`
      : `${risk.nodeType} versendet ohne Freigabe (autoSend). Bei Inhalten aus fremden Mails empfiehlt sich ein Freigabeschritt davor.`
  )).join(' ');
}
