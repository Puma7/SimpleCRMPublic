import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MASTER_KEY_BYTES = 32;
export const SECRET_ENVELOPE_ALGORITHM = 'xchacha20poly1305';

export type MasterKeyMaterial = {
  bytes: Buffer;
  keyId: string;
};

export type SecretEnvelopeMetadata = {
  algorithm: typeof SECRET_ENVELOPE_ALGORITHM;
  keyId: string;
  nonce: Buffer;
};

export function parseBase64MasterKey(input: string, keyId = 'default'): MasterKeyMaterial {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('SIMPLECRM_MASTER_KEY is required');
  }
  const bytes = Buffer.from(trimmed, 'base64');
  if (bytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`SIMPLECRM_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes`);
  }
  if (!keyId.trim()) {
    throw new Error('keyId is required');
  }
  return { bytes, keyId: keyId.trim() };
}

export function createSecretEnvelopeMetadata(key: MasterKeyMaterial): SecretEnvelopeMetadata {
  return {
    algorithm: SECRET_ENVELOPE_ALGORITHM,
    keyId: key.keyId,
    nonce: randomBytes(24),
  };
}

export function equalSecretBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Nicht-geheimer Fingerabdruck des Master-Keys.
 *
 * Wozu: Alle Secrets in der Datenbank sind mit diesem Schluessel verschluesselt,
 * der Schluessel selbst steht nur in der .env. Wird ein Dump mit der FALSCHEN
 * .env eingespielt, ist die Datenbank vollstaendig — nur entschluesseln kann
 * die Secrets niemand mehr. Erkennbar war das bisher nicht: die mitgefuehrte
 * key_id lautet in jeder Installation 'default', ein falscher Schluessel traegt
 * also dieselbe Kennung wie der richtige. Der Betrieb merkte es erst, wenn das
 * erste Postfach nicht mehr synchronisierte.
 *
 * Warum HMAC ueber ein festes Etikett und nicht ein Hash des Schluessels: Ein
 * blosser Hash waere ein Orakel — wer den Schluessel raten will, koennte
 * Kandidaten gegen den veroeffentlichten Wert pruefen. Beim HMAC ist der
 * Schluessel der SCHLUESSEL und der Klartext oeffentlich bekannt; aus dem
 * Ergebnis laesst sich ohne den Schluessel nichts ableiten, und Kandidaten
 * pruefen kostet genauso viel wie ihn direkt zu erraten (bei 32 zufaelligen
 * Byte: nichts, was jemand durchhaelt).
 *
 * Gekuerzt auf 16 Byte. Das reicht, um Verwechslungen zu erkennen — mehr soll
 * der Wert nicht leisten, und je kuerzer er ist, desto weniger traegt er.
 */
export const MASTER_KEY_FINGERPRINT_LABEL = 'simplecrm-master-key-fingerprint-v1';
export const MASTER_KEY_FINGERPRINT_BYTES = 16;

export function masterKeyFingerprint(key: MasterKeyMaterial): string {
  return createHmac('sha256', key.bytes)
    .update(MASTER_KEY_FINGERPRINT_LABEL, 'utf8')
    .digest('base64url')
    .slice(0, Math.ceil((MASTER_KEY_FINGERPRINT_BYTES * 4) / 3));
}

/**
 * Zeitkonstant, obwohl der Wert oeffentlich ist: er steht neben dem Chiffrat in
 * der Datenbank, und ein Vergleich, der frueh abbricht, ist eine Gewohnheit,
 * die man sich an der falschen Stelle nicht abgewoehnt.
 */
export function masterKeyFingerprintMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
