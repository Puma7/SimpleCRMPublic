import type { Kysely } from 'kysely';

import { assertMasterKeyMatchesDatabase } from '../../packages/server/src/server';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  MASTER_KEY_FINGERPRINT_LABEL,
  masterKeyFingerprint,
  masterKeyFingerprintMatches,
  parseBase64MasterKey,
} from '../../packages/server/src/security/master-key';

const RICHTIG = parseBase64MasterKey(Buffer.alloc(32, 7).toString('base64'));
const FALSCH = parseBase64MasterKey(Buffer.alloc(32, 8).toString('base64'));

/**
 * Alle Secrets in der Datenbank sind mit dem Master-Key verschluesselt, der
 * Schluessel selbst steht nur in der .env. Ein Dump mit der falschen .env ergibt
 * eine vollstaendige und trotzdem unbrauchbare Datenbank — und das fiel bisher
 * erst auf, wenn das erste Postfach nicht mehr synchronisierte, also mitten im
 * Betrieb und ohne erkennbaren Zusammenhang zur Wiederherstellung. Die
 * mitgefuehrte key_id half nicht: sie lautet in jeder Installation 'default'.
 */
describe('Master-Key-Fingerabdruck', () => {
  test('haengt am Schluessel und unterscheidet verschiedene', () => {
    expect(masterKeyFingerprint(RICHTIG)).toBe(masterKeyFingerprint(RICHTIG));
    expect(masterKeyFingerprint(RICHTIG)).not.toBe(masterKeyFingerprint(FALSCH));
  });

  test('verraet den Schluessel nicht', () => {
    const fingerprint = masterKeyFingerprint(RICHTIG);
    // Weder das Schluesselmaterial in irgendeiner gaengigen Kodierung ...
    expect(fingerprint).not.toContain(RICHTIG.bytes.toString('base64').slice(0, 8));
    expect(fingerprint).not.toContain(RICHTIG.bytes.toString('hex').slice(0, 8));
    // ... noch ein blosser Hash des Schluessels, an dem sich Kandidaten pruefen
    // liessen. Es ist ein HMAC: der Schluessel ist der Schluessel, das Etikett
    // ist oeffentlich.
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    expect(fingerprint).not.toBe(createHash('sha256').update(RICHTIG.bytes).digest('base64url').slice(0, 22));
    expect(MASTER_KEY_FINGERPRINT_LABEL).toContain('v1');
  });

  test('vergleicht ohne Laengen- oder Inhaltsfalle', () => {
    const fingerprint = masterKeyFingerprint(RICHTIG);
    expect(masterKeyFingerprintMatches(fingerprint, fingerprint)).toBe(true);
    expect(masterKeyFingerprintMatches(fingerprint, masterKeyFingerprint(FALSCH))).toBe(false);
    expect(masterKeyFingerprintMatches(fingerprint, '')).toBe(false);
    expect(masterKeyFingerprintMatches(fingerprint, `${fingerprint}x`)).toBe(false);
  });
});

type FakeDbCalls = { inserted: Array<{ key_id: string; fingerprint: string }> };

/** Kysely-Ausschnitt, den assertMasterKeyMatchesDatabase tatsaechlich benutzt. */
function fakeDb(
  stored: { fingerprint: string } | undefined,
  options: { selectError?: Error } = {},
): { db: Kysely<ServerDatabase>; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { inserted: [] };
  const db = {
    selectFrom() {
      return {
        select() { return this; },
        where() { return this; },
        async executeTakeFirst() {
          if (options.selectError) throw options.selectError;
          return stored;
        },
      };
    },
    insertInto() {
      return {
        values(row: { key_id: string; fingerprint: string }) {
          calls.inserted.push(row);
          return this;
        },
        onConflict() { return this; },
        async execute() { return []; },
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, calls };
}

describe('Master-Key-Pruefung beim Serverstart', () => {
  test('legt den Fingerabdruck beim ersten Start an', async () => {
    const { db, calls } = fakeDb(undefined);
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([
      { key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) },
    ]);
  });

  test('laesst den passenden Schluessel durch, ohne erneut zu schreiben', async () => {
    const { db, calls } = fakeDb({ fingerprint: masterKeyFingerprint(RICHTIG) });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('bricht bei einem fremden Schluessel ab', async () => {
    const { db } = fakeDb({ fingerprint: masterKeyFingerprint(RICHTIG) });
    // Abbruch und nicht Warnung: weiterzulaufen hiesse, mit unlesbaren Secrets
    // zu arbeiten und dabei neue mit dem falschen Schluessel zu schreiben — aus
    // einem behebbaren Konfigurationsfehler wuerde ein Datenschaden.
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
  });

  test('haelt den Start nicht auf, wenn die Tabelle noch fehlt', async () => {
    // Migrationen laufen als eigener Dienst. Der Start darf nicht daran
    // haengen, dass ein Schema schon aktuell ist.
    const missingTable = Object.assign(new Error('relation "master_key_fingerprints" does not exist'), {
      code: '42P01',
    });
    const { db, calls } = fakeDb(undefined, { selectError: missingTable });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('bricht bei Verbindungs- oder Auth-Fehlern ab, statt den Schluessel ungeprueft durchzulassen', async () => {
    const connectionError = Object.assign(new Error('sorry, too many clients already'), {
      code: '53300',
    });
    const { db } = fakeDb(undefined, { selectError: connectionError });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).rejects.toThrow('too many clients already');
  });
});
