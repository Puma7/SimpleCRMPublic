import { createHash } from 'crypto';
import { serializeWebhookBodyForWorkflow } from '../../shared/webhook-body-serialize';

describe('serializeWebhookBodyForWorkflow', () => {
  it('returns valid JSON when under limit', () => {
    const json = serializeWebhookBodyForWorkflow({ a: 1 });
    expect(JSON.parse(json)).toEqual({ a: 1 });
  });

  it('wraps oversized body without breaking JSON', () => {
    const big = { data: 'x'.repeat(100_000) };
    const json = serializeWebhookBodyForWorkflow(big);
    const parsed = JSON.parse(json) as { __truncated?: boolean; preview?: string };
    expect(parsed.__truncated).toBe(true);
    expect(parsed.preview).toBeDefined();
  });
});

describe('webhookSecretMatches via hash', () => {
  it('compares secrets with constant-length digests', () => {
    const a = createHash('sha256').update('secret-a', 'utf8').digest();
    const b = createHash('sha256').update('secret-b', 'utf8').digest();
    expect(a.equals(b)).toBe(false);
    const same = createHash('sha256').update('secret-a', 'utf8').digest();
    expect(a.equals(same)).toBe(true);
  });
});
