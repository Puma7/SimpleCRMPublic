/**
 * Eingang und Ausgang eines Workflow-Schritts für die Lauf-Historie
 * (`email_workflow_run_steps.detail_json`, beide Editionen).
 *
 * Ziel: nachvollziehen, warum ein Lauf so lief — ähnlich n8n, aber sparsam:
 * - Eingang: Einstellungen des Knotens (Geheimnisse geschwärzt) und die
 *   Variablen vor dem Schritt; der erste Schritt eines Laufs trägt zusätzlich
 *   die Mail (Kopf + Textauszug, nicht die ganze Mail).
 * - Ausgang: gewählter Ausgang, gesetzte Variablen und ein kurzer Hinweis
 *   (z. B. „Ausgang nicht verbunden“).
 * Jeder Text ist gekürzt und das Ganze auf WORKFLOW_STEP_DETAIL_MAX_CHARS
 * begrenzt. Nach WORKFLOW_STEP_DETAIL_RETENTION_DAYS leeren beide Editionen
 * das Feld wieder (die Schrittzeile selbst bleibt).
 */

export const WORKFLOW_STEP_DETAIL_VERSION = 1;
/** Textauszug der Mail im ersten Schritt eines Laufs. */
export const WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS = 2_000;
/** Ein einzelner Wert (Einstellung, Variable) in der Anzeige. */
export const WORKFLOW_STEP_VALUE_MAX_CHARS = 1_000;
/** Obergrenze des gesamten Detail-JSON je Schritt. */
export const WORKFLOW_STEP_DETAIL_MAX_CHARS = 24_000;
/** Aufbewahrung der Details; danach wird detail_json geleert. */
export const WORKFLOW_STEP_DETAIL_RETENTION_DAYS = 30;

const MAX_ENTRIES = 60;
const MAX_DEPTH = 3;
const REDACTED = '[geschwärzt]';
const SECRET_KEY =
  /(pass(word|wort)?|secret|token|api[-_]?key|authorization|auth[-_]?header|credential|private[-_]?key|cookie|bearer)/i;

export type WorkflowStepDetailValue =
  | string
  | number
  | boolean
  | null
  | WorkflowStepDetailValue[]
  | { [key: string]: WorkflowStepDetailValue };

export type WorkflowStepMailSnapshot = {
  direction?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  attachments?: string;
  /** Anfang des Textes (höchstens WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS Zeichen). */
  excerpt?: string;
  /** Der Text war länger als der Auszug. */
  truncated?: boolean;
};

export type WorkflowStepContinuedFrom = {
  runId: number;
  nodeId?: string;
  port?: string;
};

export type WorkflowStepDetail = {
  v: number;
  /** Erster Schritt einer Fortsetzung: aus welchem Lauf/Knoten/Ausgang sie kommt. */
  continuedFrom?: WorkflowStepContinuedFrom;
  input?: {
    mail?: WorkflowStepMailSnapshot;
    config?: Record<string, WorkflowStepDetailValue>;
    variables?: Record<string, WorkflowStepDetailValue>;
    /** Weitere Eingaben des Knotens (z. B. die aufgelöste Frage der KI-Entscheidung). */
    extra?: Record<string, WorkflowStepDetailValue>;
  };
  output?: {
    port?: string | null;
    variables?: Record<string, WorkflowStepDetailValue>;
    result?: Record<string, WorkflowStepDetailValue>;
    /** Deutscher Hinweis für die Anzeige, z. B. „Ausgang „Nein“ ist nicht verbunden …“. */
    note?: string;
  };
  /** Detail wurde wegen der Größenobergrenze gekürzt. */
  truncated?: boolean;
};

function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Wert für die Anzeige: begrenzt, ohne Funktionen/Symbole, Geheimnisse geschwärzt. */
export function sanitizeWorkflowStepValue(value: unknown, depth = 0): WorkflowStepDetailValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clipText(value, WORKFLOW_STEP_VALUE_MAX_CHARS);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ENTRIES).map((entry) => sanitizeWorkflowStepValue(entry, depth + 1));
    if (value.length > MAX_ENTRIES) items.push(`… ${value.length - MAX_ENTRIES} weitere`);
    return items;
  }
  if (typeof value === 'object') {
    return sanitizeWorkflowStepRecord(value as Record<string, unknown>, depth + 1);
  }
  return null;
}

