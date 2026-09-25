import { generateSecret, generateURI, verifySync } from 'otplib';

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function buildTotpOtpAuthUri(input: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  return generateURI({
    issuer: input.issuer ?? 'SimpleCRM',
    label: input.email,
    secret: input.secret,
  });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return verifySync({ token: normalized, secret, epochTolerance: 30 }).valid;
}

/**
 * The 30-second time step the code belongs to, or null when it does not verify.
 * A code stays valid for the whole tolerance window, so login must remember the
 * step it accepted to refuse the same code a second time (RFC 6238, 5.2).
 */
export function matchTotpTimeStep(secret: string, code: string): number | null {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  const result = verifySync({ token: normalized, secret, epochTolerance: 30 });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}
