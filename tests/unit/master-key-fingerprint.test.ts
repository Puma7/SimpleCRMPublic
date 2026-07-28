import type { Kysely } from 'kysely';

import { assertMasterKeyMatchesDatabase } from '../../packages/server/src/server';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { randomBytes } from 'node:crypto';

import {
  MASTER_KEY_FINGERPRINT_LABEL,
  masterKeyFingerprint,
  masterKeyFingerprintMatches,
  masterKeyLooksGuessable,
  newMasterKeyFingerprintSalt,
  parseBase64MasterKey,
} from '../../packages/server/src/security/master-key';
import { encryptSecretValue } from '../../packages/server/src/security/secret-envelope';
import {
  createEmailTrackingCrypto,
  emailTrackingEventAssociatedData,
  emailTrackingLinkAssociatedData,
} from '../../packages/server/src/email-tracking';

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
/** Fester Salt in den Tests; im Betrieb ist er je Installation zufaellig. */
const SALT = 'test-salt-fest';

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
    expect(masterKeyFingerprint(RICHTIG, SALT)).toBe(masterKeyFingerprint(RICHTIG, SALT));
    expect(masterKeyFingerprint(RICHTIG, SALT)).not.toBe(masterKeyFingerprint(FALSCH, SALT));
  });

  test('verraet den Schluessel nicht', () => {
    const fingerprint = masterKeyFingerprint(RICHTIG, SALT);
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
    masterKeyFingerprint(FALSCH, SALT);
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

  test('haengt am Salt: derselbe Schluessel, zwei Installationen, zwei Werte', () => {
    // Mit dem festen Etikett als einzigem Salt waere der Wert global: einmal
    // rechnen, gegen beliebig viele fremde Backup-Metadaten halten — und
    // nebenbei sehen, wo derselbe Schluessel zweimal benutzt wurde.
    const a = newMasterKeyFingerprintSalt();
    const b = newMasterKeyFingerprintSalt();
    expect(a).not.toBe(b);
    expect(masterKeyFingerprint(RICHTIG, a)).not.toBe(masterKeyFingerprint(RICHTIG, b));
    expect(() => masterKeyFingerprint(RICHTIG, '')).toThrow('salt is required');
  });

  test('vergleicht ohne Laengen- oder Inhaltsfalle', () => {
    const fingerprint = masterKeyFingerprint(RICHTIG, SALT);
    expect(masterKeyFingerprintMatches(fingerprint, fingerprint)).toBe(true);
    expect(masterKeyFingerprintMatches(fingerprint, masterKeyFingerprint(FALSCH, SALT))).toBe(false);
    expect(masterKeyFingerprintMatches(fingerprint, '')).toBe(false);
    expect(masterKeyFingerprintMatches(fingerprint, `${fingerprint}x`)).toBe(false);
  });
});

type StoredRow = { key_id: string; fingerprint: string; salt: string };
type SecretRow = Record<string, unknown>;
type FakeDbCalls = { inserted: StoredRow[]; selects: number };

/** Ein echtes Envelope, damit die Probeentschluesselung etwas zu tun hat. */
async function secretRow(key: typeof RICHTIG, name = 'probe'): Promise<SecretRow> {
  const associatedData = { workspaceId: 'w-1', kind: 'imap', name };
  const envelope = await encryptSecretValue({ key, value: 'geheim', associatedData });
  return {
    id: `s-${name}`,
    workspace_id: associatedData.workspaceId,
    kind: associatedData.kind,
    name: associatedData.name,
    key_id: envelope.keyId,
    algorithm: envelope.algorithm,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  };
}

/** Ebenso fuer das Tracking: dieselbe Versiegelung, die die Anwendung schreibt. */
function trackingLinkRow(key: typeof RICHTIG, id = 'l-1'): Record<string, unknown> {
  const sealed = createEmailTrackingCrypto(key.bytes).sealJson(
    { url: 'https://example.com' },
    emailTrackingLinkAssociatedData('w-1', 't-1', id),
  );
  return {
    workspace_id: 'w-1',
    tracking_message_id: 't-1',
    id,
    target_ciphertext: sealed.ciphertext,
    target_nonce: sealed.nonce,
    target_auth_tag: sealed.authTag,
  };
}

/** Und fuer eine Resolver-Zeile: der Hash haengt am Tracking-Token. */
function trackingTokenRow(key: typeof RICHTIG, kind: 'open' | 'click' = 'open'): Record<string, unknown> {
  const crypto = createEmailTrackingCrypto(key.bytes);
  const id = kind === 'open' ? 't-1' : 'l-1';
  return {
    token_hash: crypto.tokenHash(crypto.token(kind, id)),
    tracking_message_id: 't-1',
    link_id: kind === 'open' ? null : 'l-1',
    token_kind: kind,
  };
}