/**
 * Objekt für die Anzeige: Schlüssel mit Geheimnis-Namen (Passwort, Token,
 * API-Key, Authorization, …) werden geschwärzt, interne Schlüssel (`__…`)
 * weggelassen.
 */
export function sanitizeWorkflowStepRecord(
  record: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, WorkflowStepDetailValue> {
  const out: Record<string, WorkflowStepDetailValue> = {};
  if (!record || typeof record !== 'object') return out;
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('__') || typeof value === 'function' || typeof value === 'symbol') continue;
    if (count >= MAX_ENTRIES) {
      out['…'] = `weitere Einträge ausgelassen`;
      break;
    }
    count += 1;
    if (SECRET_KEY.test(key) && value !== null && value !== undefined && value !== '') {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeWorkflowStepValue(value, depth);
  }
  return out;
}

/** Nur die Variablen, die der Schritt neu gesetzt oder geändert hat. */
export function changedWorkflowVariables(
  before: Record<string, unknown>,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!after) return out;
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) out[key] = value;
  }
  return out;
}

function stringOf(strings: Record<string, unknown>, key: string): string {
  const value = strings[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Kopf und Textauszug der Mail aus den Workflow-Strings (subject, from_address,
 * body_text, …). Gibt null zurück, wenn der Lauf keine Mail hat.
 */
export function buildWorkflowStepMailSnapshot(input: {
  strings: Record<string, unknown> | null | undefined;
  direction?: string | null;
  hasMessage?: boolean;
}): WorkflowStepMailSnapshot | null {
  const strings = input.strings ?? {};
  const subject = stringOf(strings, 'subject');
  const from = stringOf(strings, 'from_address');
  const to = stringOf(strings, 'to_address');
  const body = stringOf(strings, 'body_text') || stringOf(strings, 'snippet') || stringOf(strings, 'combined_text');
  if (input.hasMessage === false && !subject && !from && !body) return null;
  if (!subject && !from && !to && !body) return null;
  const snapshot: WorkflowStepMailSnapshot = {};
  if (input.direction) snapshot.direction = input.direction;
  if (subject) snapshot.subject = clipText(subject, 300);
  if (from) snapshot.from = clipText(from, 300);
  if (to) snapshot.to = clipText(to, 500);
  const cc = stringOf(strings, 'cc_address');
  if (cc) snapshot.cc = clipText(cc, 500);
  const date = stringOf(strings, 'date') || stringOf(strings, 'received_at') || stringOf(strings, 'sent_at');
  if (date) snapshot.date = clipText(date, 60);
  const attachments = stringOf(strings, 'attachment_names');
  if (attachments) snapshot.attachments = clipText(attachments, 500);
  if (body) {
    snapshot.excerpt = body.slice(0, WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS);
    if (body.length > WORKFLOW_STEP_MAIL_EXCERPT_MAX_CHARS) snapshot.truncated = true;
  }
  return snapshot;
}

export type BuildWorkflowStepDetailInput = {
  config?: Record<string, unknown> | null;
  variablesBefore?: Record<string, unknown> | null;
  /** Variablen, die der Schritt zurückgibt (werden auf Änderungen reduziert). */
  variablesOut?: Record<string, unknown> | null;
  port?: string | null;
  mail?: WorkflowStepMailSnapshot | null;
  inputExtra?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  note?: string | null;
  continuedFrom?: WorkflowStepContinuedFrom | null;
};

export function buildWorkflowStepDetail(input: BuildWorkflowStepDetailInput): WorkflowStepDetail {
  const detail: WorkflowStepDetail = { v: WORKFLOW_STEP_DETAIL_VERSION };
  if (input.continuedFrom) detail.continuedFrom = input.continuedFrom;
  const inputPart: NonNullable<WorkflowStepDetail['input']> = {};
  if (input.mail) inputPart.mail = input.mail;
  const config = sanitizeWorkflowStepRecord(input.config ?? {});
  if (Object.keys(config).length > 0) inputPart.config = config;
  const before = input.variablesBefore ?? {};
  const variables = sanitizeWorkflowStepRecord(before);
  if (Object.keys(variables).length > 0) inputPart.variables = variables;
  const extra = sanitizeWorkflowStepRecord(input.inputExtra ?? {});
  if (Object.keys(extra).length > 0) inputPart.extra = extra;
  if (Object.keys(inputPart).length > 0) detail.input = inputPart;

  const outputPart: NonNullable<WorkflowStepDetail['output']> = {};
  if (input.port !== undefined) outputPart.port = input.port;
  const changed = sanitizeWorkflowStepRecord(changedWorkflowVariables(before, input.variablesOut));
  if (Object.keys(changed).length > 0) outputPart.variables = changed;
  const result = sanitizeWorkflowStepRecord(input.result ?? {});
  if (Object.keys(result).length > 0) outputPart.result = result;
  if (input.note) outputPart.note = clipText(input.note, 500);
  if (Object.keys(outputPart).length > 0) detail.output = outputPart;
  return detail;
}

/**
 * Serialisiert das Detail und hält die Größenobergrenze ein: zuerst fallen
 * die Variablen vor dem Schritt weg, dann der Mailauszug, zuletzt bleibt nur
 * der Ausgang.
 */
export function serializeWorkflowStepDetail(detail: WorkflowStepDetail): string {
  let json = JSON.stringify(detail);
  if (json.length <= WORKFLOW_STEP_DETAIL_MAX_CHARS) return json;
  const reduced: WorkflowStepDetail = JSON.parse(json) as WorkflowStepDetail;
  reduced.truncated = true;
  if (reduced.input?.variables) delete reduced.input.variables;
  json = JSON.stringify(reduced);
  if (json.length <= WORKFLOW_STEP_DETAIL_MAX_CHARS) return json;
  if (reduced.input?.mail?.excerpt) {
    reduced.input.mail.excerpt = reduced.input.mail.excerpt.slice(0, 500);
    reduced.input.mail.truncated = true;
  }
  json = JSON.stringify(reduced);
  if (json.length <= WORKFLOW_STEP_DETAIL_MAX_CHARS) return json;
  const minimal: WorkflowStepDetail = {
    v: WORKFLOW_STEP_DETAIL_VERSION,
    truncated: true,
    ...(reduced.continuedFrom ? { continuedFrom: reduced.continuedFrom } : {}),
    ...(reduced.output ? { output: { port: reduced.output.port ?? null, ...(reduced.output.note ? { note: reduced.output.note } : {}) } } : {}),
  };
  return JSON.stringify(minimal);
}

/** Liest ein gespeichertes Detail (String oder bereits geparstes jsonb) tolerant. */
export function parseWorkflowStepDetail(value: unknown): WorkflowStepDetail | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.v !== 'number') return null;
  return record as unknown as WorkflowStepDetail;
}

