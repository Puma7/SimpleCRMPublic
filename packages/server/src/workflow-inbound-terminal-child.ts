/**
 * Abschluss für TERMINALE asynchrone Workflow-Kindjobs.
 *
 * Ein KI-Knoten am Ende eines Inbound-Zweigs (keine ausgehende Kante) hat keine
 * Resume-Continuation. Bis hierher hiess das: der Elternlauf galt sofort als
 * erfolgreich und angewendet, die naechste Prioritaetsstufe startete — obwohl
 * der Kindjob noch gar nicht gelaufen war. Scheiterte der Kindjob danach
 * endgueltig, blieb der Applied-Marker stehen und die Arbeit wurde bei einer
 * normalen Wiederverarbeitung nicht nachgeholt.
 *
 * Der Elternlauf deferiert deshalb auch ohne Resume-Kante; der Kindjob
 * uebernimmt den Abschluss und ruft hier genau einmal:
 *   1. Join-Barriere des Fan-outs abbauen,
 *   2. Prioritaetskette weiterschalten,
 *   3. Applied-Marker setzen — aber nur, wenn Schritt 1 das erlaubt.
 *
 * Daraus folgt die Invariante: JEDER normale Ausgang eines terminalen Kindjobs
 * muss genau einmal hier ankommen. „Genau" traegt {@link runTerminalInboundChild}
 * (holt vergessene Ausgaenge nach) zusammen mit der Einmal-Schranke in
 * {@link completeTerminalInboundChild} (verhindert doppeltes Herunterzaehlen der
 * Join-Barriere bei einem Job-Retry). Wirft der Kindjob, wird bewusst NICHT
 * abgeschlossen — Graphile wiederholt ihn, erst der endgueltige Fehlschlag
 * schaltet die Kette weiter.
 *
 * Damit der Kindjob das kann, stempeln die Scheduler den Workflow- und
 * Kettenkontext auch dann auf die Job-Payload, wenn es keine Continuation gibt
 * (`terminalChainPayload`). Die Felder dort:
 *   - `workflowId` / `messageId` — Ziel des Applied-Markers ohne Kette,
 *   - `context.inboundWorkflowChain` — Join-Barriere und Prioritaetskette,
 *   - `terminalNodeId` + `runId` — trennen zwei terminale Zweige derselben
 *     Nachricht in Graphile-Job-Key und Einmal-Schranke,
 *   - `triggerName` — nur ein Inbound-Lauf darf einen Inbound-Marker setzen.
 * Derselbe Kontext traegt zusaetzlich die
 * Abbruchpruefung: ohne ihn uebersprang ein terminaler `ai.agent` /
 * `ai.pick_canned` sogar den Spam- und Sibling-Abort-Check, weil beide am
 * Vorhandensein einer Continuation haengen.
 */
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import {
  advanceInboundChainAfterTerminalChild,
  terminalInboundChildContext,
} from './workflow-inbound-chain-advance';

const SERVER_CREATED_SOURCE_ID_OFFSET = 1_000_000_000_000n;
const SERVER_CREATED_SOURCE_ID_SPAN = 7_000_000_000_000_000n;

/**
 * Gleiche Berechnung wie in workflow-execution.ts — bewusst hier zentral, damit
 * der Applied-Marker aus Eltern- und Kindjob garantiert dieselbe id ergibt.
 */
export function serverCreatedSourceSqliteId(kind: string, ...parts: string[]): number {
  const value = [kind, ...parts].join('\u001f');
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number(SERVER_CREATED_SOURCE_ID_OFFSET + (hash % SERVER_CREATED_SOURCE_ID_SPAN));
}

/**
 * Applied-Marker anhand von ids setzen (der Kindjob hat weder Workflow- noch
 * Message-Row zur Hand). Idempotent: derselbe Lauf darf ihn mehrfach schreiben.
 */
