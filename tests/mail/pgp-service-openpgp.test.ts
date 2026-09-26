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

import { createEmailMessagesTable, createPgpIdentitiesTable, createPgpPeerKeysTable } from '../../electron/database-schema';
import { getPgpPrivateKey } from '../../electron/email/email-keytar';
import { MAX_INBOUND_RFC822_BYTES } from '../../packages/core/src/email/inbound-message-size';
import {
  checkRecipientKeys,
  decryptMessageBody,
  importPublicKeyArmored,
  setPgpPeerKeyTrust,
  verifySignedMessage,
} from '../../electron/pgp/pgp-service';

let bob: { publicKey: string; privateKey: string };

beforeAll(async () => {
  db.exec(createPgpPeerKeysTable);
  db.exec(createPgpIdentitiesTable);
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

async function signCleartext(text: string): Promise<string> {
  const signingKeys = await openpgp.readPrivateKey({ armoredKey: bob.privateKey });
  return String(await openpgp.sign({ message: await openpgp.createCleartextMessage({ text }), signingKeys }));
}

function insertMessageBody(uid: number, bodyText: string | null, bodyHtml: string | null): number {
  return Number(
    db.prepare(
      `INSERT INTO email_messages (account_id, folder_id, uid, subject, body_text, body_html, from_json, date_received)
       VALUES (1, 1, ?, 's', ?, ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(uid, bodyText, bodyHtml, JSON.stringify({ value: [{ address: 'bob@example.com' }] })).lastInsertRowid,
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

  // F-A7b-08: Kein Desktop-Pfad setzte trust_level, eine gueltige Signatur blieb immer "nicht vertrauenswuerdig".
  test('marking a peer key as verified makes its valid signature trusted, revoking undoes it', async () => {
    const { fingerprint } = await importPublicKeyArmored(bob.publicKey);
    const { id } = db.prepare('SELECT id FROM pgp_peer_keys').get() as { id: number };
    const messageId = await insertSignedMessage('Rechnung 42');
    await expect(verifySignedMessage(messageId)).resolves.toMatchObject({ valid: false, status: 'signed_untrusted_key' });

    expect(setPgpPeerKeyTrust(id, 'verified', 'admin-1')).toEqual({ trustLevel: 'verified' });
    expect(db.prepare('SELECT trust_level, verified_at, verified_by_user_id FROM pgp_peer_keys').get()).toEqual({
      trust_level: 'verified',
      verified_at: expect.any(String),
      verified_by_user_id: 'admin-1',
    });
    await expect(verifySignedMessage(messageId)).resolves.toEqual({ valid: true, fingerprint, status: 'signed_valid' });

    expect(setPgpPeerKeyTrust(id, 'imported', 'admin-1')).toEqual({ trustLevel: 'imported' });
    expect(db.prepare('SELECT trust_level, verified_at, verified_by_user_id FROM pgp_peer_keys').get()).toEqual({
      trust_level: 'imported',
      verified_at: null,
      verified_by_user_id: null,
    });
    await expect(verifySignedMessage(messageId)).resolves.toMatchObject({ valid: false, status: 'signed_untrusted_key' });
    // Ohne Verifizierung bleibt der manuell importierte Schluessel fuer die Verschluesselung nutzbar.
    expect(checkRecipientKeys(['bob@example.com'])[0]).toEqual({ email: 'bob@example.com', hasKey: true, fingerprint });
  });

  test('setting the trust of an unknown peer key fails', () => {
    expect(() => setPgpPeerKeyTrust(999, 'verified', 'admin-1')).toThrow(/nicht gefunden/);
  });

  test('a tampered cleartext signature is reported as invalid', async () => {
    await importPublicKeyArmored(bob.publicKey);
    db.prepare("UPDATE pgp_peer_keys SET trust_level = 'verified'").run();
    const messageId = await insertSignedMessage('Betrag 100 EUR', true);

    const result = await verifySignedMessage(messageId);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('signed_invalid');
  });

  // C-A56: Ein alter, echt signierter Block eines verifizierten Partners machte auch angehaengten unsignierten Text oder einen abweichenden HTML-Teil 'signed_valid'.
  test('reports signed_partial when unsigned text or a differing HTML part accompanies the signed block', async () => {
    const { fingerprint } = await importPublicKeyArmored(bob.publicKey);
    db.prepare("UPDATE pgp_peer_keys SET trust_level = 'verified'").run();
    const block = await signCleartext('Hallo, anbei die Unterlagen.');
    const fraud = 'NEUE IBAN: DE00 1234 5678 9000 0000 00. Bitte ab sofort dorthin ueberweisen.';
    const suffixId = insertMessageBody(1, `${block}\n\n${fraud}\n`, null);
    const htmlId = insertMessageBody(2, block, `<p>${fraud}</p>`);

    for (const messageId of [suffixId, htmlId]) {
      await expect(verifySignedMessage(messageId)).resolves.toEqual({ valid: false, fingerprint, status: 'signed_partial' });
      expect(db.prepare('SELECT pgp_status, pgp_signer_fingerprint FROM email_messages WHERE id = ?').get(messageId))
        .toEqual({ pgp_status: 'signed_partial', pgp_signer_fingerprint: fingerprint });
    }
  });

  test('a block that is the whole message stays signed_valid (mailer whitespace, HTML rendering of the signed text)', async () => {
    const { fingerprint } = await importPublicKeyArmored(bob.publicKey);
    db.prepare("UPDATE pgp_peer_keys SET trust_level = 'verified'").run();
    const block = await signCleartext('Hallo,\nanbei die Unterlagen.');
    const crlfId = insertMessageBody(1, `\r\n${block.replace(/\n/g, '\r\n')}\r\n\r\n`, null);
    const htmlArmorId = insertMessageBody(2, block, `<html><body><pre>${block.replace(/\n/g, '<br>\n')}</pre></body></html>`);
    const htmlTextId = insertMessageBody(3, block, '<div>Hallo,<br>anbei die Unterlagen.</div>');

    for (const messageId of [crlfId, htmlArmorId, htmlTextId]) {
      await expect(verifySignedMessage(messageId)).resolves.toEqual({ valid: true, fingerprint, status: 'signed_valid' });
    }
  });
});

describe('desktop PGP decryption decompression limit', () => {
  const PASSPHRASE = 'richtig pferd batterie';
  let me: { privateKey: string; publicKey: openpgp.PublicKey };

  beforeAll(async () => {
    const generated = await openpgp.generateKey({
      type: 'ecc',
      userIDs: [{ name: 'Ich', email: 'ich@example.com' }],
      passphrase: PASSPHRASE,
      format: 'armored',
    });
    me = { privateKey: generated.privateKey, publicKey: await openpgp.readKey({ armoredKey: generated.publicKey }) };
    db.prepare(
      `INSERT INTO pgp_identities (user_id, email, fingerprint, public_key_armor, has_private_key, keytar_private_key_handle, is_primary)
       VALUES ('local-owner', 'ich@example.com', ?, ?, 1, 'pgp-priv-test', 1)`,
    ).run(me.publicKey.getFingerprint(), me.publicKey.armor());
    (getPgpPrivateKey as jest.Mock).mockResolvedValue(me.privateKey);
  });

  async function insertEncrypted(text: string): Promise<number> {
    const armored = String(await openpgp.encrypt({
      message: await openpgp.createMessage({ text }),
      encryptionKeys: me.publicKey,
      config: { preferredCompressionAlgorithm: openpgp.enums.compression.zlib },
    }));
    return Number(
      db.prepare(
        `INSERT INTO email_messages (account_id, folder_id, uid, subject, body_text, date_received)
         VALUES (1, 1, 2, 'enc', ?, '2026-01-01T00:00:00Z')`,
      ).run(armored).lastInsertRowid,
    );
  }

  test('decrypts an ordinary compressed message', async () => {
    const id = await insertEncrypted('Hallo verschluesselte Welt');
    await expect(decryptMessageBody(id, PASSPHRASE, 'local-owner')).resolves.toEqual({
      text: 'Hallo verschluesselte Welt',
      status: 'decrypted',
    });
  });

  // F-A13A14-05 (Desktop-Paritaet): openpgp.decrypt lief ohne maxDecompressedMessageSize; ein kleines Chiffrat entpackte sich im Hauptprozess zu beliebig grossem Klartext.
  test('rejects a compressed message that expands beyond the plaintext limit', async () => {
    const id = await insertEncrypted('a'.repeat(MAX_INBOUND_RFC822_BYTES + 1024 * 1024));
    const stored = db.prepare('SELECT body_text FROM email_messages WHERE id = ?').get(id) as { body_text: string };
    expect(stored.body_text.length).toBeLessThan(1024 * 1024);
    await expect(decryptMessageBody(id, PASSPHRASE, 'local-owner')).rejects.toThrow();
  }, 120_000);
});
