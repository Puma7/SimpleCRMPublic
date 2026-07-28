import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
 * Fingerabdruck des Master-Keys — ein Pruefer, kein Geheimnis, aber auch nichts
 * Harmloses.
 *
 * Wozu: Alle Secrets in der Datenbank sind mit diesem Schluessel verschluesselt,
 * der Schluessel selbst steht nur in der .env. Wird ein Dump mit der FALSCHEN
 * .env eingespielt, ist die Datenbank vollstaendig — nur entschluesseln kann
 * die Secrets niemand mehr. Erkennbar war das bisher nicht: die mitgefuehrte
 * key_id lautet in jeder Installation 'default', ein falscher Schluessel traegt
 * also dieselbe Kennung wie der richtige. Der Betrieb merkte es erst, wenn das
 * erste Postfach nicht mehr synchronisierte.
 *
 * Warum das Etikett der Klartext ist und der Schluessel der Schluessel: ein
 * blosser SHA-256 des Schluessels waere derselbe Wert fuer jede Installation
 * mit demselben Schluessel und liesse sich in fertigen Tabellen nachschlagen.
 *
 * Und warum das allein NICHT genuegt: die erste Fassung hier behauptete, der
 * Wert sei „nicht geheim", weil ein HMAC ohne Schluessel nichts preisgibt. Das
 * stimmt nur, solange der Schluessel wirklich zufaellig ist. Wer stattdessen
 * eine Passphrase base64-kodiert — die Laengenpruefung unten laesst das durch —,
 * dem ist mit dem veroeffentlichten Wert genau das Offline-Orakel gegeben, das
 * hier ausgeschlossen sein sollte: fuer jeden Kandidaten einmal rechnen und
 * vergleichen. Der Wert steht in den Backup-Metadaten und in der
 * Restore-Ausgabe, also ausserhalb der Datenbank, die er schuetzen hilft.
 *
 * Deshalb ist die Ableitung ABSICHTLICH teuer (scrypt, ~100 ms je Kandidat
 * statt ~1 us). Das macht aus einem Wortlisten-Durchlauf von Sekunden einen von
 * Wochen; ein 32-Byte-Zufallsschluessel bleibt ohnehin unerreichbar. Einmal je
 * Serverstart ist das nicht spuerbar. Zusaetzlich weist die
 * Produktionskonfiguration Schluessel ab, die erkennbar aus Text bestehen —
 * teuer machen ist Schadensbegrenzung, nicht Ersatz fuer einen zufaelligen
 * Schluessel.
 *
 * Gekuerzt auf 16 Byte. Das reicht, um Verwechslungen zu erkennen — mehr soll
 * der Wert nicht leisten, und je kuerzer er ist, desto weniger traegt er.
 */
export const MASTER_KEY_FINGERPRINT_LABEL = 'simplecrm-master-key-fingerprint-v3';
export const MASTER_KEY_FINGERPRINT_BYTES = 16;
export const MASTER_KEY_FINGERPRINT_SALT_BYTES = 16;

/**
 * Ein Zufallssalt je Installation, gespeichert neben dem Fingerabdruck.
 *
 * Mit dem festen Etikett allein waere der Salt global: derselbe Schluessel
 * ergaebe ueberall denselben veroeffentlichten Wert. Ein Angreifer koennte
 * Kandidaten einmal durchrechnen und gegen beliebig viele fremde
 * Backup-Metadaten halten — und nebenbei erkennen, wo derselbe Schluessel
 * zweimal benutzt wurde. Mit eigenem Salt gilt jede Rechnung nur fuer eine
 * Installation.
 */
export function newMasterKeyFingerprintSalt(): string {
  return randomBytes(MASTER_KEY_FINGERPRINT_SALT_BYTES).toString('base64url');
}

/**
 * scrypt-Parameter. N=2^15, r=8, p=1 braucht rund 32 MiB und ~100 ms — der
 * uebliche „interaktive" Punkt. maxmem muss ausdruecklich hoeher stehen als der
 * Bedarf (128*N*r), sonst lehnt Node genau diese Parameter ab.
 */
const FINGERPRINT_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;

export function masterKeyFingerprint(key: MasterKeyMaterial, salt: string): string {
  if (!salt.trim()) throw new Error('master key fingerprint salt is required');
  const derived = scryptSync(
    key.bytes,
    `${MASTER_KEY_FINGERPRINT_LABEL}\0${salt}`,
    MASTER_KEY_FINGERPRINT_BYTES,
    FINGERPRINT_SCRYPT,
  );
  return derived.toString('base64url');
}

/**
 * Sieht dieser Schluessel nach Text aus statt nach Zufall?
 *
 * Was das ist und was nicht: ein Stolperdraht gegen das Versehen — jemand
 * schreibt eine Passphrase in die .env, weil 32 Zeichen eben 32 Byte sind —,
 * KEINE Sicherheitsgrenze. Aus 32 Byte laesst sich Entropie nicht messen; wer
 * einen schwachen Schluessel unbedingt durchbringen will, findet immer eine
 * Form, die hier durchgeht. Was den Schaden begrenzt, ist die teure Ableitung
 * des Fingerabdrucks (scrypt) — diese Pruefung faengt nur die Faelle ab, die
 * aus Bequemlichkeit entstehen, und zwar frueh.
 *
 * Drei Merkmale, jedes fuer sich bei echtem Zufall praktisch ausgeschlossen:
 *
 * - lauter gleiche Bytes;
 * - ausschliesslich druckbares ASCII ((95/256)^32, jenseits von 10^-13);
 * - zu wenige verschiedene Bytewerte. Das faengt die Faelle, die an den
 *   ersten beiden vorbeikommen — 'a' 31-mal plus ein Zeilenumbruch ist weder
 *   ein einziges Byte noch reines ASCII, hat aber zwei Werte. Bei 32
 *   Zufallsbytes liegt der Erwartungswert bei rund 30 verschiedenen Werten;
 *   unter 16 zu fallen ist so unwahrscheinlich, dass es kein Fehlalarm ist.
 */
const MASTER_KEY_MIN_DISTINCT_BYTES = 16;

export function masterKeyLooksGuessable(bytes: Buffer): boolean {
  if (bytes.length === 0) return true;
  if (bytes.every((byte) => byte === bytes[0])) return true;
  if (bytes.every((byte) => byte >= 0x20 && byte <= 0x7e)) return true;
  return new Set(bytes).size < MASTER_KEY_MIN_DISTINCT_BYTES;
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
