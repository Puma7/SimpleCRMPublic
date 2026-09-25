/**
 * @jest-environment node
 *
 * Desktop-PGP mit echtem openpgp: Import eines Empfaengerschluessels und
 * Pruefung einer Cleartext-Signatur (Vorbild: packages/server/src/pgp).
 */
import Database from 'better-sqlite3';
import * as openpgp from 'openpgp';

const db = new Database(':memory:');
// Only the tables under test exist; FK targets (accounts, team members, …) are irrelevant here.
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));
jest.mock('../../electron/email/email-keytar', () => ({
  savePgpPrivateKey: jest.fn(),
  getPgpPrivateKey: jest.fn(),
  deletePgpPrivateKey: jest.fn(),
}));

import { createEmailMessagesTable, createPgpPeerKeysTable } from '../../electron/database-schema';
import {
  checkRecipientKeys,
  importPublicKeyArmored,
  verifySignedMessage,
} from '../../electron/pgp/pgp-service';

let bob: { publicKey: string; privateKey: string };

beforeAll(async () => {
  db.exec(createPgpPeerKeysTable);
  db.exec(createEmailMessagesTable);
  db.exec('ALTER TABLE email_messages ADD COLUMN pgp_status TEXT');
  db.exec('ALTER TABLE email_messages ADD COLUMN pgp_signer_fingerprint TEXT');
  const generated = await openpgp.generateKey({
    type: 'ecc',
    userIDs: [{ name: 'Bob', email: 'Bob@Example.com' }],
    format: 'armored',
  });
  bob = { publicKey: generated.publicKey, privateKey: generated.privateKey };
});

beforeEach(() => {
  db.exec('DELETE FROM pgp_peer_keys; DELETE FROM email_messages;');
});

async function insertSignedMessage(text: string, tamper = false): Promise<number> {
  const signingKeys = await openpgp.readPrivateKey({ armoredKey: bob.privateKey });
  let signed = String(
    await openpgp.sign({ message: await openpgp.createCleartextMessage({ text }), signingKeys }),
  );
  if (tamper) signed = signed.replace(text, `${text} (geaendert)`);
  return Number(
    db.prepare(
      `INSERT INTO email_messages (account_id, folder_id, uid, subject, body_text, from_json, date_received)
       VALUES (1, 1, 1, 's', ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(signed, JSON.stringify({ value: [{ address: 'bob@example.com' }] })).lastInsertRowid,
  );
}

describe('desktop PGP with real openpgp', () => {
  // F-A7b-08: Importierte Schluessel landeten unter '[object Object]' statt der E-Mail, Verschluesseln/Pruefen fand sie nie.
  test('imports a peer key under the e-mail address of its user id', async () => {
    const { fingerprint } = await importPublicKeyArmored(bob.publicKey);

    expect(db.prepare('SELECT email, fingerprint, trust_level FROM pgp_peer_keys').get()).toEqual({
      email: 'bob@example.com',
      fingerprint,
      trust_level: 'imported',
    });
    expect(checkRecipientKeys(['bob@example.com'])[0]).toEqual({ email: 'bob@example.com', hasKey: true, fingerprint });
  });

  test('rejects a key whose user ids carry no e-mail address', async () => {
    const nameOnly = await openpgp.generateKey({ type: 'ecc', userIDs: [{ name: 'Nur Name' }], format: 'armored' });
    await expect(importPublicKeyArmored(nameOnly.publicKey)).rejects.toThrow(/E-Mail/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM pgp_peer_keys').get()).toEqual({ c: 0 });
  });

  // F-A7b-08: Die Pruefung las Cleartext-Signaturen mit readMessage (Fehler) und verglich die 16-stellige Key-ID mit dem Fingerprint.
  test('verifies a cleartext signature and maps it to the full fingerprint of the peer key', async () => {
    const { fingerprint } = await importPublicKeyArmored(bob.publicKey);
    const messageId = await insertSignedMessage('Hallo Welt');

    await expect(verifySignedMessage(messageId)).resolves.toEqual({
      valid: false,
      fingerprint,
      status: 'signed_untrusted_key',
    });

    db.prepare("UPDATE pgp_peer_keys SET trust_level = 'verified'").run();
    await expect(verifySignedMessage(messageId)).resolves.toEqual({ valid: true, fingerprint, status: 'signed_valid' });
    expect(db.prepare('SELECT pgp_status, pgp_signer_fingerprint FROM email_messages WHERE id = ?').get(messageId))
      .toEqual({ pgp_status: 'signed_valid', pgp_signer_fingerprint: fingerprint });
  });

  test('a tampered cleartext signature is reported as invalid', async () => {
    await importPublicKeyArmored(bob.publicKey);
    db.prepare("UPDATE pgp_peer_keys SET trust_level = 'verified'").run();
    const messageId = await insertSignedMessage('Betrag 100 EUR', true);

    const result = await verifySignedMessage(messageId);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('signed_invalid');
  });
});
