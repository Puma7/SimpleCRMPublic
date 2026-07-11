/**
 * Bisher ungetestete Desktop-Knoten: execute()-Pfade der E-Mail-, CRM-,
 * Logik- und Workflow-Meta-Knoten (Registry-Definitionen direkt, ohne Runtime).
 */
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  clearMessageSeenSyncPending: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  setMessageSpamStatus: jest.fn(),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailAccountById: jest.fn(),
  createComposeDraft: jest.fn(() => 42),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
  tryLinkMessageToCustomer: jest.fn(),
}));

jest.mock('../../electron/email/email-imap-move', () => ({
  moveImapMessage: jest.fn(async () => undefined),
  deleteImapMessageOnServer: jest.fn(async () => undefined),
  isImapDeleteOptInEnabled: jest.fn(() => true),
}));

jest.mock('../../electron/sqlite-service', () => {
  const run = jest.fn(() => ({ lastInsertRowid: 55, changes: 1 }));
  const prepare = jest.fn(() => ({ run }));
  return {
    getDb: jest.fn(() => ({ prepare })),
    updateDealStage: jest.fn(() => ({ success: true })),
    getSyncInfo: jest.fn(() => null),
    setSyncInfo: jest.fn(),
  };
});

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: jest.fn(),
}));

jest.mock('../../electron/workflow/delayed-jobs', () => ({
  scheduleDelayedJob: jest.fn(),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(async () => ({
    status: 'ok',
    blocked: false,
    blockReason: null,
    log: [],
  })),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: jest.fn(() => ({ ok: true })),
  releaseOutboundHoldForDraft: jest.fn(() => ({ ok: true, autoSendScheduled: true })),
}));

import {
  addMessageTag,
  createComposeDraft,
  setMessageAssignedTo,
  setMessageSpam,
  setMessageSpamStatus,
} from '../../electron/email/email-store';
import {
  deleteImapMessageOnServer,
  isImapDeleteOptInEnabled,
  moveImapMessage,
} from '../../electron/email/email-imap-move';
import { getDb, updateDealStage } from '../../electron/sqlite-service';
import { getWorkflowById } from '../../electron/email/email-workflow-store';
import { scheduleDelayedJob } from '../../electron/workflow/delayed-jobs';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';
import { registerCrmNodes } from '../../electron/workflow/nodes/crm-nodes';
import { registerLogicNodes } from '../../electron/workflow/nodes/logic-nodes';
import { registerWorkflowMetaNodes } from '../../electron/workflow/nodes/workflow-nodes';

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

const emailDefs = collect(registerEmailNodes);
const crmDefs = collect(registerCrmNodes);
const logicDefs = collect(registerLogicNodes);
const metaDefs = collect(registerWorkflowMetaNodes);

// Der gemockte getDb() liefert immer dasselbe prepare/run-Paar — hier greifbar.
const prepareMock = (getDb() as unknown as { prepare: jest.Mock }).prepare;
const runMock = prepareMock().run as jest.Mock;

const baseMessage = {
  id: 7,
  account_id: 1,
  customer_id: 3,
  subject: 'Frage zu Bestellung 1234',
  body_text: 'Wo bleibt meine Bestellung?',
  snippet: 'Wo bleibt…',
};

function ctx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    trigger: 'inbound',
    direction: 'inbound',
    messageId: 7,
    message: baseMessage as never,
    outbound: null,
    workflowId: 1,
    runId: 1,
    dryRun: false,
    variables: {},
    strings: {
      subject: baseMessage.subject,
      from_address: 'kunde@firma.de',
      combined_text: 'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?',
      snippet: baseMessage.snippet,
    },
    ai: {},
    ...overrides,
  } as WorkflowContext;
}

beforeEach(() => jest.clearAllMocks());

