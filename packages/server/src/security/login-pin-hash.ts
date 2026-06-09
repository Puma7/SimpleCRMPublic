import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { assertLoginPinFormat } from '@simplecrm/core';

const scrypt = promisify(scryptCallback);
const LOGIN_PIN_HASH_PREFIX = 'scrypt-pin:v1';

export async function hashLoginPin(pin: string): Promise<string> {
  assertLoginPinFormat(pin);
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, 32) as Buffer;
  return `${LOGIN_PIN_HASH_PREFIX}:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export async function verifyLoginPin(pin: string, pinHash: string | null | undefined): Promise<boolean> {
  if (!pinHash || !pin) return false;
  const parts = pinHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt-pin' || parts[1] !== 'v1') return false;
  const [, , saltPart, hashPart] = parts;
  if (!saltPart || !hashPart) return false;
  try {
    const salt = Buffer.from(saltPart, 'base64url');
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scrypt(pin, salt, expected.length) as Buffer;
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
