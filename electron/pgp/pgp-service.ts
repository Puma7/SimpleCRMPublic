import * as openpgp from 'openpgp';
import { randomUUID } from 'crypto';
import { getDb } from '../sqlite-service';
import { PGP_IDENTITIES_TABLE, PGP_PEER_KEYS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import { LOCAL_OWNER_USER_ID } from '../mail-roadmap-migrations';
import {
  savePgpPrivateKey,
  getPgpPrivateKey,
  deletePgpPrivateKey,
} from '../email/email-keytar';

const PGP_KEYTAR_PREFIX = 'pgp-priv-';

export async function listPgpIdentities(userId: string = LOCAL_OWNER_USER_ID) {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT id, email, fingerprint, has_private_key, is_primary, expires_at, created_at
       FROM ${PGP_IDENTITIES_TABLE} WHERE user_id = ? ORDER BY is_primary DESC, email`,
    )
    .all(userId);
}

export async function importPublicKeyArmored(
  armor: string,
  userId: string = LOCAL_OWNER_USER_ID,
  source = 'manual',
): Promise<{ fingerprint: string }> {
  const key = await openpgp.readKey({ armoredKey: armor });
  const fp = key.getFingerprint().toLowerCase();
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  db.prepare(
    `INSERT OR REPLACE INTO ${PGP_PEER_KEYS_TABLE} (email, fingerprint, public_key_armor, source, trust_level)
     VALUES (?, ?, ?, ?, 'imported')`,
  ).run(String(key.users[0]?.userID ?? 'unknown'), fp, armor, source);
  return { fingerprint: fp };
}

export async function generatePgpIdentity(
  userId: string,
  email: string,
  passphrase: string,
): Promise<{ fingerprint: string }> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 4096,
    userIDs: [{ name: email, email }],
    passphrase,
  });
  const key = await openpgp.readKey({ armoredKey: publicKey });
  const fp = key.getFingerprint().toLowerCase();
  const handle = `${PGP_KEYTAR_PREFIX}${randomUUID()}`;
  await savePgpPrivateKey(handle, privateKey);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  db.prepare(
    `INSERT INTO ${PGP_IDENTITIES_TABLE}
     (user_id, email, fingerprint, public_key_armor, has_private_key, keytar_private_key_handle, is_primary)
     VALUES (?, ?, ?, ?, 1, ?, 1)`,
  ).run(userId, email, fp, publicKey, handle);
  return { fingerprint: fp };
}

export async function decryptMessageBody(
  messageId: number,
  passphrase: string,
  userId: string = LOCAL_OWNER_USER_ID,
): Promise<{ text: string; status: string }> {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const row = db
    .prepare(`SELECT body_text, body_html, pgp_status FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { body_text: string | null; body_html: string | null; pgp_status: string | null };
  if (!row) throw new Error('Nachricht nicht gefunden');
  const armored = row.body_text?.includes('BEGIN PGP MESSAGE')
    ? row.body_text
    : row.body_html?.includes('BEGIN PGP MESSAGE')
      ? row.body_html
      : null;
  if (!armored) throw new Error('Keine PGP-Nachricht');
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const identity = db
    .prepare(
      `SELECT keytar_private_key_handle FROM ${PGP_IDENTITIES_TABLE}
       WHERE user_id = ? AND has_private_key = 1 ORDER BY is_primary DESC LIMIT 1`,
    )
    .get(userId) as { keytar_private_key_handle: string | null } | undefined;
  if (!identity?.keytar_private_key_handle) throw new Error('Kein privater Schlüssel');
  const privArmored = await getPgpPrivateKey(identity.keytar_private_key_handle);
  if (!privArmored) throw new Error('Privater Schlüssel nicht in Keytar');
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privArmored });
  const decryptedKey = await openpgp.decryptKey({ privateKey, passphrase });
  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: decryptedKey,
  });
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
  db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET pgp_status = ? WHERE id = ?`).run('decrypted', messageId);
  return { text, status: 'decrypted' };
}

export function detectPgpInbound(messageId: number): void {
  const db = getDb();
  if (!db) return;
  const row = db
    .prepare(`SELECT body_text, body_html FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { body_text: string | null; body_html: string | null };
  if (!row) return;
  const textHead = (row.body_text ?? '').trimStart();
  const htmlHead = (row.body_html ?? '').trimStart();
  if (textHead.startsWith('-----BEGIN PGP MESSAGE-----') || htmlHead.startsWith('-----BEGIN PGP MESSAGE-----')) {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET pgp_status = ? WHERE id = ?`).run(
      'encrypted_unread',
      messageId,
    );
  } else if (
    textHead.startsWith('-----BEGIN PGP SIGNED MESSAGE-----') ||
    htmlHead.startsWith('-----BEGIN PGP SIGNED MESSAGE-----')
  ) {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET pgp_status = ? WHERE id = ?`).run(
      'signed_unknown_key',
      messageId,
    );
  }
}

export async function deletePgpIdentity(id: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  const row = db
    .prepare(`SELECT keytar_private_key_handle FROM ${PGP_IDENTITIES_TABLE} WHERE id = ?`)
    .get(id) as { keytar_private_key_handle: string | null } | undefined;
  if (row?.keytar_private_key_handle) {
    await deletePgpPrivateKey(row.keytar_private_key_handle);
  }
  db.prepare(`DELETE FROM ${PGP_IDENTITIES_TABLE} WHERE id = ?`).run(id);
}
