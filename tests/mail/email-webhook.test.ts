const syncStore = new Map<string, string>();
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (k: string) => syncStore.get(k) ?? null,
  setSyncInfo: (k: string, v: string) => syncStore.set(k, v),
}));
jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: jest.fn(),
}));
jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn(),
}));

import { listWorkflowsByTrigger } from '../../electron/email/email-workflow-store';
import { executeWorkflowForTrigger } from '../../electron/workflow/workflow-executor';
import { fireWebhookWorkflows } from '../../electron/email/email-webhook';

describe('email-webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncStore.clear();
    syncStore.set('email_webhook_secret', 'top-secret');
  });

  test('rejects invalid secret', async () => {
    const r = await fireWebhookWorkflows({ secret: 'wrong' });
    expect(r.error).toMatch(/Secret/);
    syncStore.delete('email_webhook_secret');
    const r2 = await fireWebhookWorkflows({ secret: 'top-secret' });
    expect(r2.error).toMatch(/Secret/);
  });

  test('deduplicates identical payload within window', async () => {
    (listWorkflowsByTrigger as jest.Mock).mockReturnValue([]);
    const payload = { secret: 'top-secret', body: { ping: 1 } };
    const first = await fireWebhookWorkflows(payload);
    expect(first.fired).toBe(0);
    const second = await fireWebhookWorkflows(payload);
    expect(second.deduplicated).toBe(true);
  });

  test('fires enabled workflows and collects errors', async () => {
    (listWorkflowsByTrigger as jest.Mock).mockReturnValue([
      { id: 1, enabled: true },
      { id: 2, enabled: true },
      { id: 3, enabled: false },
    ]);
    (executeWorkflowForTrigger as jest.Mock)
      .mockResolvedValueOnce({ status: 'ok', blocked: false })
      .mockResolvedValueOnce({ status: 'error', log: ['step failed'] });
    const r = await fireWebhookWorkflows({ secret: 'top-secret', body: { x: 1 } });
    expect(r.fired).toBe(1);
    expect(r.error).toMatch(/wf2/);
  });

  test('collects executor throw as error', async () => {
    (listWorkflowsByTrigger as jest.Mock).mockReturnValue([{ id: 3, enabled: true }]);
    (executeWorkflowForTrigger as jest.Mock).mockRejectedValue(new Error('boom'));
    const r = await fireWebhookWorkflows({ secret: 'top-secret' });
    expect(r.error).toMatch(/wf3:boom/);
  });

  test('does not count blocked workflows as fired', async () => {
    (listWorkflowsByTrigger as jest.Mock).mockReturnValue([{ id: 5, enabled: true }]);
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValue({ status: 'ok', blocked: true });
    const r = await fireWebhookWorkflows({ secret: 'top-secret' });
    expect(r.fired).toBe(0);
  });

  test('allows replay after dedup window expires', async () => {
    (listWorkflowsByTrigger as jest.Mock).mockReturnValue([]);
    const body = { secret: 'top-secret', body: { old: true } };
    await fireWebhookWorkflows(body);
    const hashKey = [...syncStore.keys()].find((k) => k.startsWith('webhook_dedup:'));
    syncStore.set(hashKey!, String(Date.now() - 6 * 60 * 1000));
    const r = await fireWebhookWorkflows(body);
    expect(r.deduplicated).toBeFalsy();
  });
});
