/**
 * Generischer „Weitere Workflows stoppen"-Schalter — für JEDEN Knoten.
 *
 * Fachlicher Hintergrund: Nach einer eingehenden Mail laufen mehrere Workflows
 * nacheinander (Inbound-Priority-Kette). Manche Knoten treffen eine Entscheidung,
 * nach der die Kette enden soll (Absender auf Blocklist, KI-Spam-Score über
 * Schwelle), andere ausdrücklich nicht (Absender auf Whitelist, Weiterleitung).
 * Ob gestoppt wird, weiß nur der Ersteller des Graphen — deshalb ist es ein
 * Feld am Knoten und kein fest verdrahtetes Knotenverhalten.
 *
 * Vertrag:
 * - Opt-in. Fehlendes/false-Feld ⇒ der Graph läuft weiter (Abwärtskompatibilität
 *   für alle gespeicherten Graphen, die dieses Feld nie hatten).
 * - Wirkt nur bei erfolgreichem (`ok`) Knotenergebnis; nicht bei error, nicht
 *   bei blocked (dort gewinnt der Block-Ausgang) und nicht bei deferred
 *   (der Zweig wird später fortgesetzt und darf die Kette nicht vorab kappen).
 * - Spam-Knoten werten das Feld selbst statusabhängig aus (stoppen nur bei
 *   spam/review, nicht bei clean) und sind deshalb ausgenommen.
 */

export const NODE_CHAIN_STOP_CONFIG_KEY = 'stopFurtherWorkflows';

export const NODE_CHAIN_STOP_MESSAGE = 'stop_further_workflows:node';

/** Knoten mit eigener, statusabhängiger Auswertung von `stopFurtherWorkflows`. */
export const SELF_HANDLED_CHAIN_STOP_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'email.mark_spam',
  'email.set_spam_status',
]);

/** Tolerant gegenüber in JSON gespeicherten Strings ("true"/"1"), sonst false. */
export function chainStopFlagEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

export type ChainStopNodeResult = Readonly<{
  status: string;
  stop?: boolean;
  blocked?: boolean;
  deferred?: boolean;
}>;

/** Soll nach diesem Knotenergebnis der Graph enden und die Inbound-Kette stoppen? */
export function nodeRequestsChainStop(input: {
  nodeType: string;
  config: Record<string, unknown>;
  result: ChainStopNodeResult;
}): boolean {
  const { result } = input;
  if (result.status !== 'ok') return false;
  // `stop: true` schließt NICHT aus: logic.stop beendet von sich aus nur den
  // aktuellen Graphen. Der Editor bietet den Schalter auch dort an und
  // verspricht das Ende der nachfolgenden Inbound-Workflows — also muss ein
  // bereits stoppendes Ergebnis zusätzlich inboundChainStop bekommen.
  // Deferred/blocked bleiben ausgeschlossen: der Zweig läuft später weiter
  // bzw. der Block-Ausgang hat Vorrang.
  if (result.blocked === true || result.deferred === true) return false;
  if (SELF_HANDLED_CHAIN_STOP_NODE_TYPES.has(input.nodeType)) return false;
  return chainStopFlagEnabled(input.config[NODE_CHAIN_STOP_CONFIG_KEY]);
}

/**
 * Muss exakt dieselbe Stelle lesen wie die Laufzeit. `nodeConfigOf`
 * (electron/workflow/runtime.ts) verzweigt NICHT ueber den Canvas-Typ, sondern
 * nimmt `data.config`, wenn das ein Objekt (kein Array) ist, und sonst `data`
 * selbst. Eine Verzweigung ueber `node.type === 'registry'` liest bei einem
 * registry-Knoten ohne config-Objekt und bei einem action-Knoten MIT config
 * jeweils an der falschen Stelle — der Graph gilt dann faelschlich als „ohne
 * explizite Konfiguration" und bekaeme trotz bewusstem
 * `stopFurtherWorkflows: false` wieder den harten Legacy-Stopp.
 */
function chainStopConfigOf(data: Record<string, unknown>): unknown {
  const config = data.config;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : data;
}

function configHasChainStopKey(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(config, NODE_CHAIN_STOP_CONFIG_KEY);
}

/**
 * True when a saved graph was authored with the `stopFurtherWorkflows` UI field
 * on at least one node. Desktop inbound priority chains without this key keep
 * the pre-#169 hard stop after spam/review between workflows.
 */
export function workflowGraphHasExplicitChainStopConfig(graph: unknown): boolean {
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
    const node = raw as { type?: string; data?: Record<string, unknown> };
    const data = node.data;
    if (!data || typeof data !== 'object') continue;
    if (configHasChainStopKey(chainStopConfigOf(data))) return true;
  }
  return false;
}
