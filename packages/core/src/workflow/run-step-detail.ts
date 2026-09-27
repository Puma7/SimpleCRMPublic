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
/**
 * Obergrenze aller Details eines Laufs (Summe über die Schritte). Große
 * Schleifen (bis 10.000 Schritte) schreiben danach nur noch den Ausgang.
 */
export const WORKFLOW_RUN_DETAIL_BUDGET_CHARS = 250_000;

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
    /** Schlüssel in `extra`, deren Vorlage CRM-/Integrationsdaten einsetzt (Schwärzung je Betrachter). */
    protectedExtra?: string[];
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

const SECRET_QUERY_PARAM = /^(key|sig|signature|code|auth|hash|hmac|access_token|refresh_token|client_secret)$/i;
/** Pfadteil, der wie ein eingebettetes Token aussieht (Slack/Discord/n8n-Webhooks, UUIDs). */
const TOKEN_PATH_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const MASK = '***';

/**
 * Geheimnisse im Wert einer URL: Zugangsdaten (user:pass@), Query-Parameter
 * mit Geheimnis-Namen (token, api_key, sig, …), token-artige Pfadteile
 * (Webhook-Links) und das Fragment werden ersetzt. Andere Texte bleiben.
 */
export function maskWorkflowUrlSecrets(value: string): string {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || text.length > 4096) return value;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return value;
  }
  let changed = false;
  const credentials = url.username || url.password ? `${MASK}@` : '';
  if (credentials) changed = true;
  const path = url.pathname
    .split('/')
    .map((segment) => {
      if (!TOKEN_PATH_SEGMENT.test(segment)) return segment;
      changed = true;
      return MASK;
    })
    .join('/');
  const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : '';
  const query = rawQuery
    ? `?${rawQuery
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return pair;
        const name = pair.slice(0, eq);
        let decoded = name;
        try {
          decoded = decodeURIComponent(name);
        } catch {
          // Unlesbarer Name: vorsichtshalber schwärzen.
          changed = true;
          return `${name}=${MASK}`;
        }
        if (!SECRET_KEY.test(decoded) && !SECRET_QUERY_PARAM.test(decoded)) return pair;
        changed = true;
        return `${name}=${MASK}`;
      })
      .join('&')}`
    : '';
  const fragment = url.hash ? `#${MASK}` : '';
  if (fragment) changed = true;
  // Ohne Geheimnis bleibt der Text genau so, wie er eingetragen wurde.
  if (!changed) return value;
  return `${url.protocol}//${credentials}${url.host}${path}${query}${fragment}`;
}