describe('email.create_draft', () => {
  const node = emailDefs.get('email.create_draft')!;

  test('legt Re:-Entwurf mit Prefix + Trenner + combined_text an und liefert draft.id', async () => {
    const r = await node.execute(ctx(), { bodyPrefix: 'Danke für Ihre Nachricht.' }, 'n1');
    expect(r.status).toBe('ok');
    expect(r.variables?.['draft.id']).toBe(42);
    expect(createComposeDraft).toHaveBeenCalledWith({
      accountId: 1,
      subject: 'Re: Frage zu Bestellung 1234',
      bodyText:
        'Danke für Ihre Nachricht.\n\n---\nFrage zu Bestellung 1234\nWo bleibt meine Bestellung?',
    });
  });

  test('doppelt kein Re:, wenn der Betreff schon eines hat', async () => {
    const c = ctx({ message: { ...baseMessage, subject: 'Re: Alt' } as never });
    await node.execute(c, {}, 'n1');
    const input = (createComposeDraft as jest.Mock).mock.calls[0]![0];
    expect(input.subject).toBe('Re: Alt');
  });

  test('dry-run legt nichts an', async () => {
    const r = await node.execute(ctx({ dryRun: true }), { bodyPrefix: 'x' }, 'n1');
    expect(r).toMatchObject({ status: 'ok', message: 'dry-run draft' });
    expect(createComposeDraft).not.toHaveBeenCalled();
  });
});

describe('email.move_imap', () => {
  const node = emailDefs.get('email.move_imap')!;

  test('verschiebt die Nachricht in den Zielordner und setzt imap.moved_to', async () => {
    const r = await node.execute(ctx(), { folderPath: 'Archiv/2026' }, 'n1');
    expect(moveImapMessage).toHaveBeenCalledWith(baseMessage, 'Archiv/2026');
    expect(r).toMatchObject({
      status: 'ok',
      variables: { 'imap.moved_to': 'Archiv/2026', messageId: 7 },
    });
  });

  test('leerer Zielordner → skipped; dry-run verschiebt nicht', async () => {
    await expect(node.execute(ctx(), { folderPath: '  ' }, 'n1')).resolves.toMatchObject({
      status: 'skipped',
      message: 'Zielordner leer',
    });
    await expect(node.execute(ctx({ dryRun: true }), {}, 'n1')).resolves.toMatchObject({
      status: 'ok',
      message: 'dry-run move Spam',
    });
    expect(moveImapMessage).not.toHaveBeenCalled();
  });

  test('IMAP-Fehler wird nicht geschluckt, sondern propagiert (Runtime fängt ihn)', async () => {
    (moveImapMessage as jest.Mock).mockRejectedValueOnce(new Error('NO move'));
    await expect(node.execute(ctx(), { folderPath: 'Spam' }, 'n1')).rejects.toThrow('NO move');
  });
});

describe('email.delete_server', () => {
  const node = emailDefs.get('email.delete_server')!;

  test('löscht nur bei aktiviertem Opt-in für das Konto', async () => {
    const r = await node.execute(ctx(), {}, 'n1');
    expect(isImapDeleteOptInEnabled).toHaveBeenCalledWith(1);
    expect(deleteImapMessageOnServer).toHaveBeenCalledWith(baseMessage);
    expect(r.status).toBe('ok');
  });

  test('ohne Opt-in → error, kein Löschversuch', async () => {
    (isImapDeleteOptInEnabled as jest.Mock).mockReturnValueOnce(false);
    const r = await node.execute(ctx(), {}, 'n1');
    expect(r).toMatchObject({
      status: 'error',
      message: 'IMAP-Server-Löschung für dieses Konto nicht aktiviert',
    });
    expect(deleteImapMessageOnServer).not.toHaveBeenCalled();
  });

  test('dry-run löscht nichts', async () => {
    await node.execute(ctx({ dryRun: true }), {}, 'n1');
    expect(deleteImapMessageOnServer).not.toHaveBeenCalled();
  });
});

describe('email.assign', () => {
  const node = emailDefs.get('email.assign')!;

  test('weist den Mitarbeiter zu und setzt email.assigned_to', async () => {
    const r = await node.execute(ctx(), { teamMemberId: 'tm-7' }, 'n1');
    expect(setMessageAssignedTo).toHaveBeenCalledWith(7, 'tm-7');
    expect(r.variables?.['email.assigned_to']).toBe('tm-7');
  });

  test('leere ID hebt die Zuweisung auf (null)', async () => {
    const r = await node.execute(ctx(), { teamMemberId: '' }, 'n1');
    expect(setMessageAssignedTo).toHaveBeenCalledWith(7, null);
    expect(r.variables?.['email.assigned_to']).toBeNull();
  });

  test('nur Whitespace → error (weder zuweisen noch aufheben)', async () => {
    const r = await node.execute(ctx(), { teamMemberId: '   ' }, 'n1');
    expect(r).toMatchObject({ status: 'error', message: 'teamMemberId leer' });
    expect(setMessageAssignedTo).not.toHaveBeenCalled();
  });
});