export async function markInboundWorkflowAppliedByIds(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    now: Date;
  },
): Promise<void> {
  const message = await trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!message) return;
  const workflow = await trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.workflowId)
    .executeTakeFirst();
  if (!workflow) return;

  const messageSourceSqliteId = Number(message.source_sqlite_id);
  const workflowSource = workflow.source_sqlite_id === null
    ? -Number(workflow.id)
    : Number(workflow.source_sqlite_id);

  await trx
    .insertInto('email_message_workflow_applied')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_workflow_applied',
        input.workspaceId,
        String(messageSourceSqliteId),
        String(workflowSource),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      workflow_source_sqlite_id: workflowSource,
      message_id: Number(message.id),
      workflow_id: Number(workflow.id),
      source_row: { origin: 'server_worker' },
      imported_in_run_id: null,
      applied_at: input.now,
      updated_at: input.now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'message_source_sqlite_id', 'workflow_source_sqlite_id'])
      .doUpdateSet({
        message_id: Number(message.id),
        workflow_id: Number(workflow.id),
        applied_at: input.now,
        updated_at: input.now,
        source_row: { origin: 'server_worker' },
      }))
    .execute();
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type TerminalChildTarget = {
  workspaceId: string;
  messageId: number;
  workflowId: number;
  nodeId: string;
  runId: number | null;
};

/**
 * Wen schliesst dieser Kindjob ab?
 *
 * Bevorzugt den Inbound-Kettenkontext; faellt aber auf die direkt gestempelten
 * `workflowId` / `messageId` zurueck. Ohne diesen Fallback bliebe der
 * Applied-Marker bei kettenlosen INBOUND-Laeufen (Backfill,
 * forceWorkflowReapply) dauerhaft aus und die Arbeit des Kindjobs fiele bei
 * jeder Wiederverarbeitung erneut an.
 *
 * Der Fallback gilt bewusst nur fuer `triggerName === 'inbound'`. Ein manueller
 * Lauf auf derselben Nachricht setzte sonst einen Inbound-Applied-Marker, den
 * der Elternpfad nie gesetzt haette — die spaetere echte Inbound-Verarbeitung
 * wuerde den Workflow dann ueber `wasInboundWorkflowApplied` komplett
 * ueberspringen.
 */
function terminalChildTarget(payload: Record<string, unknown>): TerminalChildTarget | null {
  const resolved = terminalInboundChildContext(payload);
  if (!resolved) return null;
  return {
    workspaceId: resolved.workspaceId,
    messageId: resolved.messageId,
    workflowId: resolved.workflowId,
    // Zwei terminale Knoten desselben Laufs schliessen unabhaengig voneinander
    // ab und brauchen darum getrennte Einmal-Schluessel.
    nodeId: trimmedString(payload.terminalNodeId) || 'terminal',
    runId: positiveInt(payload.runId),
  };
}

function terminalChildCompletionKey(target: TerminalChildTarget): string {
  return [
    'inbound_terminal_child_done',
    target.messageId,
    target.workflowId,
    target.nodeId,
    target.runId ?? 'none',
  ].join(':');
}

/**
 * Abschluss eines terminalen Kindjobs — genau einmal pro Knoten und Lauf.
 *
 * @param applied true ⇒ der Kindjob hat seine Arbeit erledigt und der Workflow
 * gilt als angewendet. false ⇒ uebersprungen oder gescheitert: Kette wird
 * trotzdem weitergeschaltet, der Workflow aber NICHT als angewendet markiert,
 * damit eine Wiederverarbeitung ihn nachholt.
 */
