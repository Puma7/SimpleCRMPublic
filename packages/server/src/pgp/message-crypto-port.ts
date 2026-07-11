import { sql as kyselySql, type Kysely } from 'kysely';

import type {
  PgpAttachmentDecryptPortResult,
  PgpAttachmentVerifyPortResult,
  PgpMessageCryptoApiPort,
  PgpMessageDetectPortResult,
  PgpMessageDecryptPortResult,
  PgpMessageVerifyPortResult,
} from '../api/types';
import type { PostgresSecretPort } from '../db/postgres-secret-port';
import type { ServerDatabase } from '../db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from '../db/workspace-context';
import {
  decryptPgpPrivateKeyWithPassphrase,
} from '../security';
import {
  deserializePgpPrivateKeyEnvelope,
  pgpIdentityPrivateKeySecretIdentifier,
} from './private-key-envelope';

type OpenPgpModule = typeof import('openpgp');

type PgpDecryptInput = Parameters<PgpMessageCryptoApiPort['decryptMessage']>[0];
type PgpDecryptAttachmentInput = Parameters<NonNullable<PgpMessageCryptoApiPort['decryptAttachment']>>[0];
type PgpDetectInput = Parameters<NonNullable<PgpMessageCryptoApiPort['detectMessage']>>[0];
type PgpVerifyInput = Parameters<PgpMessageCryptoApiPort['verifyMessage']>[0];
type PgpVerifyAttachmentInput = Parameters<NonNullable<PgpMessageCryptoApiPort['verifyAttachment']>>[0];
type PgpOutboundInput = Parameters<PgpMessageCryptoApiPort['prepareOutboundBody']>[0];

export type PostgresPgpMessageCryptoPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  importOpenPgp?: () => Promise<OpenPgpModule>;
}>;

const defaultImportOpenPgp = new Function('return import("openpgp")') as () => Promise<OpenPgpModule>;

const PGP_MESSAGE_BEGIN = '-----BEGIN PGP MESSAGE-----';
const PGP_MESSAGE_END = '-----END PGP MESSAGE-----';
const PGP_SIGNED_MESSAGE_BEGIN = '-----BEGIN PGP SIGNED MESSAGE-----';
const PGP_SIGNATURE_END = '-----END PGP SIGNATURE-----';
const PGP_SIGNATURE_BEGIN = '-----BEGIN PGP SIGNATURE-----';
const ENCRYPTABLE_TRUST_LEVELS = ['verified', 'tofu', 'imported'] as const;
const VERIFIED_SIGNATURE_TRUST_LEVELS = ['verified', 'tofu'] as const;