describe('email.set_priority', () => {
  const node = emailDefs.get('email.set_priority')!;

  test('ungültiges Level → error ohne Tag', async () => {
    const r = await node.execute(ctx(), { level: 'dringend' }, 'n1');
    expect(r).toMatchObject({ status: 'error' });
    expect(addMessageTag).not.toHaveBeenCalled();
  });

  test.each([
    ['hoch', 'priority:hoch'],
    ['high', 'priority:hoch'],
    ['normal', 'priority:normal'],
    ['niedrig', 'priority:niedrig'],
    ['low', 'priority:niedrig'],
  ])('Level %s → Tag %s + Variable email.priority', async (level, tag) => {
    const r = await node.execute(ctx(), { level }, 'n1');
    expect(addMessageTag).toHaveBeenCalledWith(7, tag);
    expect(r.variables?.['email.priority']).toBe(tag);
  });

  test('dry-run setzt Variable, aber keinen Tag', async () => {
    const r = await node.execute(ctx({ dryRun: true }), { level: 'hoch' }, 'n1');
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(r.variables?.['email.priority']).toBe('priority:hoch');
  });
});

describe('email.set_spam_status', () => {
  const node = emailDefs.get('email.set_spam_status')!;

  test('setzt Status mit Trainings-Flag und optionalem Tag', async () => {
    const r = await node.execute(ctx(), { status: 'spam', train: true, tag: 'ki-spam' }, 'n1');
    expect(setMessageSpamStatus).toHaveBeenCalledWith(7, 'spam', {
      train: true,
      source: 'workflow',
    });
    expect(addMessageTag).toHaveBeenCalledWith(7, 'ki-spam');
    expect(r.variables).toMatchObject({ 'email.is_spam': true, 'spam.status': 'spam' });
  });

  test('unbekannter Status fällt auf review zurück; ohne Tag kein addMessageTag', async () => {
    const r = await node.execute(ctx(), { status: 'quatsch' }, 'n1');
    expect(setMessageSpamStatus).toHaveBeenCalledWith(7, 'review', {
      train: false,
      source: 'workflow',
    });
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(r.variables).toMatchObject({ 'email.is_spam': false, 'spam.status': 'review' });
  });

  test('dry-run: Variablen ja, Seiteneffekte nein', async () => {
    const r = await node.execute(ctx({ dryRun: true }), { status: 'clean', tag: 'x' }, 'n1');
    expect(setMessageSpamStatus).not.toHaveBeenCalled();
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(r.variables).toMatchObject({ 'email.is_spam': false, 'spam.status': 'clean' });
  });
});

describe('email.mark_spam', () => {
  const node = emailDefs.get('email.mark_spam')!;

  test('markiert als Spam, taggt und verschiebt bei moveImap=true nach Spam', async () => {
    const r = await node.execute(ctx(), { spam: true, train: true, moveImap: true }, 'n1');
    expect(setMessageSpam).toHaveBeenCalledWith(7, true, { train: true, source: 'workflow' });
    expect(addMessageTag).toHaveBeenCalledWith(7, 'auto-spam');
    expect(moveImapMessage).toHaveBeenCalledWith(baseMessage, 'Spam');
    expect(r.variables).toMatchObject({ 'email.is_spam': true, 'spam.status': 'spam' });
  });

  test('spam=false verschiebt trotz moveImap=true nicht', async () => {
    const r = await node.execute(ctx(), { spam: false, moveImap: true, tag: '' }, 'n1');
    expect(setMessageSpam).toHaveBeenCalledWith(7, false, { train: false, source: 'workflow' });
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(moveImapMessage).not.toHaveBeenCalled();
    expect(r.variables).toMatchObject({ 'email.is_spam': false, 'spam.status': 'clean' });
  });

  test('dry-run: keine Seiteneffekte', async () => {
    await node.execute(ctx({ dryRun: true }), { moveImap: true }, 'n1');
    expect(setMessageSpam).not.toHaveBeenCalled();
    expect(moveImapMessage).not.toHaveBeenCalled();
  });
});

