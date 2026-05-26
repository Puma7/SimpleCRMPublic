const store = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => store.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    store.set(key, value);
  },
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: jest.fn(() => [{ id: 1, enabled: 1 }]),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: jest.fn().mockResolvedValue({ status: 'ok', blocked: false }),
}));

import { fireWebhookWorkflows } from '../../electron/email/email-webhook';
import { serializeWebhookBodyForWorkflow } from '../../shared/webhook-body-serialize';

describe('fireWebhookWorkflows', () => {
  beforeEach(() => {
    store.clear();
    store.set('email_webhook_secret', 'secret');
  });

  it('deduplicates identical payload within window', async () => {
    const body = { x: 1 };
    const r1 = await fireWebhookWorkflows({ secret: 'secret', body });
    expect(r1.fired).toBe(1);

    const r2 = await fireWebhookWorkflows({ secret: 'secret', body });
    expect(r2.deduplicated).toBe(true);
    expect(r2.fired).toBe(0);
  });

  it('returns error string when workflow fails', async () => {
    const { executeWorkflowForTrigger } = await import('../../electron/workflow/workflow-executor');
    (executeWorkflowForTrigger as jest.Mock).mockResolvedValueOnce({
      status: 'error',
      blocked: false,
      log: ['boom'],
    });

    const r = await fireWebhookWorkflows({ secret: 'secret', body: { unique: Date.now() } });
    expect(r.error).toContain('boom');
  });
});

describe('serializeWebhookBodyForWorkflow', () => {
  it('returns valid JSON when under limit', () => {
    const json = serializeWebhookBodyForWorkflow({ a: 1 });
    expect(JSON.parse(json)).toEqual({ a: 1 });
  });
});