/** Hinweis für einen gewählten Ausgang ohne Folgeknoten. */
export function workflowUnwiredPortNote(portLabel: string): string {
  return `Ausgang „${portLabel}“ ist mit keinem Knoten verbunden – der Lauf endet hier, es passiert nichts weiter.`;
}

const STEP_PORT_LABELS: Record<string, string> = {
  yes: 'Ja',
  no: 'Nein',
  ja: 'Ja',
  nein: 'Nein',
  unsicher: 'Unsicher',
  default: 'Standard',
  ok: 'OK',
  error: 'Fehler',
  each: 'Je Element',
  done: 'Fertig',
  approved: 'Erlaubt',
  blocked: 'Blockiert',
  block: 'Blockiert',
  hold: 'Prüfen',
};

/** Deutsches Kurzlabel eines Ausgangs für Hinweise (ai.decide: „error“ = „KI-Fehler“). */
export function workflowStepPortLabel(port: string | null | undefined, nodeType?: string | null): string {
  const raw = String(port ?? '').trim();
  if (!raw) return 'Standard';
  if (nodeType === 'ai.decide' && raw === 'error') return 'KI-Fehler';
  return STEP_PORT_LABELS[raw.toLowerCase()] ?? raw;
}

/** Variable, mit der eine Fortsetzung ihren Ursprung (Lauf|Knoten|Ausgang) mitbringt. */
export const WORKFLOW_CONTINUED_FROM_VARIABLE = '__continued_from';

export function encodeWorkflowContinuedFrom(from: WorkflowStepContinuedFrom): string {
  return `${from.runId}|${from.nodeId ?? ''}|${from.port ?? ''}`;
}

export function decodeWorkflowContinuedFrom(value: unknown): WorkflowStepContinuedFrom | null {
  if (typeof value !== 'string') return null;
  const [rawRun, nodeId, port] = value.split('|');
  const runId = Number(rawRun);
  if (!Number.isSafeInteger(runId) || runId <= 0) return null;
  return {
    runId,
    ...(nodeId ? { nodeId: nodeId.slice(0, 200) } : {}),
    ...(port ? { port: port.slice(0, 60) } : {}),
  };
}
