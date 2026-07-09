import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';

authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function buildTotpOtpAuthUri(input: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  return authenticator.keyuri(input.email, input.issuer ?? 'SimpleCRM', input.secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return authenticator.verify({ token: normalized, secret });
}