/** Und fuer ein Tracking-Ereignis mit Roh-Metadaten. */
function trackingEventRow(key: typeof RICHTIG, dedupeKey = 'd-1'): Record<string, unknown> {
  const sealed = createEmailTrackingCrypto(key.bytes).sealJson(
    { ip: '203.0.113.9' },
    emailTrackingEventAssociatedData('w-1', 't-1', dedupeKey),
  );
  return {
    workspace_id: 'w-1',
    tracking_message_id: 't-1',
    dedupe_key: dedupeKey,
    raw_metadata_ciphertext: sealed.ciphertext,
    raw_metadata_nonce: sealed.nonce,
    raw_metadata_auth_tag: sealed.authTag,
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
    trackingLinks?: Array<Record<string, unknown>>;
    trackingEvents?: Array<Record<string, unknown>>;
    trackingTokens?: Array<Record<string, unknown>>;
    /** Ereignisse OHNE versiegelte Rohdaten — nur ueber die Zeilenzahl sichtbar. */
    plainEvents?: number;
    fingerprintTableMissing?: boolean;
  } = {},
): { db: Kysely<ServerDatabase>; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { inserted: [], selects: 0 };
  const rows = [...stored];
  const secrets = options.secrets ?? [];

  const selectBuilder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const matching = () => secrets.filter(
      (row) => filters
        .filter(([column]) => column !== 'id')
        .every(([column, value]) => row[column] === value),
    );
    return {
      select() { return this; },
      selectAll() { return this; },
      distinct() { return this; },
      orderBy() { return this; },
      limit() { return this; },
      where(column: string, _op: string, value: unknown) {
        filters.push([column, value]);
        return this;
      },
      async execute() {
        calls.selects += 1;
        if (options.selectThrows) throw options.selectThrows;
        if (table === 'secrets') {
          // Seitenweise: `id > after` filtert, damit die zweite Seite leer ist
          // und die Schleife im Code terminiert.
          const after = filters.find(([column]) => column === 'id')?.[1];
          const page = matching();
          return after === undefined || after === ''
            ? page
            : page.filter((row) => String(row.id) > String(after));
        }
        if (table === 'email_tracking_links') return options.trackingLinks ?? [];
        if (table === 'email_tracking_events') {
          // Die Ex-post-Frage "gibt es ueberhaupt Ereignisse?" laeuft ueber den
          // Query-Builder, die Suche nach versiegelten ueber rohes SQL.
          const plain = Array.from({ length: options.plainEvents ?? 0 }, () => ({ id: 1 }));
          return [...(options.trackingEvents ?? []), ...plain];
        }
        if (table === 'email_tracking_token_resolver') return options.trackingTokens ?? [];
        if (table === 'master_key_fingerprints' && options.fingerprintTableMissing) {
          throw Object.assign(new Error('relation "master_key_fingerprints" does not exist'), { code: '42P01' });
        }
        return rows;
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

  const db: Record<string, unknown> = {
    selectFrom(table: string) { return selectBuilder(table); },
    transaction() {
      return {
        // Die Sperre und die RLS-Sitzung laufen ueber sql``; der kysely-Mock
        // braucht dafuer nur einen Executor, der nichts zurueckgibt.
        async execute<T>(operation: (trx: unknown) => Promise<T>): Promise<T> {
          return operation({
            ...db,
            getExecutor: () => ({
              executeQuery: async (compiled: { sql: string }) => ({
                // Die Ereignis-Probe laeuft als rohes SQL (Fenster ueber die
                // juengsten Zeilen, dann Filter) — der Mock beantwortet sie
                // anhand des Anweisungstexts.
                rows: compiled.sql.includes('email_tracking_events')
                  ? (options.trackingEvents ?? [])
                  : [],
              }),
            }),
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
  };
  return { db: db as unknown as Kysely<ServerDatabase>, calls };
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
    expect(calls.inserted).toHaveLength(1);
    const eingetragen = calls.inserted[0]!;
    expect(eingetragen.key_id).toBe('default');
    // Der Salt entsteht zufaellig; nachgerechnet wird mit dem, der eingetragen
    // wurde.
    expect(eingetragen.fingerprint).toBe(masterKeyFingerprint(RICHTIG, eingetragen.salt));
  });

  test('laesst den passenden Schluessel durch, ohne erneut zu schreiben', async () => {
    const { db, calls } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG, SALT), salt: SALT }]);
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('bricht bei einem fremden Schluessel ab', async () => {
    const { db } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG, SALT), salt: SALT }]);
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
      insertLosesRace: { key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG, SALT), salt: SALT },
    });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toHaveLength(1);
  });

  test('leere Datenbank ohne Fingerabdruck-Tabelle: Start verweigert', async () => {
    // Frueher lief der Start hier einfach durch ("Migrationen sind ein eigener
    // Dienst"). Nur: ohne die Tabelle laesst sich der Schluessel nicht
    // festlegen, und ohne Daten gibt es auch nichts zu proben. Zwei Replikate
    // mit verschiedenen Schluesseln kaemen nacheinander durch und schrieben
    // danach Secrets unter derselben key_id mit verschiedenem Material — die
    // Sperre endet mit der Transaktion und schuetzt nichts, was niemand
    // hinterlegt hat. Der Abbruch kostet fast nichts: ohne Migrationen gibt es
    // kein Schema, die API koennte ohnehin nichts ausliefern.
    const { db, calls } = fakeDb([], { selectThrows: missingTableError() });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG))
      .rejects.toThrow('migration 0049 has not run');
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
    const { db } = fakeDb([{ key_id: 'default', fingerprint: masterKeyFingerprint(RICHTIG, SALT), salt: SALT }]);
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
      { key_id: 'default', fingerprint: masterKeyFingerprint(schwach, SALT), salt: SALT },
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
    expect(calls.inserted).toHaveLength(1);
    const eingetragen = calls.inserted[0]!;
    expect(eingetragen.key_id).toBe('default');
    // Der Salt entsteht zufaellig; nachgerechnet wird mit dem, der eingetragen
    // wurde.
    expect(eingetragen.fingerprint).toBe(masterKeyFingerprint(RICHTIG, eingetragen.salt));
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

  test('dieselbe key_id, aber verschiedenes Schluesselmaterial', async () => {
    // Der Zustand, den ein frueherer Start mit der falschen .env hinterlaesst:
    // beide Zeilen tragen key_id 'default' und denselben Algorithmus, aber sie
    // sind mit verschiedenen Schluesseln versiegelt. Die Metadaten sehen
    // einheitlich aus — nur EINE Zeile zu proben wuerde je nach Reihenfolge den
    // einen oder den anderen Schluessel segnen und den Rest unlesbar
    // zuruecklassen.
    const { db, calls } = fakeDb([], {
      secrets: [await secretRow(RICHTIG, 'alt'), await secretRow(FALSCH, 'neu')],
    });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toEqual([]);
  });

  test('Tracking-Daten zaehlen wie Secrets — auch ohne ein einziges Secret', async () => {
    // createEmailTrackingCrypto leitet Token-, Verschluesselungs- und
    // Link-Hash-Schluessel aus demselben Master-Key ab. Eine Datenbank ohne
    // Secrets, aber mit Tracking-Daten ist deshalb nicht frisch: ein fremder
    // Schluessel entwertet bestehende Tokens und macht die Zieladressen
    // unlesbar.
    const { db, calls } = fakeDb([], { trackingLinks: [trackingLinkRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toEqual([]);

    const passend = fakeDb([], { trackingLinks: [trackingLinkRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(passend.db, RICHTIG)).resolves.toBeUndefined();
    expect(passend.calls.inserted).toHaveLength(1);
  });

  test('auch Tracking-EREIGNISSE zaehlen, ganz ohne Links', async () => {
    // Eine Installation, die nur Oeffnungen mit Rohdatenerfassung sammelt, hat
    // keinen einzigen Link. Alles Verschluesselte haengt dort an
    // email_tracking_events.raw_metadata_*; mit fremdem Schluessel erschiene es
    // hinterher dauerhaft als rawUnavailable.
    const { db, calls } = fakeDb([], { trackingEvents: [trackingEventRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toEqual([]);

    const passend = fakeDb([], { trackingEvents: [trackingEventRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(passend.db, RICHTIG)).resolves.toBeUndefined();
    expect(passend.calls.inserted).toHaveLength(1);
  });

  test('ausgestellte Tokens zaehlen, auch ohne Links und ohne Rohdaten', async () => {
    // Wer nur Oeffnungen zaehlt und keine Rohdaten sammelt, hat weder Links
    // noch versiegelte Ereignisse — aber fuer jede getrackte Nachricht eine
    // Resolver-Zeile. Der token_hash haengt am Tracking-Schluessel und damit am
    // Master-Key; ein fremder Schluessel machte jedes ausgestellte Zaehlpixel
    // unaufloesbar.
    for (const kind of ['open', 'click'] as const) {
      const { db, calls } = fakeDb([], { trackingTokens: [trackingTokenRow(RICHTIG, kind)] });
      await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
        .rejects.toThrow('does not match this database');
      expect(calls.inserted).toEqual([]);
    }
    const passend = fakeDb([], { trackingTokens: [trackingTokenRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(passend.db, RICHTIG)).resolves.toBeUndefined();
    expect(passend.calls.inserted).toHaveLength(1);
  });

  test('fehlt die Fingerabdruck-Tabelle, wird trotzdem geprobt', async () => {
    // Im Compose-Ablauf wartet die API auf `migrate`, ein Rolling Deployment
    // muss das nicht. Frueher galt die Pruefung hier als bestanden — eine
    // falsche .env kaeme in genau diesem Fenster durch und schriebe Daten unter
    // einem zweiten Schluessel.
    const { db, calls } = fakeDb([], {
      fingerprintTableMissing: true,
      secrets: [await secretRow(RICHTIG)],
    });
    await expect(assertMasterKeyMatchesDatabase(db, FALSCH))
      .rejects.toThrow('does not match this database');
    expect(calls.inserted).toEqual([]);
  });

  test('fehlt die Tabelle und passt der Schluessel, laeuft der Start ohne Eintrag', async () => {
    const { db, calls } = fakeDb([], {
      fingerprintTableMissing: true,
      secrets: [await secretRow(RICHTIG)],
    });
    await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
    expect(calls.inserted).toEqual([]);
  });

  test('aufbewahrte Ereignisse ohne Rohdaten: laufen lassen, aber nichts hinterlegen', async () => {
    // Die Aufbewahrung raeumt Rohdaten nach 7 Tagen und abgelaufene Resolver
    // weg, die Ereignisse bleiben 365 Tage. Deren dedupe_key kann ein HMAC ueber
    // den Tracking-Schluessel sein — nachrechnen laesst er sich nicht, die
    // Eingabe kennt die Pruefung nicht. Abbrechen waere falsch (der Schluessel
    // kann stimmen, beweisen laesst es sich in keine Richtung), festschreiben
    // auch (ein ungeprueftes Ja wuerde den richtigen Schluessel spaeter
    // abweisen).
    const { db, calls } = fakeDb([], { plainEvents: 3 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(assertMasterKeyMatchesDatabase(db, RICHTIG)).resolves.toBeUndefined();
      expect(calls.inserted).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('dedupe keys may be derived'));
    } finally {
      warn.mockRestore();
    }
  });

  test('aufbewahrte Ereignisse ohne Schluessel: Abbruch', async () => {
    // Tracking gibt es nur mit Master-Key. Liegen Ereignisse da und ist keiner
    // gesetzt, fehlt er.
    const { db } = fakeDb([], { plainEvents: 3 });
    await expect(assertMasterKeyMatchesDatabase(db, undefined))
      .rejects.toThrow('SIMPLECRM_MASTER_KEY is not set');
  });

  test('ohne Schluessel bricht auch reines Tracking den Start ab', async () => {
    const { db } = fakeDb([], { trackingLinks: [trackingLinkRow(RICHTIG)] });
    await expect(assertMasterKeyMatchesDatabase(db, undefined))
      .rejects.toThrow('SIMPLECRM_MASTER_KEY is not set');
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
    // Wer der Meldung folgt, muss danach wirklich starten koennen. Dazu gehoert
    // jedes Stueck, das der naechste Start wieder pruefen wuerde: die Secrets,
    // die Tracking-Links, die Roh-Metadaten der Ereignisse — und die
    // Sitzungsfreigabe, ohne die das DELETE unter RLS nichts trifft.
    const { db } = fakeDb([], { secrets: [await secretRow(RICHTIG)] });
    let message = '';
    await assertMasterKeyMatchesDatabase(db, FALSCH).catch((error: Error) => {
      message = error.message;
    });
    expect(message).toMatch(/DELETE FROM secrets/);
    expect(message).toMatch(/DELETE FROM email_tracking_links/);
    expect(message).toMatch(/DELETE FROM email_tracking_token_resolver/);
    expect(message).toMatch(/raw_metadata_ciphertext = NULL/);
    expect(message).toMatch(/set_config\('app\.role','system',true\)/);
  });
});
