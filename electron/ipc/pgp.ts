import type { IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { requireRealAuthSession } from '../auth/current-user';
import { canAccessAccount } from '../auth/account-access';
import { getEmailMessageById } from '../email/email-store';
import { getDb } from '../sqlite-service';
import {
  listPgpIdentities,
  generatePgpIdentity,
  importPublicKeyArmored,
  decryptMessageBody,
  detectPgpInbound,
  deletePgpIdentity,
  encryptPlaintextForRecipients,
  signPlaintext,
  verifySignedMessage,
  listPgpPeerKeys,
  deletePgpPeerKey,
  checkRecipientKeys,
} from '../pgp/pgp-service';

function requireMessageAccountAccess(event: IpcMainInvokeEvent, messageId: number) {
  const session = requireRealAuthSession(event);
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  const row = getEmailMessageById(messageId);
  if (!row) throw new Error('Nachricht nicht gefunden');
  if (!canAccessAccount(db, session.userId, row.account_id, 'ro', session.role)) {
    throw new Error('Kein Zugriff');
  }
  return session;
}

export function registerPgpHandlers(options: {
  logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): () => void {
  const { logger = console } = options;
  const disposers: Array<() => void> = [];

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.ListIdentities,
      async (event) => {
        const session = requireRealAuthSession(event);
        return listPgpIdentities(session.userId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.GenerateIdentity,
      async (event, payload: { email: string; passphrase: string }) => {
        const session = requireRealAuthSession(event);
        return generatePgpIdentity(session.userId, payload.email, payload.passphrase);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.ImportPeerKey,
      async (event, payload: { armored: string }) => {
        requireRealAuthSession(event);
        return importPublicKeyArmored(payload.armored);
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DecryptMessage,
      async (event, payload: { messageId: number; passphrase: string }) => {
        const session = requireMessageAccountAccess(event, payload.messageId);
        return decryptMessageBody(payload.messageId, payload.passphrase, session.userId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DetectInbound,
      async (event, payload: { messageId: number }) => {
        requireMessageAccountAccess(event, payload.messageId);
        detectPgpInbound(payload.messageId);
        return { success: true as const };
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.EncryptMessage,
      async (event, payload: { plaintext: string; recipientEmails: string[] }) => {
        const session = requireRealAuthSession(event);
        return encryptPlaintextForRecipients(payload.plaintext, payload.recipientEmails, session.userId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.SignMessage,
      async (event, payload: { plaintext: string; passphrase: string }) => {
        const session = requireRealAuthSession(event);
        return signPlaintext(payload.plaintext, session.userId, payload.passphrase);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.VerifyMessage,
      async (event, payload: { messageId: number }) => {
        requireMessageAccountAccess(event, payload.messageId);
        return verifySignedMessage(payload.messageId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.ListPeerKeys,
      async (event) => {
        requireRealAuthSession(event);
        return listPgpPeerKeys();
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DeletePeerKey,
      async (event, payload: { id: number }) => {
        requireRealAuthSession(event);
        deletePgpPeerKey(payload.id);
        return { success: true as const };
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.CheckRecipientKeys,
      async (event, payload: { emails: string[] }) => {
        requireRealAuthSession(event);
        return checkRecipientKeys(payload.emails);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DeleteIdentity,
      async (event, payload: { id: number }) => {
        requireRealAuthSession(event);
        await deletePgpIdentity(payload.id);
        return { success: true as const };
      },
      { logger, requireAuth: true, requireRealSession: true, requireRole: ['owner', 'admin'] },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export { deletePgpIdentity };
