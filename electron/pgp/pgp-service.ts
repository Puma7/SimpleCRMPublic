import { randomUUID } from 'crypto';
import {
  MAX_INBOUND_RFC822_BYTES,
  PGP_SIGNED_PARTIAL_STATUS,
  extractArmoredPgpSignedMessage,
  pgpCleartextSignatureCoversMessage,
} from '@simplecrm/core';
import { getDb } from '../sqlite-service';
import { PGP_IDENTITIES_TABLE, PGP_PEER_KEYS_TABLE, EMAIL_MESSAGES_TABLE } from '../database-schema';
import { LOCAL_OWNER_USER_ID } from '../mail-roadmap-migrations';
import {
  savePgpPrivateKey,
  getPgpPrivateKey,
  deletePgpPrivateKey,
} from '../email/email-keytar';

const PGP_KEYTAR_PREFIX = 'pgp-priv-';

type OpenPgpModule = typeof import('openpgp', { with: { 'resolution-mode': 'import' } });
type OpenPgpPublicKey = Awaited<ReturnType<OpenPgpModule['readKey']>>;

let openPgpPromise: Promise<OpenPgpModule> | undefined;

function loadOpenPgp(): Promise<OpenPgpModule> {
  openPgpPromise ??= import('openpgp');
  return openPgpPromise;
}

/**
 * openpgp inflates compressed data packets without limit by default, so a small
 * ciphertext could expand to gigabytes in the main process. No decrypted
 * plaintext needs to be larger than the largest inbound mail we accept.
 */
const PGP_DECRYPT_CONFIG = { maxDecompressedMessageSize: MAX_INBOUND_RFC822_BYTES };

/** Keys trusted for outbound encryption (manual import counts as explicit trust). */
const ENCRYPT_TRUST_LEVELS = "('verified', 'tofu', 'imported')";

/** Keys that may yield a green “valid signature” in the UI. */
const VERIFY_TRUST_LEVELS = "('verified', 'tofu')";

function isEncryptableTrustLevel(level: string): boolean {
  return level === 'verified' || level === 'tofu' || level === 'imported';
}

function isVerifiedTrustLevel(level: string): boolean {
  return level === 'verified' || level === 'tofu';
}

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

/**
 * E-mail of the key's primary user id (fallback: first user id with an e-mail).
 * `user.userID` is a UserIDPacket object, not a string.
 */
async function peerKeyEmail(key: OpenPgpPublicKey): Promise<string | null> {
  const normalize = (value: string | undefined) => value?.trim().toLowerCase() || null;
  try {
    const { user } = await key.getPrimaryUser();
    const email = normalize(user.userID?.email);
    if (email) return email;
  } catch {
    // No valid primary user self-signature: fall back to the raw user ids.
  }
  for (const user of key.users) {
    const email = normalize(user.userID?.email);
    if (email) return email;
  }
  return null;
}

export async function importPublicKeyArmored(
  armor: string,
  userId: string = LOCAL_OWNER_USER_ID,
  source = 'manual',
): Promise<{ fingerprint: string }> {
  const openpgp = await loadOpenPgp();
  const key = await openpgp.readKey({ armoredKey: armor });
  const fp = key.getFingerprint().toLowerCase();
  const email = await peerKeyEmail(key);
  if (!email) throw new Error('Der Schlüssel enthält keine E-Mail-Adresse in der User-ID.');
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  db.prepare(
    `INSERT OR REPLACE INTO ${PGP_PEER_KEYS_TABLE} (email, fingerprint, public_key_armor, source, trust_level)
     VALUES (?, ?, ?, ?, 'imported')`,
  ).run(email, fp, armor, source);
  return { fingerprint: fp };
}

export async function generatePgpIdentity(
  userId: string,
  email: string,
  passphrase: string,
): Promise<{ fingerprint: string }> {
  const openpgp = await loadOpenPgp();
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

export async function rotateIdentityPassphrase(
  identityId: number,
  currentPassphrase: string,
  nextPassphrase: string,
  userId: string = LOCAL_OWNER_USER_ID,
): Promise<void> {
  const openpgp = await loadOpenPgp();
  if (!nextPassphrase.trim()) throw new Error('Neue Passphrase darf nicht leer sein');
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const identity = db
    .prepare(
      `SELECT keytar_private_key_handle FROM ${PGP_IDENTITIES_TABLE}
       WHERE id = ? AND user_id = ? AND has_private_key = 1`,
    )
    .get(identityId, userId) as { keytar_private_key_handle: string | null } | undefined;
  if (!identity?.keytar_private_key_handle) throw new Error('Identität nicht gefunden');
  const privArmored = await getPgpPrivateKey(identity.keytar_private_key_handle);
  if (!privArmored) throw new Error('Privater Schlüssel nicht in Keytar');
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privArmored });
  const decryptedKey = await openpgp.decryptKey({ privateKey, passphrase: currentPassphrase });
  const reencrypted = await openpgp.encryptKey({ privateKey: decryptedKey, passphrase: nextPassphrase });
  const armored =
    typeof reencrypted === 'string'
      ? reencrypted
      : await reencrypted.armor();
  await savePgpPrivateKey(identity.keytar_private_key_handle, armored);
}

