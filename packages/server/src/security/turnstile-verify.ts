export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; error: string };

export async function verifyTurnstileToken(input: {
  secretKey: string;
  token: string;
  ip?: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileVerifyResult> {
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'captcha_token_missing' };

  const body = new URLSearchParams({
    secret: input.secretKey,
    response: token,
  });
  if (input.ip?.trim()) body.set('remoteip', input.ip.trim());

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    return { ok: false, error: 'captcha_provider_unavailable' };
  }

  const payload = await response.json() as { success?: boolean; 'error-codes'?: string[] };
  if (payload.success) return { ok: true };
  const codes = Array.isArray(payload['error-codes']) ? payload['error-codes'].join(',') : 'unknown';
  return { ok: false, error: codes || 'captcha_failed' };
}