/** Wert für die Anzeige: begrenzt, ohne Funktionen/Symbole, Geheimnisse geschwärzt. */
export function sanitizeWorkflowStepValue(value: unknown, depth = 0): WorkflowStepDetailValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clipText(maskWorkflowUrlSecrets(value), WORKFLOW_STEP_VALUE_MAX_CHARS);
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
  /** false: Lauf ohne Nachricht (CRM, Aufgabe, Termin, Zeitplan) — nie ein Mail-Schnappschuss. */
  hasMessage?: boolean;
}): WorkflowStepMailSnapshot | null {
  const strings = input.strings ?? {};
  const subject = stringOf(strings, 'subject');
  const from = stringOf(strings, 'from_address');
  const to = stringOf(strings, 'to_address');
  const body = stringOf(strings, 'body_text') || stringOf(strings, 'snippet') || stringOf(strings, 'combined_text');
  // CRM-, Aufgaben-, Kalender- und Zeitplan-Läufe füllen subject/body_text
  // mit Ereignisdaten: ohne Nachricht ist das keine E-Mail.
  if (input.hasMessage === false) return null;
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
  /** Schlüssel von inputExtra, deren Vorlage CRM-/Integrationsdaten einsetzt. */
  protectedExtra?: readonly string[] | null;
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
  if (Object.keys(extra).length > 0) {
    inputPart.extra = extra;
    const protectedExtra = (input.protectedExtra ?? []).filter((key) => key in extra);
    if (protectedExtra.length > 0) inputPart.protectedExtra = protectedExtra;
  }
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

/** Zustand der Detail-Aufzeichnung eines Laufs, geteilt über alle Zweige. */
export type WorkflowRunDetailState = {
  /** Die Mail steht nur im ersten Schritt eines Laufs. */
  mailRecorded: boolean;
  /** Bisher geschriebene Zeichen (WORKFLOW_RUN_DETAIL_BUDGET_CHARS). */
  charsUsed: number;
};

export function createWorkflowRunDetailState(): WorkflowRunDetailState {
  return { mailRecorded: false, charsUsed: 0 };
}

export const WORKFLOW_RUN_DETAIL_BUDGET_NOTE =
  'Details gekürzt: Der Lauf hat sein Speicherbudget für Eingang/Ausgang aufgebraucht (z. B. große Schleife).';

/**
 * Wie serializeWorkflowStepDetail, aber innerhalb des Laufbudgets: ist es
 * aufgebraucht, bleibt nur der gewählte Ausgang samt Hinweis.
 */
export function serializeWorkflowStepDetailWithinBudget(
  detail: WorkflowStepDetail,
  state: WorkflowRunDetailState | null | undefined,
): string {
  const json = serializeWorkflowStepDetail(detail);
  if (!state) return json;
  if (state.charsUsed + json.length <= WORKFLOW_RUN_DETAIL_BUDGET_CHARS) {
    state.charsUsed += json.length;
    return json;
  }
  const minimal = JSON.stringify({
    v: WORKFLOW_STEP_DETAIL_VERSION,
    truncated: true,
    output: { port: detail.output?.port ?? null, note: WORKFLOW_RUN_DETAIL_BUDGET_NOTE },
  } satisfies WorkflowStepDetail);
  state.charsUsed += minimal.length;
  return minimal;
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

/**
 * Wer darf welche Werte der Lauf-Details sehen (Server)? Die Schritte selbst
 * verlangen workflows.view und Mail-Leserecht; Variablen können aber auch
 * CRM-, ERP- oder Integrationsdaten tragen (customer.*, jtl.*, mssql.*,
 * http.*, eigene Variablen …) und Tracking-Daten. Deren Werte sieht nur, wer
 * die passende Berechtigung hat.
 */
export type WorkflowStepDetailViewer = {
  /** crm.read: Kunden-, Deal-, Aufgaben-, ERP- und Integrationsdaten. */
  crmRead: boolean;
  /** tracking.view: Öffnungs-/Klick-Tracking. */
  trackingView: boolean;
};

/** Namensräume, die nur aus Mail, Spam-/Authentifizierungsprüfung, KI-Bewertung der Mail und Ablauf stammen. */
const MAIL_SAFE_VARIABLE_NAMESPACES: ReadonlySet<string> = new Set([
  'email',
  'message',
  'draft',
  'imap',
  'sync',
  'spam',
  'rspamd',
  'auth',
  'dmarc',
  'sender',
  'outbound',
  'send_draft',
  'auto_reply',
  'reply_suggestion',
  'forward_copy',
  'threshold',
  'workflow',
  'ai',
]);

/** Mail-Felder der Workflow-Strings (Platzhalter ohne Punkt). */
const MAIL_STRING_KEYS: ReadonlySet<string> = new Set([
  // {{text}} = combined_text (Mail-Text)
  'text',
  'subject',
  'from_address',
  'to_address',
  'cc_address',
  'reply_to',
  'body_text',
  'snippet',
  'combined_text',
  'attachment_names',
  'attachment_types',
  'has_attachments',
  'date',
  'received_at',
  'sent_at',
  'message_id',
]);

const HIDDEN_CRM = '[ausgeblendet – nur mit CRM-Leserecht sichtbar]';
const HIDDEN_TRACKING = '[ausgeblendet – nur mit Tracking-Leserecht sichtbar]';

/** Ergebnis-Felder, die nur aus der Mail und der Bewertung stammen. */
const SAFE_RESULT_KEYS: ReadonlySet<string> = new Set([
  'answer',
  'probability',
  'confidence',
  'summary',
  'reason',
  'blockReason',
]);

function hiddenVariableValue(key: string, viewer: WorkflowStepDetailViewer): string | null {
  const dot = key.indexOf('.');
  const namespace = dot > 0 ? key.slice(0, dot) : '';
  if (namespace === 'tracking') return viewer.trackingView ? null : HIDDEN_TRACKING;
  // KI-Agent und Werkzeuge lesen CRM/ERP; ihre Ergebnisse sind keine reinen Mail-Daten.
  const agentOrTool = key.startsWith('ai.agent') || namespace === 'tool';
  if (namespace && MAIL_SAFE_VARIABLE_NAMESPACES.has(namespace) && !agentOrTool) return null;
  return viewer.crmRead ? null : HIDDEN_CRM;
}

/**
 * Schlüssel der {{Platzhalter}} eines Textes, mit derselben Semantik wie
 * interpolateWorkflowPlaceholders (Schlüssel = alles ohne geschweifte
 * Klammern, getrimmt). Linearer Scan statt regulärem Ausdruck: Vorlagen
 * stammen aus Workflow-Konfigurationen, ein Muster wie `{{{{…` darf den
 * Job nicht aufhalten.
 */
export function workflowTemplatePlaceholderKeys(template: string | null | undefined): string[] {
  const text = String(template ?? '');
  const keys: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const close = text.indexOf('}}', pos);
    if (close < 0) break;
    // Rückwärts bis zur nächsten Klammer, höchstens bis `pos`: jedes Zeichen
    // wird so insgesamt nur konstant oft angesehen.
    let open = -1;
    for (let index = close - 1; index >= pos; index -= 1) {
      const char = text[index];
      if (char === '}') break;
      if (char === '{') {
        if (index - 1 >= pos && text[index - 1] === '{') open = index + 1;
        break;
      }
    }
    if (open >= 0) {
      const key = text.slice(open, close).trim();
      if (key) keys.push(key);
    }
    pos = close + 2;
  }
  return keys;
}

/** Verweist ein Text mit {{Platzhaltern}} auf Daten, die nicht aus der Mail stammen? */
export function workflowTemplateUsesProtectedData(template: string | null | undefined): boolean {
  for (const key of workflowTemplatePlaceholderKeys(template)) {
    if (!key.includes('.')) {
      if (!MAIL_STRING_KEYS.has(key)) return true;
      continue;
    }
    if (hiddenVariableValue(key, { crmRead: false, trackingView: false }) !== null) return true;
  }
  return false;
}

function redactVariableRecord(
  record: Record<string, WorkflowStepDetailValue> | undefined,
  viewer: WorkflowStepDetailViewer,
): Record<string, WorkflowStepDetailValue> | undefined {
  if (!record) return record;
  const out: Record<string, WorkflowStepDetailValue> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = hiddenVariableValue(key, viewer) ?? value;
  }
  return out;
}