describe('crm.create_task', () => {
  const node = crmDefs.get('crm.create_task')!;

  test('legt Aufgabe für den verknüpften Kunden an und liefert task.id', async () => {
    runMock.mockReturnValueOnce({ lastInsertRowid: 77, changes: 1 });
    const r = await node.execute(ctx(), { title: 'Rückruf', priority: 'high', daysUntilDue: 1 }, 'n1');
    expect(prepareMock.mock.calls[0]![0]).toContain('INSERT INTO tasks');
    const args = runMock.mock.calls[0]!;
    expect(args[0]).toBe(3); // customer_id aus ctx.message
    expect(args[1]).toBe('Rückruf');
    expect(args[2]).toBe('Wo bleibt…'); // Beschreibung = snippet
    expect(new Date(args[3] as string).getTime()).toBeGreaterThan(Date.now());
    expect(args[4]).toBe('high');
    expect(r).toMatchObject({ status: 'ok', variables: { 'task.id': 77 } });
  });

  test('ohne Kunden an der Nachricht greift config.customerId', async () => {
    const c = ctx({ message: { ...baseMessage, customer_id: null } as never });
    await node.execute(c, { customerId: 12 }, 'n1');
    expect(runMock.mock.calls[0]![0]).toBe(12);
  });

  test('ganz ohne Kunde → skipped ohne DB-Zugriff; dry-run schreibt nicht', async () => {
    const c = ctx({ message: { ...baseMessage, customer_id: null } as never });
    await expect(node.execute(c, {}, 'n1')).resolves.toMatchObject({
      status: 'skipped',
      message: 'Kein Kunde verknüpft',
    });
    await node.execute(ctx({ dryRun: true }), {}, 'n1');
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('crm.log_activity', () => {
  const node = crmDefs.get('crm.log_activity')!;

  test('protokolliert Aktivität mit Metadaten (messageId/workflowId)', async () => {
    const r = await node.execute(ctx(), { activityType: 'call', title: 'Anruf' }, 'n1');
    expect(prepareMock.mock.calls[0]![0]).toContain('INSERT INTO activity_log');
    const args = runMock.mock.calls[0]!;
    expect(args[0]).toBe(3);
    expect(args[1]).toBe('call');
    expect(args[2]).toBe('Anruf');
    expect(args[3]).toBe('Frage zu Bestellung 1234');
    expect(JSON.parse(args[4] as string)).toEqual({ messageId: 7, workflowId: 1 });
    expect(r.status).toBe('ok');
  });

  test('ohne Kunden → skipped; dry-run schreibt nicht', async () => {
    const c = ctx({ message: { ...baseMessage, customer_id: null } as never });
    await expect(node.execute(c, {}, 'n1')).resolves.toMatchObject({ status: 'skipped' });
    await node.execute(ctx({ dryRun: true }), {}, 'n1');
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('crm.update_deal', () => {
  const node = crmDefs.get('crm.update_deal')!;

  test('dealId + stage → updateDealStage und deal.*-Variablen', async () => {
    const r = await node.execute(ctx(), { dealId: 5, stage: 'won' }, 'n1');
    expect(updateDealStage).toHaveBeenCalledWith(5, 'won');
    expect(r).toMatchObject({
      status: 'ok',
      variables: { 'deal.id': 5, 'deal.stage': 'won' },
    });
  });

  test('dealId 0 fällt auf die deal.id-Variable zurück (Phase-2-Fix)', async () => {
    const c = ctx({ variables: { 'deal.id': 9 } });
    await node.execute(c, { dealId: 0, stage: 'lost' }, 'n1');
    expect(updateDealStage).toHaveBeenCalledWith(9, 'lost');
  });

  test('fehlgeschlagenes Stage-Update → error mit Grund', async () => {
    (updateDealStage as jest.Mock).mockReturnValueOnce({ success: false, error: 'kaputt' });
    const r = await node.execute(ctx(), { dealId: 5, stage: 'won' }, 'n1');
    expect(r).toMatchObject({ status: 'error', message: 'kaputt' });
  });

  test('ohne Stage, mit Titel → UPDATE auf deals.title', async () => {
    const r = await node.execute(ctx(), { dealId: 5, title: 'Neuer Titel' }, 'n1');
    expect(updateDealStage).not.toHaveBeenCalled();
    expect(prepareMock.mock.calls[0]![0]).toContain('UPDATE deals SET title');
    const args = runMock.mock.calls[0]!;
    expect(args[0]).toBe('Neuer Titel');
    expect(args[2]).toBe(5);
    expect(r.variables).toEqual({ 'deal.id': 5 });
  });

  test('weder Stage noch Titel → ok, nur deal.id-Variable', async () => {
    const r = await node.execute(ctx(), { dealId: 5 }, 'n1');
    expect(runMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'ok', variables: { 'deal.id': 5 } });
  });

  test('keine Deal-ID (weder Config noch Variable) → skipped', async () => {
    const r = await node.execute(ctx(), { dealId: 0, stage: 'won' }, 'n1');
    expect(r).toMatchObject({ status: 'skipped', message: 'Keine Deal-ID' });
    expect(updateDealStage).not.toHaveBeenCalled();
  });
});

describe('logic.set_variable / logic.stop / logic.merge', () => {
  test('set_variable übernimmt Zahlen/Booleans typtreu, sonst String', async () => {
    const node = logicDefs.get('logic.set_variable')!;
    await expect(node.execute(ctx(), { name: 'score', value: 5 }, 'n1')).resolves.toMatchObject({
      status: 'ok',
      variables: { score: 5 },
    });
    await expect(node.execute(ctx(), { name: 'flag', value: true }, 'n1')).resolves.toMatchObject({
      variables: { flag: true },
    });
    await expect(node.execute(ctx(), { name: 'txt' }, 'n1')).resolves.toMatchObject({
      variables: { txt: '' },
    });
  });

  test('set_variable ohne Namen nutzt den Default "var"; leerer Name wird NICHT abgewiesen', async () => {
    const node = logicDefs.get('logic.set_variable')!;
    await expect(node.execute(ctx(), { value: 'x' }, 'n1')).resolves.toMatchObject({
      variables: { var: 'x' },
    });
    // TODO: name:'' erzeugt aktuell einen Leerstring-Variablennamen statt
    // skipped/error — dokumentiert das Ist-Verhalten (keine Validierung im Code).
    const r = await node.execute(ctx(), { name: '', value: 'x' }, 'n1');
    expect(r.status).toBe('ok');
    expect(r.variables).toEqual({ '': 'x' });
  });

  test('stop beendet den Lauf, merge reicht auf default durch', async () => {
    await expect(logicDefs.get('logic.stop')!.execute(ctx(), {}, 'n1')).resolves.toEqual({
      status: 'ok',
      stop: true,
    });
    await expect(logicDefs.get('logic.merge')!.execute(ctx(), {}, 'n1')).resolves.toEqual({
      status: 'ok',
      port: 'default',
    });
  });
});

describe('logic.delay', () => {
  const node = logicDefs.get('logic.delay')!;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-10T12:00:00.000Z') });
  });
  afterEach(() => jest.useRealTimers());

  test('plant Resume-Job mit expliziter resumeNodeId und liefert deferred/stop', async () => {
    const c = ctx({ variables: { foo: 'bar' } });
    const r = await node.execute(c, { delaySeconds: 30, resumeNodeId: 'next' }, 'd1');
    expect(scheduleDelayedJob).toHaveBeenCalledWith({
      workflowId: 1,
      messageId: 7,
      resumeNodeId: 'next',
      executeAt: '2026-07-10T12:00:30.000Z',
      contextJson: expect.any(String),
    });
    const payload = JSON.parse(
      (scheduleDelayedJob as jest.Mock).mock.calls[0]![0].contextJson as string,
    );
    expect(payload.variables).toEqual({ foo: 'bar' });
    expect(r).toMatchObject({
      status: 'ok',
      stop: true,
      deferred: true,
      message: 'delayed_until:2026-07-10T12:00:30.000Z',
    });
  });

  test('klemmt delaySeconds auf mindestens 1s und höchstens 7 Tage', async () => {
    await node.execute(ctx(), { delaySeconds: 0, resumeNodeId: 'next' }, 'd1');
    await node.execute(ctx(), { delaySeconds: 999_999_999, resumeNodeId: 'next' }, 'd1');
    const calls = (scheduleDelayedJob as jest.Mock).mock.calls;
    expect(calls[0]![0].executeAt).toBe('2026-07-10T12:00:01.000Z');
    expect(calls[1]![0].executeAt).toBe('2026-07-17T12:00:00.000Z');
  });

  test('ohne resumeNodeId wird der Folgeknoten aus dem Graphen aufgelöst', async () => {
    (getWorkflowById as jest.Mock).mockReturnValueOnce({
      id: 1,
      graph_json: JSON.stringify({
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
          { id: 'd1', type: 'registry', data: { nodeType: 'logic.delay', config: {} } },
          { id: 'a1', type: 'action', data: { actionType: 'archive' } },
        ],
        edges: [
          { id: 'e0', source: 't1', target: 'd1' },
          { id: 'e1', source: 'd1', target: 'a1' },
        ],
      }),
    });
    await node.execute(ctx(), { delaySeconds: 30 }, 'd1');
    expect((scheduleDelayedJob as jest.Mock).mock.calls[0]![0].resumeNodeId).toBe('a1');
  });

  test('kein Resume-Knoten auffindbar → error ohne Job', async () => {
    (getWorkflowById as jest.Mock).mockReturnValueOnce(undefined);
    const r = await node.execute(ctx(), { delaySeconds: 30 }, 'd1');
    expect(r).toMatchObject({ status: 'error' });
    expect(scheduleDelayedJob).not.toHaveBeenCalled();
  });

  test('dry-run plant nichts; ohne delaySeconds gilt der minutes-Pfad', async () => {
    await expect(node.execute(ctx({ dryRun: true }), { delaySeconds: 30 }, 'd1')).resolves.toMatchObject({
      status: 'ok',
      message: 'delay 30s',
    });
    await expect(node.execute(ctx({ dryRun: true }), {}, 'd1')).resolves.toMatchObject({
      message: 'delay 5m',
    });
    expect(scheduleDelayedJob).not.toHaveBeenCalled();
  });
});

describe('workflow.subflow', () => {
  const node = metaDefs.get('workflow.subflow')!;
  const subWorkflow = { id: 5, enabled: 1, trigger: 'inbound', graph_json: null };

  test('workflowId 0 und Selbstaufruf → error (Rekursionsschutz)', async () => {
    await expect(node.execute(ctx(), { workflowId: 0 }, 'n1')).resolves.toMatchObject({
      status: 'error',
      message: 'Ungültige Subflow-ID',
    });
    await expect(node.execute(ctx(), { workflowId: 1 }, 'n1')).resolves.toMatchObject({
      status: 'error',
      message: 'Ungültige Subflow-ID',
    });
    expect(executeWorkflowForTrigger).not.toHaveBeenCalled();
  });

  test('unbekannter oder deaktivierter Subflow → error', async () => {
    (getWorkflowById as jest.Mock).mockReturnValueOnce(undefined);
    await expect(node.execute(ctx(), { workflowId: 5 }, 'n1')).resolves.toMatchObject({
      status: 'error',
      message: 'Subflow nicht gefunden oder inaktiv',
    });
    (getWorkflowById as jest.Mock).mockReturnValueOnce({ ...subWorkflow, enabled: 0 });
    await expect(node.execute(ctx(), { workflowId: 5 }, 'n1')).resolves.toMatchObject({
      status: 'error',
    });
  });

  test('führt den Subflow mit Trigger/Richtung des Subflows und kopierten Variablen aus', async () => {
    (getWorkflowById as jest.Mock).mockReturnValueOnce(subWorkflow);
    const c = ctx({ variables: { 'ai.class': 'support' } });
    const r = await node.execute(c, { workflowId: 5 }, 'n1');
    expect(executeWorkflowForTrigger).toHaveBeenCalledWith({
      workflow: subWorkflow,
      trigger: 'inbound',
      direction: 'inbound',
      message: c.message,
      outbound: null,
      dryRun: false,
      initialVariables: { 'ai.class': 'support' },
    });
    expect(r).toMatchObject({ status: 'ok', variables: { 'subflow.status': 'ok' } });
  });

  test('blockierender Subflow reicht blocked/blockReason durch, Fehler wird zu error', async () => {
    (getWorkflowById as jest.Mock).mockReturnValue(subWorkflow);
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValueOnce({
      status: 'blocked',
      blocked: true,
      blockReason: 'spam',
    });
    await expect(node.execute(ctx(), { workflowId: 5 }, 'n1')).resolves.toMatchObject({
      status: 'ok',
      blocked: true,
      blockReason: 'spam',
      variables: { 'subflow.status': 'blocked' },
    });
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValueOnce({
      status: 'error',
      blocked: false,
    });
    await expect(node.execute(ctx(), { workflowId: 5 }, 'n1')).resolves.toMatchObject({
      status: 'error',
      variables: { 'subflow.status': 'error' },
    });
    (getWorkflowById as jest.Mock).mockReset();
  });

  test('dry-run startet den Subflow nicht', async () => {
    (getWorkflowById as jest.Mock).mockReturnValueOnce(subWorkflow);
    const r = await node.execute(ctx({ dryRun: true }), { workflowId: 5 }, 'n1');
    expect(r).toMatchObject({ status: 'ok', message: 'dry-run subflow 5' });
    expect(executeWorkflowForTrigger).not.toHaveBeenCalled();
  });
});
