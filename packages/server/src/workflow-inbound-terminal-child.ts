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
 *   1. Applied-Marker setzen (nur bei Erfolg),
 *   2. Join-Barriere des Fan-outs abbauen,
 *   3. Prioritaetskette weiterschalten.
 *
 * Damit der Kindjob das kann, stempeln die Scheduler den Workflow- und
 * Kettenkontext auch dann auf die Job-Payload, wenn es keine Continuation gibt
 * (`terminalChainPayload`). Derselbe Kontext traegt zusaetzlich die
 * Abbruchpruefung: ohne ihn uebersprang ein terminaler `ai.agent` /
 * `ai.pick_canned` sogar den Spam- und Sibling-Abort-Check, weil beide am
 * Vorhandensein einer Continuation haengen.
 */
import type { WorkspaceTransaction } from './db/workspace-context';
import {
  enqueueNextInboundWorkflowAfterTerminalChildFailure,
  inboundChainFromJobPayload,
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

/**
 * Abschluss eines terminalen Kindjobs.
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
  const parsed = inboundChainFromJobPayload(payload);
  if (parsed && input.applied) {
    const workflowId = parsed.chain.workflowIds[parsed.chain.index];
    if (workflowId != null) {
      await markInboundWorkflowAppliedByIds(trx, {
        workspaceId: parsed.workspaceId,
        messageId: parsed.messageId,
        workflowId,
        now: input.now,
      });
    }
  }
  // Baut die Join-Barriere ab und schaltet die Kette weiter (der Name stammt
  // aus dem Fehlerfall, die Logik ist fuer Erfolg und Misserfolg dieselbe).
  await enqueueNextInboundWorkflowAfterTerminalChildFailure(trx, payload, input.now);
}