export async function decryptMessageBody(
  messageId: number,
  passphrase: string,
  userId: string = LOCAL_OWNER_USER_ID,
): Promise<{ text: string; status: string }> {
  const openpgp = await loadOpenPgp();
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
    config: PGP_DECRYPT_CONFIG,
  });
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
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

export async function encryptPlaintextForRecipients(
  plaintext: string,
  recipientEmails: string[],
  userId: string,
): Promise<{ armored: string }> {
  const openpgp = await loadOpenPgp();
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const keys: OpenPgpPublicKey[] = [];
  for (const email of recipientEmails) {
    const row = db
      .prepare(
        `SELECT public_key_armor FROM ${PGP_PEER_KEYS_TABLE}
         WHERE email = ? COLLATE NOCASE AND trust_level IN ${ENCRYPT_TRUST_LEVELS}
         ORDER BY CASE trust_level WHEN 'verified' THEN 0 WHEN 'tofu' THEN 1 WHEN 'imported' THEN 2 ELSE 3 END,
                  id DESC
         LIMIT 1`,
      )
      .get(email.trim()) as { public_key_armor: string } | undefined;
    if (!row?.public_key_armor) {
      throw new Error(`Kein vertrauenswürdiger öffentlicher Schlüssel für ${email}`);
    }
    keys.push(await openpgp.readKey({ armoredKey: row.public_key_armor }));
  }
  if (keys.length === 0) throw new Error('Keine Empfänger-Schlüssel');
  const message = await openpgp.createMessage({ text: plaintext });
  const armored = await openpgp.encrypt({
    message,
    encryptionKeys: keys,
  });
  return { armored: String(armored) };
}

export async function signPlaintext(
  plaintext: string,
  userId: string,
  passphrase: string,
): Promise<{ armored: string }> {
  const openpgp = await loadOpenPgp();
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
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
  const signingKey = await openpgp.decryptKey({ privateKey, passphrase });
  const message = await openpgp.createMessage({ text: plaintext });
  const armored = await openpgp.sign({ message, signingKeys: signingKey });
  return { armored: String(armored) };
}

export async function verifySignedMessage(
  messageId: number,
): Promise<{ valid: boolean; fingerprint?: string; status: string }> {
  const openpgp = await loadOpenPgp();
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const row = db
    .prepare(`SELECT body_text, body_html, from_json FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as {
    body_text: string | null;
    body_html: string | null;
    from_json: string | null;
  };
  if (!row) throw new Error('Nachricht nicht gefunden');
  // Only the signed block itself is verified; text after it is not covered by
  // the signature and is checked separately below.
  const armored = extractArmoredPgpSignedMessage(
    (row.body_text ?? '').trimStart().startsWith('-----BEGIN PGP SIGNED MESSAGE-----')
      ? row.body_text
      : (row.body_html ?? '').trimStart().startsWith('-----BEGIN PGP SIGNED MESSAGE-----')
        ? row.body_html
        : null,
  );
  if (!armored) throw new Error('Keine signierte PGP-Nachricht');
  let senderEmail = '';
  try {
    const from = JSON.parse(row.from_json ?? '{}') as { value?: { address?: string }[] };
    senderEmail = (from.value?.[0]?.address ?? '').trim().toLowerCase();
  } catch {
    senderEmail = '';
  }
  const peers = senderEmail
    ? (db
        .prepare(
          `SELECT public_key_armor, fingerprint, trust_level FROM ${PGP_PEER_KEYS_TABLE} WHERE email = ? COLLATE NOCASE`,
        )
        .all(senderEmail) as { public_key_armor: string; fingerprint: string; trust_level: string }[])
    : [];
  if (peers.length === 0) {
    db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET pgp_status = ? WHERE id = ?`).run(
      'key_missing',
      messageId,
    );
    return { valid: false, status: 'key_missing' };
  }
  const verificationKeys = await Promise.all(
    peers.map((p) => openpgp.readKey({ armoredKey: p.public_key_armor })),
  );
  // Cleartext signatures ('BEGIN PGP SIGNED MESSAGE') need readCleartextMessage (as on the server).
  const message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
  const verification = await openpgp.verify({ message, verificationKeys });
  const sig0 = verification.signatures[0];
  let valid = false;
  let fp: string | undefined;
  if (sig0) {
    // The signature carries a 16-hex key id (possibly of a subkey); map it to the
    // peer key that contains it and report that key's full fingerprint.
    const matchedIndex = verificationKeys.findIndex((key) => key.getKeys(sig0.keyID).length > 0);
    fp = matchedIndex >= 0
      ? peers[matchedIndex].fingerprint?.toLowerCase()
      : sig0.keyID?.toHex?.()?.toLowerCase();
    try {
      await sig0.verified;
      valid = true;
    } catch {
      valid = false;
    }
  }
  let status = valid ? 'signed_valid' : 'signed_invalid';
  if (valid && fp) {
    const trusted = peers.some(
      (p) => p.fingerprint?.toLowerCase() === fp && isVerifiedTrustLevel(p.trust_level),
    );
    if (!trusted) {
      valid = false;
      status = peers.some((p) => p.fingerprint?.toLowerCase() === fp && isEncryptableTrustLevel(p.trust_level))
        ? 'signed_untrusted_key'
        : 'signed_unknown_key';
    }
  }
  if (valid && !pgpCleartextSignatureCoversMessage({
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    armoredBlock: armored,
    signedText: message.getText(),
  })) {
    // Unsigned text after the block (or a differing HTML part) would otherwise
    // be shown under the sender's valid signature.
    valid = false;
    status = PGP_SIGNED_PARTIAL_STATUS;
  }
  db.prepare(
    `UPDATE ${EMAIL_MESSAGES_TABLE} SET pgp_status = ?, pgp_signer_fingerprint = ? WHERE id = ?`,
  ).run(status, fp ?? null, messageId);
  return { valid, fingerprint: fp, status };
}

