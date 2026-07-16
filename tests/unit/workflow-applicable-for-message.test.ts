import {
  filterWorkflowsForMessage,
  isLocalComposeDraft,
  workflowApplicableToMessage,
} from '../../shared/workflow-applicable-for-message';

const wf = (id: number, trigger: string, enabled = 1, priority = 0) => ({
  id,
  name: `W${id}`,
  trigger,
  enabled,
  priority,
});

describe('workflow-applicable-for-message', () => {
  test('isLocalComposeDraft', () => {
    expect(isLocalComposeDraft({ uid: -1 })).toBe(true);
    expect(isLocalComposeDraft({ uid: 5, folder_kind: 'draft' })).toBe(true);
    expect(isLocalComposeDraft({ uid: 5, folder_kind: 'inbox' })).toBe(false);
  });

  test('inbound only for synced non-draft mail', () => {
    const msg = { uid: 10, folder_kind: 'inbox' };
    expect(workflowApplicableToMessage(wf(1, 'inbound'), msg)).toBe(true);
    expect(workflowApplicableToMessage(wf(1, 'inbound'), { uid: -1 })).toBe(false);
  });

  test('outbound and draft_created only for drafts', () => {
    const draft = { uid: -1 };
    expect(workflowApplicableToMessage(wf(1, 'outbound'), draft)).toBe(true);
    expect(workflowApplicableToMessage(wf(1, 'draft_created'), draft)).toBe(true);
    expect(workflowApplicableToMessage(wf(1, 'outbound'), { uid: 10 })).toBe(false);
  });

  test('manual always when enabled', () => {
    expect(workflowApplicableToMessage(wf(1, 'manual'), { uid: 10 })).toBe(true);
    expect(workflowApplicableToMessage(wf(1, 'manual'), { uid: -1 })).toBe(true);
    expect(workflowApplicableToMessage(wf(1, 'manual', 0), { uid: 10 })).toBe(false);
  });

  test('crm and schedule excluded', () => {
    const msg = { uid: 10 };
    expect(workflowApplicableToMessage(wf(1, 'crm.deal_stage_changed'), msg)).toBe(false);
    expect(workflowApplicableToMessage(wf(1, 'schedule'), msg)).toBe(false);
  });

  test('relay excluded (fired only by the server SMTP relay pipeline)', () => {
    expect(workflowApplicableToMessage(wf(1, 'relay'), { uid: 10 })).toBe(false);
    expect(workflowApplicableToMessage(wf(1, 'relay'), { uid: -1 })).toBe(false);
  });

  test('filterWorkflowsForMessage sorts by priority', () => {
    const list = [wf(1, 'inbound', 1, 1), wf(2, 'inbound', 1, 5), wf(3, 'outbound', 1, 9)];
    const filtered = filterWorkflowsForMessage(list, { uid: 10 });
    expect(filtered.map((w) => w.id)).toEqual([2, 1]);
  });
});
