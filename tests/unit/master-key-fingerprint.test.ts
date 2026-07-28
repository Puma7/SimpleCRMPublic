import type { Kysely } from 'kysely';

import { assertMasterKeyMatchesDatabase } from '../../packages/server/src/server';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { randomBytes } from 'node:crypto';

import {
  MASTER_KEY_FINGERPRINT_LABEL,
  masterKeyFingerprint,
  masterKeyFingerprintMatches,
  masterKeyLooksGuessable,
  parseBase64MasterKey,
} from '../../packages/server/src/security/master-key';
import { encryptSecretValue } from '../../packages/server/src/security/secret-envelope';

// Feste, aber zufaellig AUSSEHENDE Schluessel: 32 verschiedene Bytewerte,
// nicht druckbar. Buffer.alloc(32, 7) waere bequemer — genau solche Schluessel
// weist der Start seit der Entropie-Pruefung aber ab, und diese Tests handeln
// vom Fingerabdruck, nicht davon.
const RICHTIG = parseBase64MasterKey(
  Buffer.from(Array.from({ length: 32 }, (_unused, index) => index)).toString('base64'),
);
const FALSCH = parseBase64MasterKey(
  Buffer.from(Array.from({ length: 32 }, (_unused, index) => 255 - index)).toString('base64'),
);

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
    expect(MASTER_KEY_FINGERPRINT_LABEL).toMatch(/-v\d+$/);
  });

  test('ist absichtlich teuer abzuleiten', () => {
    // Die Begruendung "nicht geheim, weil HMAC" traegt nur bei einem wirklich
    // zufaelligen Schluessel. Wer eine Passphrase base64-kodiert, dem waere der
    // veroeffentlichte Wert genau das Orakel, das hier ausgeschlossen sein
    // soll: je Kandidat einmal rechnen und vergleichen. Mit scrypt kostet ein
    // Kandidat rund 100 ms statt einer Mikrosekunde — aus Sekunden werden
    // Wochen. Gemessen wird grosszuegig, der Test soll die Absicht festhalten
    // und nicht die Maschine benoten.
    const started = process.hrtime.bigint();
    masterKeyFingerprint(FALSCH);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeGreaterThan(10);
  });

  test('weist Schluessel ab, die nach Text statt nach Zufall aussehen', () => {
    // 32 Zeichen Text sind 32 Byte — die Laengenpruefung allein laesst eine
    // base64-kodierte Passphrase durch.
    expect(masterKeyLooksGuessable(Buffer.from('correct-horse-battery-staple-1234'.slice(0, 32), 'utf8')))
      .toBe(true);
    expect(masterKeyLooksGuessable(Buffer.alloc(32, 7))).toBe(true); // lauter gleiche Byte
    // Die Fassung davor liess das hier durch: weder ein einziges Byte noch
    // reines ASCII — aber zwei verschiedene Werte.
    expect(masterKeyLooksGuessable(Buffer.from(`${'a'.repeat(31)}\n`, 'utf8'))).toBe(true);
    expect(masterKeyLooksGuessable(RICHTIG.bytes)).toBe(false);
    expect(masterKeyLooksGuessable(randomBytes(32))).toBe(false);
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
type SecretRow = Record<string, unknown>;
type FakeDbCalls = { inserted: StoredRow[]; selects: number };

/** Ein echtes Envelope, damit die Probeentschluesselung etwas zu tun hat. */
async function secretRow(key: typeof RICHTIG): Promise<SecretRow> {
  const associatedData = { workspaceId: 'w-1', kind: 'imap', name: 'probe' };
  const envelope = await encryptSecretValue({ key, value: 'geheim', associatedData });
  return {
    id: 's-1',
    workspace_id: associatedData.workspaceId,
    kind: associatedData.kind,
    name: associatedData.name,
    key_id: envelope.keyId,
    algorithm: envelope.algorithm,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  };
}

/**
 * Kysely-Ausschnitt, den assertMasterKeyMatchesDatabase tatsaechlich benutzt:
 * ein `select` ueber die Fingerabdruecke, ein `insert ... on conflict do
 * nothing` mit anschliessendem Nachlesen, und — in einer Transaktion mit
 * gelockerter RLS-Sitzung — ein Blick in `secrets`.
 *
 * `selectThrows` bekommt einen fertigen Fehler statt eines Schalters: der
 * Unterschied zwischen "Tabelle fehlt" und "Datenbank nicht erreichbar" ist
 * genau der, um den es hier geht.
 */
function fakeDb(
  stored: StoredRow[],
  options: {
    selectThrows?: unknown;
    insertLosesRace?: StoredRow;
    secrets?: SecretRow[];
  } = {},
): { db: Kysely<ServerDatabase>; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { inserted: [], selects: 0 };
  const rows = [...stored];
  const secrets = options.secrets ?? [];

  const selectBuilder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const matching = () => secrets.filter(
      (row) => filters.every(([column, value]) => row[column] === value),
    );
    return {
      select() { return this; },
      selectAll() { return this; },
      distinct() { return this; },
      limit() { return this; },
      where(column: string, _op: string, value: unknown) {
        filters.push([column, value]);
        return this;
      },
      async execute() {
        calls.selects += 1;
        if (options.selectThrows) throw options.selectThrows;
        return table === 'secrets' ? matching() : rows;
      },
      async executeTakeFirst() {
        calls.selects += 1;
        if (options.selectThrows) throw options.selectThrows;
        if (table === 'secrets') return matching()[0];
        const keyId = filters.find(([column]) => column === 'key_id')?.[1];
        return rows.find((row) => row.key_id === keyId);
      },
    };
  };

  const db = {
    selectFrom(table: string) { return selectBuilder(table); },
    transaction() {
      return {
        async execute<T>(operation: (trx: unknown) => Promise<T>): Promise<T> {
          return operation({
            selectFrom(table: string) { return selectBuilder(table); },
            // Die RLS-Sitzung wird ueber sql`` gesetzt; der kysely-Mock braucht
            // dafuer nur einen Executor, der nichts zurueckgibt.
            getExecutor: () => ({ executeQuery: async () => ({ rows: [] }) }),
          });
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

  test('weist einen ratbaren Schluessel ab, solange nichts daran haengt', async () => {
    // Frische Datenbank: kein Eintrag, kein Secret. Der letzte Moment, in dem
    // sich ein solcher Schluessel folgenlos ersetzen laesst.
    const schwach = parseBase64MasterKey(Buffer.alloc(32, 3).toString('base64'));
    const { db, calls } = fakeDb([]);
    await expect(assertMasterKeyMatchesDatabase(db, schwach))
      .rejects.toThrow('does not look like random key material');
    expect(calls.inserted).toEqual([]);
  });

  test('haelt eine bestehende Installation mit ratbarem Schluessel nicht an', async () => {
    // Sie kaeme sonst nirgendwo hin: mit dem alten Schluessel duerfte sie nicht
    // starten, und ein neuer macht jedes gespeicherte Secret unlesbar — ein
    // Umschluesseln im Betrieb gibt es nicht. Die Warnung steht in der
    // Konfiguration, der Abbruch nur dort, wo er folgenlos ist.
    const schwach = parseBase64MasterKey(Buffer.alloc(32, 3).toString('base64'));
    const { db } = fakeDb([
      { key_id: 'default', fingerprint: masterKeyFingerprint(schwach) },
    ]);
    await expect(assertMasterKeyMatchesDatabase(db, schwach)).resolves.toBeUndefined();
  });

  test('laesst eine frische Installation ohne Schluessel starten', async () => {
    // Leere Tabelle UND keine Secrets = es gibt nichts, was unlesbar werden
    // koennte.
    const { db, calls } = fakeDb([]);
    await expect(assertMasterKeyMatchesDatabase(db, undefined)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });
});

/**
 * Migration 0049 legt die Tabelle ohne Backfill an, und ein Dump von vorher
 * bringt sie leer mit. Eine leere Tabelle beweist also NICHT, dass die
 * Datenbank frisch ist — und das ist genau der Fall, um den es geht: ein
 * pre-0049-Dump, eingespielt mit der falschen .env.
 */
describe('leere Tabelle, aber die Datenbank ist es nicht', () => {
  test('der richtige Schluessel bewaehrt sich an einem Secret und wird hinterlegt', async () => {
    const { db, calls } = fakeDb([], { secrets: [await secretRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([
      { key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG) },
    ]);
  });

  test('der falsche Schluessel wird abgewiesen, statt sich als Wahrheit einzutragen', async () => {
    // Ohne die Probeentschluesselung wuerde hier der falsche Fingerabdruck
    // hinterlegt — und der richtige Schluessel spaeter abgewiesen. Aus einem
    // behebbaren Fehler wuerde ein dauerhafter.
    const { db, calls } = fakeDb([], { secrets: [await secretRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toEqual([]);
  });

  test('ohne Schluessel ist Schluss, sobald ueberhaupt Secrets da sind', async () => {
    const { db } = fakeDb([], { secrets: [await secretRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, undefined))
      .rejects.toThrow('SIMPLECRM_MASTER_KEY is not set');
  });

  test('nicht probierbare Secrets brechen den Start ab', async () => {
    // Fremde key_id: der konfigurierte Schluessel kann hier definitiv nichts
    // lesen — die Entschluesselung prueft die key_id, bevor sie anfaengt. Nur zu
    // warnen hiesse: API laeuft, schreibt neue Secrets mit dem konfigurierten
    // Schluessel daneben, und weil nie ein Fingerabdruck entsteht, bleibt es bei
    // der Warnung. Dauerhaft zwei Schluessel in einer Datenbank.
    const fremd = { ...await secretRow(RICHTIG), key_id: 'anderer' };
    const { db, calls } = fakeDb([], { secrets: [fremd] });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG))
      .rejects.toThrow('secrets that were not written with key id "default"');
    expect(calls.inserted).toEqual([]);
  });

  test('auch wenn daneben lesbare Secrets liegen', async () => {
    // Gemischt, etwa nach einer halb durchgefuehrten Rotation. Die erste
    // passende Zeile gewinnen zu lassen hiesse: Fingerabdruck hinterlegt,
    // kuenftige Starts vergleichen nur noch ihn, und die unlesbaren Zeilen
    // sieht nie wieder jemand an — waehrend readSecret im Betrieb ueber sie
    // stolpert.
    const lesbar = await secretRow(RICHTIG);
    const fremd = { ...await secretRow(RICHTIG), id: 's-2', key_id: 'ehemalig' };
    const { db, calls } = fakeDb([], { secrets: [lesbar, fremd] });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG))
      .rejects.toThrow('key id "ehemalig"');
    expect(calls.inserted).toEqual([]);
  });

  test('die Fehlermeldung nennt einen Weg, der auch funktioniert', async () => {
    // Nur die Fingerabdruck-Zeile zu loeschen genuegt nicht: die alten Secrets
    // liegen weiter da und weisen den naechsten Start erneut ab. Wer der
    // Meldung folgt, muss danach wirklich starten koennen.
    const { db } = fakeDb([], { secrets: [await secretRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow(/DELETE FROM secrets/);
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow(/alone is not enough/);
  });
});