export async function completeTerminalInboundChild(
  trx: WorkspaceTransaction,
  payload: Record<string, unknown>,
  input: { applied: boolean; now: Date },
): Promise<void> {
  const target = terminalChildTarget(payload);
  if (!target) return;

  // Einmal-Schranke. Ein Kindjob kann nach einem bereits committeten Abschluss
  // erneut anlaufen (Graphile-Retry, doppelt eingereihter Job) und wuerde die
  // Join-Barriere sonst ein zweites Mal herunterzaehlen: pending faellt zu frueh
  // auf 0, ein noch laufender Geschwisterzweig verliert seinen Platz und der
  // naechste Prioritaets-Workflow startet mitten im Lauf. Die Schranke liegt in
  // derselben Transaktion wie der Abschluss — ein Rollback gibt sie wieder frei.
  const claimed = await trx
    .insertInto('sync_info')
    .values({
      workspace_id: target.workspaceId,
      key: terminalChildCompletionKey(target),
      value: '1',
      last_updated: input.now,
      source_row: { origin: 'inbound_terminal_child' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .returning('key')
    .executeTakeFirst();
  if (!claimed) return;

  // Reihenfolge: erst die Join-Barriere, dann der Applied-Marker. Ihr Ergebnis
  // entscheidet, ob der Marker ueberhaupt gesetzt werden darf — `ready_error`
  // heisst „alle Geschwister durch, mindestens eines ausgefallen", `wait` heisst
  // „ein Geschwister laeuft noch und markiert spaeter selbst". Umgekehrt (Marker
  // zuerst) galte ein Lauf als angewendet, dessen Geschwisterzweig scheiterte.
  const { state } = await advanceInboundChainAfterTerminalChild(trx, payload, {
    ...(input.applied ? {} : { error: true }),
    now: input.now,
  });
  if (!input.applied) return;
  // Nur `ready` (alle Geschwister durch, keines ausgefallen) und `null` (gar
  // keine Barriere) rechtfertigen den Marker. `wait` ⇒ ein Geschwister laeuft
  // noch und markiert spaeter selbst; `ready_error` ⇒ ein Geschwister ist
  // ausgefallen; `stop` ⇒ ein Geschwister hat die Kette beendet — dort setzt
  // auch der synchrone Abschluss (inboundChainStop) bewusst keinen Marker.
  if (state !== null && state !== 'ready') return;

  await markInboundWorkflowAppliedByIds(trx, {
    workspaceId: target.workspaceId,
    messageId: target.messageId,
    workflowId: target.workflowId,
    now: input.now,
  });
}

export type TerminalInboundChildDeps = Readonly<{
  db: import('kysely').Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

/**
 * Sicherheitsnetz um einen terminalen KI-Kindjob.
 *
 * Seit terminale KI-Knoten den Elternlauf deferieren, gilt die Invariante: JEDER
 * normale Ausgang eines solchen Kindjobs muss die Kette genau einmal
 * abschliessen. Die Ports tun das auf ihrem Erfolgspfad selbst — aber sie haben
 * viele fruehe `return`s (Abbruch nach dem Modellaufruf, Entwurf verschwunden,
 * keine Continuation einzureihen, Dedupe-Treffer). Jeden davon einzeln zu
 * bedienen ist nicht haltbar; ein vergessener Pfad haengt die Kette dauerhaft.
 *
 * Darum hier: laeuft der Port normal zu Ende, wird der Abschluss nachgeholt.
 * Hat der Port ihn bereits mit dem korrekten `applied` durchgefuehrt, greift die
 * Einmal-Schranke in {@link completeTerminalInboundChild} und dieser Aufruf ist
 * ein No-op. Wirft der Port, passiert bewusst NICHTS: Graphile wiederholt den
 * Job, und erst der endgueltige Fehlschlag schaltet die Kette weiter.
 */
export async function runTerminalInboundChild<T>(
  deps: TerminalInboundChildDeps,
  input: { workspaceId: string; terminalChainPayload?: Record<string, unknown> },
  now: () => Date,
  run: () => Promise<T>,
): Promise<T> {
  const result = await run();
  const payload = input.terminalChainPayload;
  if (!payload) return result;
  await withWorkspaceTransaction(
    deps.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => completeTerminalInboundChild(trx, payload, { applied: false, now: now() }),
    { applySession: deps.applyWorkspaceSession },
  );
  return result;
}