export function listPgpPeerKeys() {
  const db = getDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT id, email, fingerprint, trust_level, source, created_at FROM ${PGP_PEER_KEYS_TABLE} ORDER BY email`,
    )
    .all();
}

export type PgpPeerKeyTrustLevel = 'verified' | 'imported';

/**
 * Nach einem Fingerprint-Abgleich ausserhalb der Mail: 'verified' laesst gueltige
 * Signaturen dieses Schluessels als vertrauenswuerdig gelten, 'imported' nimmt das
 * zurueck. Der Schluessel bleibt in beiden Stufen fuer die Verschluesselung nutzbar.
 */
export function setPgpPeerKeyTrust(
  id: number,
  trustLevel: PgpPeerKeyTrustLevel,
  actorUserId: string,
): { trustLevel: PgpPeerKeyTrustLevel } {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const verified = trustLevel === 'verified';
  const result = db
    .prepare(
      `UPDATE ${PGP_PEER_KEYS_TABLE} SET trust_level = ?, verified_at = ?, verified_by_user_id = ? WHERE id = ?`,
    )
    .run(trustLevel, verified ? new Date().toISOString() : null, verified ? actorUserId : null, id);
  if (result.changes === 0) throw new Error('PGP-Schlüssel nicht gefunden');
  return { trustLevel };
}

export function deletePgpPeerKey(id: number): void {
  const db = getDb();
  if (!db) return;
  db.prepare(`DELETE FROM ${PGP_PEER_KEYS_TABLE} WHERE id = ?`).run(id);
}

export function checkRecipientKeys(
  emails: string[],
): { email: string; hasKey: boolean; fingerprint?: string }[] {
  const db = getDb();
  if (!db) return emails.map((email) => ({ email, hasKey: false }));
  return emails.map((email) => {
    const row = db
      .prepare(
        `SELECT fingerprint FROM ${PGP_PEER_KEYS_TABLE}
         WHERE email = ? COLLATE NOCASE AND trust_level IN ${ENCRYPT_TRUST_LEVELS}
         ORDER BY CASE trust_level WHEN 'verified' THEN 0 WHEN 'tofu' THEN 1 WHEN 'imported' THEN 2 ELSE 3 END,
                  id DESC
         LIMIT 1`,
      )
      .get(email.trim()) as { fingerprint: string } | undefined;
    return {
      email,
      hasKey: Boolean(row),
      fingerprint: row?.fingerprint,
    };
  });
}

/** Fail-closed outbound: encrypt and/or sign plaintext before SMTP. */
export async function prepareOutboundPgpBody(input: {
  bodyText: string;
  recipientEmails: string[];
  userId: string;
  encrypt?: boolean;
  sign?: boolean;
  passphrase?: string;
}): Promise<{ bodyText: string }> {
  let text = input.bodyText;
  if (input.sign) {
    if (!input.passphrase) throw new Error('Passphrase für Signatur erforderlich');
    text = (await signPlaintext(text, input.userId, input.passphrase)).armored;
  }
  if (input.encrypt) {
    const missing = checkRecipientKeys(input.recipientEmails).filter((r) => !r.hasKey);
    if (missing.length > 0) {
      throw new Error(`Kein Schlüssel für: ${missing.map((m) => m.email).join(', ')}`);
    }
    text = (await encryptPlaintextForRecipients(text, input.recipientEmails, input.userId)).armored;
  }
  return { bodyText: text };
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