export function createPostgresPgpMessageCryptoPort(
  options: PostgresPgpMessageCryptoPortOptions,
): PgpMessageCryptoApiPort {
  const importOpenPgp = options.importOpenPgp ?? defaultImportOpenPgp;

  return {
    async detectMessage(input): Promise<PgpMessageDetectPortResult> {
      const message = await loadPgpMessageBodies(options, input);
      if (!message) return { ok: false, code: 'message_not_found' };

      const status = detectInboundPgpStatus(message.body_text, message.body_html);
      if (status) await updateMessagePgpDetectionStatus(options, input, status);

      return {
        ok: true,
        result: {
          detected: Boolean(status),
          status,
        },
      };
    },

    async decryptMessage(input): Promise<PgpMessageDecryptPortResult> {
      const rows = await loadMessageAndIdentity(options, input);
      if (!rows.message) return { ok: false, code: 'message_not_found' };

      const armoredMessage = extractArmoredPgpMessage(rows.message.body_text, rows.message.body_html);
      if (!armoredMessage) return { ok: false, code: 'not_pgp_message' };

      if (!rows.identity?.private_key_secret_id) {
        return { ok: false, code: 'private_key_unavailable' };
      }

      const secretIdentifier = pgpIdentityPrivateKeySecretIdentifier(input.workspaceId, Number(rows.identity.id));
      let serializedEnvelope: Buffer | null;
      try {
        serializedEnvelope = await options.secrets.readSecret(secretIdentifier);
      } catch {
        return { ok: false, code: 'private_key_secret_unavailable' };
      }
      if (!serializedEnvelope) return { ok: false, code: 'private_key_secret_unavailable' };

      let privateKeyArmored: Buffer;
      try {
        privateKeyArmored = await decryptPgpPrivateKeyWithPassphrase({
          envelope: deserializePgpPrivateKeyEnvelope(serializedEnvelope),
          passphrase: input.passphrase,
          associatedData: {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            identityId: String(rows.identity.id),
            fingerprint: rows.identity.fingerprint,
          },
        });
      } catch {
        return { ok: false, code: 'decrypt_failed' };
      } finally {
        serializedEnvelope.fill(0);
      }

      try {
        const openpgp = await importOpenPgp();
        const message = await openpgp.readMessage({ armoredMessage });
        const privateKey = await openpgp.readPrivateKey({
          armoredKey: privateKeyArmored.toString('utf8'),
        });
        const decryptedKey = await openpgp.decryptKey({
          privateKey,
          passphrase: input.passphrase,
        });
        const decrypted = await openpgp.decrypt({
          message,
          decryptionKeys: decryptedKey,
        });

        return {
          ok: true,
          result: {
            text: decryptedDataToText(decrypted.data),
            status: 'decrypted',
          },
        };
      } catch {
        return { ok: false, code: 'decrypt_failed' };
      } finally {
        privateKeyArmored.fill(0);
      }
    },

    async verifyMessage(input): Promise<PgpMessageVerifyPortResult> {
      const message = await loadSignedMessage(options, input);
      if (!message) return { ok: false, code: 'message_not_found' };

      const armoredMessage = extractArmoredPgpSignedMessage(message.body_text, message.body_html);
      if (!armoredMessage) return { ok: false, code: 'not_signed' };

      const senderEmail = firstAddressFromRecipientJson(message.from_json);
      const peers = senderEmail
        ? await loadSenderPeerKeys(options, input.workspaceId, senderEmail)
        : [];
      if (peers.length === 0) {
        await updateMessagePgpSignatureStatus(options, input, 'key_missing', null);
        return { ok: true, result: { valid: false, status: 'key_missing' } };
      }

      try {
        const openpgp = await importOpenPgp();
        const verificationKeys = await Promise.all(
          peers.map((peer) => openpgp.readKey({ armoredKey: peer.publicKeyArmor })),
        );
        const cleartextMessage = await openpgp.readCleartextMessage({ cleartextMessage: armoredMessage });
        const verification = await openpgp.verify({
          message: cleartextMessage,
          verificationKeys,
          expectSigned: true,
        });
        const signature = verification.signatures[0];
        let signatureValid = false;
        let signerKeyId: string | undefined;
        if (signature) {
          signerKeyId = normalizeFingerprint(signature.keyID?.toHex?.());
          try {
            await signature.verified;
            signatureValid = true;
          } catch {
            signatureValid = false;
          }
        }

        const matchedPeer = signerKeyId
          ? peers.find((peer) => fingerprintMatchesSignature(peer.fingerprint, signerKeyId))
          : undefined;
        const signerFingerprint = matchedPeer?.fingerprint ?? signerKeyId;
        let status = signatureValid ? 'signed_valid' : 'signed_invalid';
        let valid = signatureValid;
        if (signatureValid) {
          if (!matchedPeer) {
            valid = false;
            status = 'signed_unknown_key';
          } else if (!isVerifiedSignatureTrustLevel(matchedPeer.trustLevel)) {
            valid = false;
            status = isEncryptableTrustLevel(matchedPeer.trustLevel)
              ? 'signed_untrusted_key'
              : 'signed_unknown_key';
          }
        }

        await updateMessagePgpSignatureStatus(options, input, status, signerFingerprint ?? null);
        return {
          ok: true,
          result: {
            valid,
            status,
            ...(signerFingerprint ? { fingerprint: signerFingerprint } : {}),
          },
        };
      } catch (cause) {
        return {
          ok: false,
          code: 'verify_failed',
          message: cause instanceof Error && cause.message ? cause.message : undefined,
        };
      }
    },

    async decryptAttachment(input): Promise<PgpAttachmentDecryptPortResult> {
      const identity = await loadPrimaryPrivateIdentity(options, input.workspaceId, input.actorUserId);
      if (!identity?.private_key_secret_id) {
        return { ok: false, code: 'private_key_unavailable' };
      }

      const privateKeyArmored = await readPrivateKeyArmored(options, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        identity,
        passphrase: input.passphrase,
      });
      if (!privateKeyArmored.ok) {
        return {
          ok: false,
          code: privateKeyArmored.error.includes('Secret')
            ? 'private_key_secret_unavailable'
            : 'decrypt_failed',
          message: privateKeyArmored.error,
        };
      }

      try {
        const openpgp = await importOpenPgp();
        let message: Awaited<ReturnType<OpenPgpModule['readMessage']>>;
        try {
          message = await readPgpMessageFromBytes(openpgp, input.attachment.bytes);
        } catch {
          return { ok: false, code: 'not_pgp_attachment' };
        }

        const privateKey = await openpgp.readPrivateKey({
          armoredKey: privateKeyArmored.value.toString('utf8'),
        });
        const decryptedKey = await openpgp.decryptKey({
          privateKey,
          passphrase: input.passphrase,
        });
        const decrypted = await openpgp.decrypt({
          message,
          decryptionKeys: decryptedKey,
          format: 'binary',
        });

        return {
          ok: true,
          result: {
            filename: pgpDecryptedAttachmentName(input.attachment.filename),
            contentType: null,
            content: decryptedDataToBytes(decrypted.data),
            status: 'decrypted',
          },
        };
      } catch (cause) {
        return {
          ok: false,
          code: 'decrypt_failed',
          message: cause instanceof Error && cause.message ? cause.message : undefined,
        };
      } finally {
        privateKeyArmored.value.fill(0);
      }
    },

    async verifyAttachment(input): Promise<PgpAttachmentVerifyPortResult> {
      const signerEmail = input.signerEmail?.trim().toLowerCase();
      const peers = signerEmail
        ? await loadSenderPeerKeys(options, input.workspaceId, signerEmail)
        : [];
      if (peers.length === 0) {
        return { ok: true, result: { valid: false, status: 'key_missing' } };
      }

      try {
        const openpgp = await importOpenPgp();
        const verificationKeys = await Promise.all(
          peers.map((peer) => openpgp.readKey({ armoredKey: peer.publicKeyArmor })),
        );
        const message = await openpgp.createMessage({
          binary: Buffer.from(input.attachment.bytes),
        });
        let signature: Awaited<ReturnType<OpenPgpModule['readSignature']>>;
        try {
          signature = await readPgpSignatureFromBytes(openpgp, input.signature.bytes);
        } catch {
          return { ok: false, code: 'not_signed' };
        }
        const verification = await openpgp.verify({
          message,
          signature,
          verificationKeys,
          expectSigned: true,
        });
        const signatureResult = verification.signatures[0];
        let signatureValid = false;
        let signerKeyId: string | undefined;
        if (signatureResult) {
          signerKeyId = normalizeFingerprint(signatureResult.keyID?.toHex?.());
          try {
            await signatureResult.verified;
            signatureValid = true;
          } catch {
            signatureValid = false;
          }
        }

        const matchedPeer = signerKeyId
          ? peers.find((peer) => fingerprintMatchesSignature(peer.fingerprint, signerKeyId))
          : undefined;
        const signerFingerprint = matchedPeer?.fingerprint ?? signerKeyId;
        let status = signatureValid ? 'signed_valid' : 'signed_invalid';
        let valid = signatureValid;
        if (signatureValid) {
          if (!matchedPeer) {
            valid = false;
            status = 'signed_unknown_key';
          } else if (!isVerifiedSignatureTrustLevel(matchedPeer.trustLevel)) {
            valid = false;
            status = isEncryptableTrustLevel(matchedPeer.trustLevel)
              ? 'signed_untrusted_key'
              : 'signed_unknown_key';
          }
        }

        return {
          ok: true,
          result: {
            valid,
            status,
            ...(signerFingerprint ? { fingerprint: signerFingerprint } : {}),
          },
        };
      } catch (cause) {
        return {
          ok: false,
          code: 'verify_failed',
          message: cause instanceof Error && cause.message ? cause.message : undefined,
        };
      }
    },

    async prepareOutboundBody(input) {
      if (!input.encrypt && !input.sign) return { ok: true, bodyText: input.bodyText };

      const openpgp = await importOpenPgp();
      let bodyText = input.bodyText;

      if (input.sign) {
        if (!input.passphrase) return { ok: false, error: 'PGP-Passphrase fuer Signatur erforderlich' };
        const identity = await loadPrimaryPrivateIdentity(options, input.workspaceId, input.actorUserId);
        if (!identity?.private_key_secret_id) {
          return { ok: false, error: 'Kein passender privater PGP-Schluessel verfuegbar' };
        }
        const privateKeyArmored = await readPrivateKeyArmored(options, {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          identity,
          passphrase: input.passphrase,
        });
        if (!privateKeyArmored.ok) return { ok: false, error: privateKeyArmored.error };
        try {
          const privateKey = await openpgp.readPrivateKey({
            armoredKey: privateKeyArmored.value.toString('utf8'),
          });
          const signingKey = await openpgp.decryptKey({
            privateKey,
            passphrase: input.passphrase,
          });
          const message = await openpgp.createMessage({ text: bodyText });
          bodyText = String(await openpgp.sign({ message, signingKeys: signingKey }));
        } catch {
          return { ok: false, error: 'PGP-Signatur konnte nicht erstellt werden' };
        } finally {
          privateKeyArmored.value.fill(0);
        }
      }

      if (input.encrypt) {
        const recipientEmails = normalizeRecipientEmails(input.recipientEmails);
        if (recipientEmails.length === 0) return { ok: false, error: 'Keine Empfaenger-Schluessel' };

        const peerKeys = await loadRecipientPeerKeys(options, input.workspaceId, recipientEmails);
        const missing = recipientEmails.filter((email) => !peerKeys.has(email));
        if (missing.length > 0) {
          return { ok: false, error: `Kein Schluessel fuer: ${missing.join(', ')}` };
        }

        try {
          const encryptionKeys = await Promise.all(
            recipientEmails.map((email) => openpgp.readKey({ armoredKey: peerKeys.get(email)! })),
          );
          const message = await openpgp.createMessage({ text: bodyText });
          bodyText = String(await openpgp.encrypt({
            message,
            encryptionKeys,
          }));
        } catch {
          return { ok: false, error: 'PGP-Verschluesselung konnte nicht erstellt werden' };
        }
      }

      return { ok: true, bodyText };
    },

    async prepareOutboundAttachments(input) {
      if (!input.encrypt && !input.sign) {
        return {
          ok: true,
          attachments: input.attachments.map((attachment) => ({
            filename: attachment.filename,
            ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
            content: Buffer.from(attachment.bytes),
          })),
        };
      }

      const openpgp = await importOpenPgp();
      let signingKey: Awaited<ReturnType<OpenPgpModule['decryptKey']>> | undefined;
      let encryptionKeys: Array<Awaited<ReturnType<OpenPgpModule['readKey']>>> = [];

      if (input.sign) {
        if (!input.passphrase) return { ok: false, error: 'PGP-Passphrase fuer Signatur erforderlich' };
        const identity = await loadPrimaryPrivateIdentity(options, input.workspaceId, input.actorUserId);
        if (!identity?.private_key_secret_id) {
          return { ok: false, error: 'Kein passender privater PGP-Schluessel verfuegbar' };
        }
        const privateKeyArmored = await readPrivateKeyArmored(options, {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          identity,
          passphrase: input.passphrase,
        });
        if (!privateKeyArmored.ok) return { ok: false, error: privateKeyArmored.error };
        try {
          const privateKey = await openpgp.readPrivateKey({
            armoredKey: privateKeyArmored.value.toString('utf8'),
          });
          signingKey = await openpgp.decryptKey({
            privateKey,
            passphrase: input.passphrase,
          });
        } catch {
          return { ok: false, error: 'PGP-Signatur konnte nicht erstellt werden' };
        } finally {
          privateKeyArmored.value.fill(0);
        }
      }

      if (input.encrypt) {
        const recipientEmails = normalizeRecipientEmails(input.recipientEmails);
        if (recipientEmails.length === 0) return { ok: false, error: 'Keine Empfaenger-Schluessel' };

        const peerKeys = await loadRecipientPeerKeys(options, input.workspaceId, recipientEmails);
        const missing = recipientEmails.filter((email) => !peerKeys.has(email));
        if (missing.length > 0) {
          return { ok: false, error: `Kein Schluessel fuer: ${missing.join(', ')}` };
        }

        try {
          encryptionKeys = await Promise.all(
            recipientEmails.map((email) => openpgp.readKey({ armoredKey: peerKeys.get(email)! })),
          );
        } catch {
          return { ok: false, error: 'PGP-Verschluesselung konnte nicht erstellt werden' };
        }
      }

      const prepared: Array<{ filename: string; contentType?: string; content: Buffer }> = [];
      try {
        for (const attachment of input.attachments) {
          const content = Buffer.from(attachment.bytes);
          if (input.encrypt) {
            const message = await openpgp.createMessage({ binary: content });
            const encrypted = await openpgp.encrypt({
              message,
              encryptionKeys,
              ...(signingKey ? { signingKeys: signingKey } : {}),
            });
            prepared.push({
              filename: pgpEncryptedAttachmentName(attachment.filename),
              contentType: 'application/pgp-encrypted',
              content: Buffer.from(String(encrypted), 'utf8'),
            });
          } else {
            prepared.push({
              filename: attachment.filename,
              ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
              content,
            });
            if (signingKey) {
              const message = await openpgp.createMessage({ binary: content });
              const signature = await openpgp.sign({
                message,
                signingKeys: signingKey,
                detached: true,
              });
              prepared.push({
                filename: pgpSignatureAttachmentName(attachment.filename),
                contentType: 'application/pgp-signature',
                content: Buffer.from(String(signature), 'utf8'),
              });
            }
          }
        }
      } catch {
        return {
          ok: false,
          error: input.encrypt
            ? 'PGP-Anhangverschluesselung konnte nicht erstellt werden'
            : 'PGP-Anhangsignatur konnte nicht erstellt werden',
        };
      }
      return { ok: true, attachments: prepared };
    },
  };
}

