import { createHmac } from 'crypto';

import {
  SIGNATURE_HEADER,
  signWebhookBody,
  dispatchWebhookEvent,
  type WebhookDeps,
} from '../../electron/automation/webhooks';

// Phase C spike (plans/020). These tests drive the PURE signing helper and the
// INJECTED dispatcher only — every port (store, resolver, fetch, clock, sleep) is
// a fake/spy passed via WebhookDeps, so the suite never touches the DB, the
// network, keytar, or native modules. No jest.mock is needed: webhooks.ts reaches
// the DB only through a lazy `db()` seam that these tests never trigger.

type CapturedInit = Parameters<WebhookDeps['fetchImpl']>[1];

function baseDeps(overrides: Partial<WebhookDeps>): WebhookDeps {
  return {
    listSubscriptionsForEvent: () => [],
    assertUrlAllowed: async () => ({ addresses: ['93.184.216.34'] }),
    fetchImpl: async () => ({ ok: true, status: 200 }),
    recordDelivery: () => {},
    now: () => 0,
    maxAttempts: 3,
    baseBackoffMs: 0,
    ...overrides,
  };
}

describe('signWebhookBody', () => {
  test('is deterministic and reproducible by an independent HMAC-SHA256', () => {
    const body = JSON.stringify({ event: 'customer.created', data: { id: 1 } });
    const secret = 'whsec_test';
    const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

    expect(signWebhookBody(body, secret)).toBe(expected);
    // stable across calls
    expect(signWebhookBody(body, secret)).toBe(signWebhookBody(body, secret));
  });

  test('changes when the secret or the body changes', () => {
    const body = '{"a":1}';
    const sig = signWebhookBody(body, 's1');
    expect(signWebhookBody(body, 's2')).not.toBe(sig);
    expect(signWebhookBody('{"a":2}', 's1')).not.toBe(sig);
    expect(sig.startsWith('sha256=')).toBe(true);
  });
});

describe('dispatchWebhookEvent — happy path', () => {
  test('delivers once and pins + signs the exact bytes sent', async () => {
    const secret = 'whsec_happy';
    const addresses = ['93.184.216.34'];
    let captured: { url: string; init: CapturedInit } | undefined;
    const fetchImpl = jest.fn(async (url: string, init: CapturedInit) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    });
    const recordDelivery = jest.fn();

    await dispatchWebhookEvent(
      'customer.created',
      { id: 7 },
      baseDeps({
        listSubscriptionsForEvent: () => [{ id: 1, url: 'https://example.com/hook', secret }],
        assertUrlAllowed: async () => ({ addresses }),
        fetchImpl,
        recordDelivery,
      }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(recordDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 1, event: 'customer.created', status: 'delivered', attempts: 1 }),
    );

    // SSRF/transport discipline: manual redirect + pinned to the validated IPs.
    expect(captured?.init.redirect).toBe('manual');
    expect(captured?.init.pinnedAddresses).toEqual(addresses);
    expect(captured?.init.headers['content-type']).toBe('application/json');

    // Signature covers the EXACT bytes that were sent (sign-then-send).
    expect(captured?.init.headers[SIGNATURE_HEADER]).toBe(signWebhookBody(captured!.init.body, secret));
  });
});

describe('dispatchWebhookEvent — retry then dead-letter', () => {
  test('retries maxAttempts times, backs off between attempts, then dead-letters', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 }));
    const recordDelivery = jest.fn();
    const sleep = jest.fn(async () => {});

    await dispatchWebhookEvent(
      'deal.stage_changed',
      { dealId: 3 },
      baseDeps({
        listSubscriptionsForEvent: () => [{ id: 9, url: 'https://example.com/hook', secret: 's' }],
        fetchImpl,
        recordDelivery,
        maxAttempts: 3,
        baseBackoffMs: 10, // > 0 so backoff runs; sleep spy keeps it instant
        sleep,
      }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // backoff BEFORE next attempt: awaited (maxAttempts - 1) times, not after the last
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(recordDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 9, status: 'dead_letter', attempts: 3 }),
    );
    const arg = recordDelivery.mock.calls[0][0] as { lastError?: string };
    expect(arg.lastError).toContain('500');
  });
});

describe('dispatchWebhookEvent — SSRF rejection', () => {
  test('never calls fetch and dead-letters with the block reason when the URL is blocked', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
    const recordDelivery = jest.fn();

    await dispatchWebhookEvent(
      'customer.created',
      { id: 1 },
      baseDeps({
        listSubscriptionsForEvent: () => [{ id: 2, url: 'http://169.254.169.254/latest', secret: 's' }],
        assertUrlAllowed: async () => {
          throw new Error('blocked host');
        },
        fetchImpl,
        recordDelivery,
      }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 2, status: 'dead_letter', attempts: 3 }),
    );
    const arg = recordDelivery.mock.calls[0][0] as { lastError?: string };
    expect(arg.lastError).toContain('blocked host');
  });
});
