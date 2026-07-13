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