async function loadMessageAndIdentity(
  options: PostgresPgpMessageCryptoPortOptions,
  input: PgpDecryptInput,
) {
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      role: 'user',
    },
    async (trx) => {
      const message = await trx
        .selectFrom('email_messages')
        .select(['id', 'body_text', 'body_html'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .executeTakeFirst();

      const identity = await trx
        .selectFrom('pgp_identities')
        .select(['id', 'fingerprint', 'private_key_secret_id'])
        .where('workspace_id', '=', input.workspaceId)
        .where('user_id', '=', input.actorUserId)
        .where('has_private_key', '=', true)
        .where('private_key_secret_id', 'is not', null)
        .orderBy('is_primary', 'desc')
        .orderBy('id', 'asc')
        .executeTakeFirst();

      return { message: message ?? null, identity: identity ?? null };
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function loadPgpMessageBodies(
  options: PostgresPgpMessageCryptoPortOptions,
  input: PgpDetectInput | PgpVerifyInput,
) {
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      role: 'user',
    },
    async (trx) => {
      const row = await trx
        .selectFrom('email_messages')
        .select(['id', 'body_text', 'body_html'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .executeTakeFirst();
      return row ?? null;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function loadSignedMessage(
  options: PostgresPgpMessageCryptoPortOptions,
  input: PgpVerifyInput,
) {
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      role: 'user',
    },
    async (trx) => {
      const row = await trx
        .selectFrom('email_messages')
        .select(['id', 'body_text', 'body_html', 'from_json'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .executeTakeFirst();
      return row ?? null;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function loadPrimaryPrivateIdentity(
  options: PostgresPgpMessageCryptoPortOptions,
  workspaceId: string,
  actorUserId: string,
) {
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId,
      userId: actorUserId,
      role: 'user',
    },
    async (trx) => {
      const row = await trx
        .selectFrom('pgp_identities')
        .select(['id', 'fingerprint', 'private_key_secret_id'])
        .where('workspace_id', '=', workspaceId)
        .where('user_id', '=', actorUserId)
        .where('has_private_key', '=', true)
        .where('private_key_secret_id', 'is not', null)
        .orderBy('is_primary', 'desc')
        .orderBy('id', 'asc')
        .executeTakeFirst();
      return row ?? null;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function readPrivateKeyArmored(
  options: PostgresPgpMessageCryptoPortOptions,
  input: {
    workspaceId: string;
    actorUserId: string;
    identity: {
      id: number;
      fingerprint: string;
      private_key_secret_id: string | null;
    };
    passphrase: string;
  },
): Promise<{ ok: true; value: Buffer } | { ok: false; error: string }> {
  const secretIdentifier = pgpIdentityPrivateKeySecretIdentifier(input.workspaceId, Number(input.identity.id));
  let serializedEnvelope: Buffer | null;
  try {
    serializedEnvelope = await options.secrets.readSecret(secretIdentifier);
  } catch {
    return { ok: false, error: 'PGP Private-Key-Secret ist nicht verfuegbar' };
  }
  if (!serializedEnvelope) return { ok: false, error: 'PGP Private-Key-Secret ist nicht verfuegbar' };

  try {
    return {
      ok: true,
      value: await decryptPgpPrivateKeyWithPassphrase({
        envelope: deserializePgpPrivateKeyEnvelope(serializedEnvelope),
        passphrase: input.passphrase,
        associatedData: {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          identityId: String(input.identity.id),
          fingerprint: input.identity.fingerprint,
        },
      }),
    };
  } catch {
    return { ok: false, error: 'PGP Private-Key konnte nicht entschluesselt werden' };
  } finally {
    serializedEnvelope.fill(0);
  }
}

async function loadRecipientPeerKeys(
  options: PostgresPgpMessageCryptoPortOptions,
  workspaceId: string,
  recipientEmails: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      for (const email of recipientEmails) {
        const row = await trx
          .selectFrom('pgp_peer_keys')
          .select(['public_key_armor', 'trust_level'])
          .where('workspace_id', '=', workspaceId)
          .where(kyselySql<boolean>`lower(email) = ${email}`)
          .where('trust_level', 'in', [...ENCRYPTABLE_TRUST_LEVELS])
          .orderBy(kyselySql<number>`
            CASE trust_level
              WHEN 'verified' THEN 0
              WHEN 'tofu' THEN 1
              WHEN 'imported' THEN 2
              ELSE 3
            END
          `, 'asc')
          .orderBy('id', 'desc')
          .executeTakeFirst();
        if (row?.public_key_armor) result.set(email, row.public_key_armor);
      }
    },
    { applySession: options.applyWorkspaceSession },
  );
  return result;
}

async function loadSenderPeerKeys(
  options: PostgresPgpMessageCryptoPortOptions,
  workspaceId: string,
  senderEmail: string,
): Promise<Array<{
  fingerprint: string;
  publicKeyArmor: string;
  trustLevel: string;
}>> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const rows = await trx
        .selectFrom('pgp_peer_keys')
        .select(['fingerprint', 'public_key_armor', 'trust_level'])
        .where('workspace_id', '=', workspaceId)
        .where(kyselySql<boolean>`lower(email) = ${senderEmail.trim().toLowerCase()}`)
        .orderBy(kyselySql<number>`
          CASE trust_level
            WHEN 'verified' THEN 0
            WHEN 'tofu' THEN 1
            WHEN 'imported' THEN 2
            ELSE 3
          END
        `, 'asc')
        .orderBy('id', 'desc')
        .execute();
      return rows.map((row) => ({
        fingerprint: row.fingerprint,
        publicKeyArmor: row.public_key_armor,
        trustLevel: row.trust_level,
      }));
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function updateMessagePgpDetectionStatus(
  options: PostgresPgpMessageCryptoPortOptions,
  input: PgpDetectInput,
  status: 'encrypted_unread' | 'signed_unknown_key',
): Promise<void> {
  await withWorkspaceTransaction(
    options.db,
    {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      role: 'user',
    },
    async (trx) => {
      await trx
        .updateTable('email_messages')
        .set({
          pgp_status: status,
          pgp_signer_fingerprint: null,
          updated_at: new Date(),
        })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .execute();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function updateMessagePgpSignatureStatus(
  options: PostgresPgpMessageCryptoPortOptions,
  input: PgpVerifyInput,
  status: string,
  signerFingerprint: string | null,
): Promise<void> {
  await withWorkspaceTransaction(
    options.db,
    {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      role: 'user',
    },
    async (trx) => {
      await trx
        .updateTable('email_messages')
        .set({
          pgp_status: status,
          pgp_signer_fingerprint: signerFingerprint,
          updated_at: new Date(),
        })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.messageId)
        .execute();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function detectInboundPgpStatus(
  bodyText: string | null,
  bodyHtml: string | null,
): 'encrypted_unread' | 'signed_unknown_key' | null {
  const textHead = (bodyText ?? '').trimStart();
  const htmlHead = (bodyHtml ?? '').trimStart();
  if (textHead.startsWith(PGP_MESSAGE_BEGIN) || htmlHead.startsWith(PGP_MESSAGE_BEGIN)) {
    return 'encrypted_unread';
  }
  if (
    textHead.startsWith(PGP_SIGNED_MESSAGE_BEGIN)
    || htmlHead.startsWith(PGP_SIGNED_MESSAGE_BEGIN)
  ) {
    return 'signed_unknown_key';
  }
  return null;
}

function extractArmoredPgpMessage(...bodies: Array<string | null>): string | null {
  for (const body of bodies) {
    if (!body) continue;
    const begin = body.indexOf(PGP_MESSAGE_BEGIN);
    if (begin < 0) continue;
    const end = body.indexOf(PGP_MESSAGE_END, begin);
    return end < 0
      ? body.slice(begin).trim()
      : body.slice(begin, end + PGP_MESSAGE_END.length).trim();
  }
  return null;
}

function extractArmoredPgpSignedMessage(...bodies: Array<string | null>): string | null {
  for (const body of bodies) {
    if (!body) continue;
    const begin = body.indexOf(PGP_SIGNED_MESSAGE_BEGIN);
    if (begin < 0) continue;
    const end = body.indexOf(PGP_SIGNATURE_END, begin);
    return end < 0
      ? body.slice(begin).trim()
      : body.slice(begin, end + PGP_SIGNATURE_END.length).trim();
  }
  return null;
}

async function readPgpMessageFromBytes(
  openpgp: OpenPgpModule,
  bytes: Uint8Array,
): Promise<Awaited<ReturnType<OpenPgpModule['readMessage']>>> {
  const armoredMessage = extractArmoredPgpMessage(Buffer.from(bytes).toString('utf8'));
  if (armoredMessage) return openpgp.readMessage({ armoredMessage });
  return openpgp.readMessage({ binaryMessage: Buffer.from(bytes) });
}

async function readPgpSignatureFromBytes(
  openpgp: OpenPgpModule,
  bytes: Uint8Array,
): Promise<Awaited<ReturnType<OpenPgpModule['readSignature']>>> {
  const armoredSignature = extractArmoredPgpSignature(Buffer.from(bytes).toString('utf8'));
  if (armoredSignature) return openpgp.readSignature({ armoredSignature });
  return openpgp.readSignature({ binarySignature: Buffer.from(bytes) });
}

function extractArmoredPgpSignature(body: string | null): string | null {
  if (!body) return null;
  const begin = body.indexOf(PGP_SIGNATURE_BEGIN);
  if (begin < 0) return null;
  const end = body.indexOf(PGP_SIGNATURE_END, begin);
  return end < 0
    ? body.slice(begin).trim()
    : body.slice(begin, end + PGP_SIGNATURE_END.length).trim();
}

function normalizeRecipientEmails(values: readonly string[]): string[] {
  const emails: string[] = [];
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!email || emails.includes(email)) continue;
    emails.push(email);
  }
  return emails;
}

function pgpDecryptedAttachmentName(filename: string): string {
  const base = filename.trim() || 'attachment';
  const stripped = base.replace(/\.(?:pgp|gpg|asc)$/i, '').trim();
  return stripped || `${base}.decrypted`;
}

function pgpEncryptedAttachmentName(filename: string): string {
  const base = filename.trim() || 'attachment';
  return /\.pgp$/i.test(base) || /\.gpg$/i.test(base) || /\.asc$/i.test(base)
    ? base
    : `${base}.pgp`;
}

function pgpSignatureAttachmentName(filename: string): string {
  const base = filename.trim() || 'attachment';
  return `${base}.asc`;
}

function firstAddressFromRecipientJson(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return '';
    }
  }
  if (!parsed || typeof parsed !== 'object') return '';
  const first = (parsed as { value?: unknown }).value;
  if (Array.isArray(first)) {
    const address = (first[0] as { address?: unknown } | undefined)?.address;
    return typeof address === 'string' ? address.trim().toLowerCase() : '';
  }
  return '';
}

function normalizeFingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

function fingerprintMatchesSignature(fingerprint: string, signerKeyId: string): boolean {
  const normalizedFingerprint = normalizeFingerprint(fingerprint);
  const normalizedKeyId = normalizeFingerprint(signerKeyId);
  return Boolean(
    normalizedFingerprint
      && normalizedKeyId
      && (normalizedFingerprint === normalizedKeyId || normalizedFingerprint.endsWith(normalizedKeyId)),
  );
}

function isEncryptableTrustLevel(value: string): boolean {
  return (ENCRYPTABLE_TRUST_LEVELS as readonly string[]).includes(value);
}

function isVerifiedSignatureTrustLevel(value: string): boolean {
  return (VERIFIED_SIGNATURE_TRUST_LEVELS as readonly string[]).includes(value);
}

function decryptedDataToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf8');
  return String(data ?? '');
}

function decryptedDataToBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(String(data ?? ''), 'utf8');
}
