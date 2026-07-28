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

type StoredRow = { key_id: string; fingerprint: string };
type FakeDbCalls = { inserted: StoredRow[]; selects: number };

/**
 * Kysely-Ausschnitt, den assertMasterKeyMatchesDatabase tatsaechlich benutzt:
 * ein `select` ueber alle Zeilen, ein `insert ... on conflict do nothing`, und
 * danach ein gezieltes Nachlesen einer key_id.
 *
 * `selectThrows` bekommt einen fertigen Fehler statt eines Schalters — der
 * Unterschied zwischen "Tabelle fehlt" und "Datenbank nicht erreichbar" ist
 * genau der, um den es hier geht.
 */
function fakeDb(
  stored: StoredRow[],
  options: { selectThrows?: unknown; insertLosesRace?: StoredRow } = {},
): { db: Kysely<ServerDatabase>; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { inserted: [], selects: 0 };
  const rows = [...stored];
  const db = {
    selectFrom() {
      let keyId: string | undefined;
      return {
        select() { return this; },
        where(_column: string, _op: string, value: string) { keyId = value; return this; },
        async execute() {
          calls.selects += 1;
          if (options.selectThrows) throw options.selectThrows;
          return rows;
        },
        async executeTakeFirst() {
          calls.selects += 1;
          if (options.selectThrows) throw options.selectThrows;
          return rows.find((row) => row.key_id === keyId);
        },
      };
    },
    insertInto() {
      let pending: StoredRow | undefined;
      return {
        values(row: StoredRow) { pending = row; return this; },
        onConflict() { return this; },
        async execute() {
          if (!pending) return [];
          calls.inserted.push(pending);
          // Die andere Instanz war zwischen unserem Lesen und unserem Schreiben
          // da — genau das Zeitfenster, in dem `do nothing` stillschweigend
          // nichts tut.
          if (options.insertLosesRace) rows.push(options.insertLosesRace);
          // on conflict do nothing: ein bereits vorhandener Wert bleibt stehen.
          else if (!rows.some((row) => row.key_id === pending?.key_id)) rows.push(pending);
          return [];
        },
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, calls };
}

function missingTableError(): Error & { code: string } {
  return Object.assign(
    new Error('relation "master_key_fingerprints" does not exist'),
    { code: '42P01' },
  );
}

describe('Master-Key-Pruefung beim Serverstart', () => {
  test('legt den Fingerabdruck beim ersten Start an', async () => {
    const { db, calls } = fakeDb([]);
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([
      { key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) },
    ]);
  });

  test('laesst den passenden Schluessel durch, ohne erneut zu schreiben', async () => {
    const { db, calls } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) }]);
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('bricht bei einem fremden Schluessel ab', async () => {
    const { db } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) }]);
    // Abbruch und nicht Warnung: weiterzulaufen hiesse, mit unlesbaren Secrets
    // zu arbeiten und dabei neue mit dem falschen Schluessel zu schreiben — aus
    // einem behebbaren Konfigurationsfehler wuerde ein Datenschaden.
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
  });

  test('erkennt den fremden Schluessel auch, wenn der Einfuegeversuch im Konflikt endet', async () => {
    // Zwei Instanzen starten gleichzeitig, die andere war zuerst da: das
    // `on conflict do nothing` schreibt nichts und meldet auch nichts. Ohne das
    // Nachlesen waere ausgerechnet der Fall ungeprueft durchgegangen, fuer den
    // die Pruefung existiert.
    const { db, calls } = fakeDb([], {
      insertLosesRace: { key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) },
    });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toHaveLength(1);
  });

  test('haelt den Start nicht auf, wenn die Tabelle noch fehlt', async () => {
    // Migrationen laufen als eigener Dienst. Der Start darf nicht daran
    // haengen, dass ein Schema schon aktuell ist.
    const { db, calls } = fakeDb([], { selectThrows: missingTableError() });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('reicht jeden anderen Datenbankfehler durch', async () => {
    // Der gefaehrliche Fall: ein nacktes catch haette einen Verbindungsabbruch,
    // ein rotiertes PG_PASSWORD oder `too many clients` wie einen legitimen
    // Erststart behandelt — der Start liefe weiter, und die Pruefung waere
    // stillschweigend nie gelaufen.
    for (const failure of [
      Object.assign(new Error('too many clients already'), { code: '53300' }),
      Object.assign(new Error('password authentication failed'), { code: '28P01' }),
      new Error('connection terminated unexpectedly'),
    ]) {
      const { db, calls } = fakeDb([], { selectThrows: failure });
      await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).rejects.toThrow(failure.message);
      expect(calls.inserted).toEqual([]);
    }
  });

  test('bricht ab, wenn der Schluessel fehlt und die Datenbank schon einen kennt', async () => {
    // Derselbe Fehler andersherum: die Secrets hier sind mit einem Schluessel
    // verschluesselt, der jetzt nicht mehr gesetzt ist. Weiterzulaufen hiesse,
    // auf unlesbaren Secrets zu arbeiten.
    const { db } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) }]);
    await expect(assertMasterKeyMatchesDatabase(db, undefined))
      .rejects.toThrow('SIMPLECRM_MASTER_KEY is not set');
  });

  test('laesst eine frische Installation ohne Schluessel starten', async () => {
    // Leere Tabelle = es gibt noch keine Secrets, die unlesbar werden koennten.
    const { db, calls } = fakeDb([]);
    await expect(assertMasterKeyMatchesDatabase(db, undefined)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });
});