/**
 * Lauf-Detail für einen Betrachter: Variablen- und Ergebniswerte mit
 * CRM-/ERP-/Integrations- oder Tracking-Daten sowie Eingaben, deren Vorlage
 * solche Daten einsetzt (input.protectedExtra), werden ohne passende
 * Berechtigung durch einen Hinweis ersetzt. Schlüssel bleiben sichtbar.
 */
export function redactWorkflowStepDetailForViewer(
  value: unknown,
  viewer: WorkflowStepDetailViewer,
): unknown {
  const detail = parseWorkflowStepDetail(value);
  if (!detail) return value;
  if (viewer.crmRead && viewer.trackingView) return detail;
  const next: WorkflowStepDetail = { ...detail };
  if (detail.input) {
    const input = { ...detail.input };
    input.variables = redactVariableRecord(detail.input.variables, viewer);
    if (!input.variables) delete input.variables;
    if (detail.input.extra && !viewer.crmRead) {
      const protectedKeys = new Set(detail.input.protectedExtra ?? []);
      input.extra = Object.fromEntries(
        Object.entries(detail.input.extra).map(([key, entry]) => [key, protectedKeys.has(key) ? HIDDEN_CRM : entry]),
      );
    }
    next.input = input;
  }
  if (detail.output) {
    const output = { ...detail.output };
    output.variables = redactVariableRecord(detail.output.variables, viewer);
    if (!output.variables) delete output.variables;
    if (detail.output.result && !viewer.crmRead) {
      output.result = Object.fromEntries(
        Object.entries(detail.output.result).map(([key, entry]) => [key, SAFE_RESULT_KEYS.has(key) ? entry : HIDDEN_CRM]),
      );
    }
    next.output = output;
  }
  return next;
}
