import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { requireRealAuthSession } from '../auth/current-user';
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
} from '../pgp/pgp-service';

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
      async (_event, payload: { armored: string }) => {
        return importPublicKeyArmored(payload.armored);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DecryptMessage,
      async (event, payload: { messageId: number; passphrase: string }) => {
        const session = requireRealAuthSession(event);
        return decryptMessageBody(payload.messageId, payload.passphrase, session.userId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DetectInbound,
      async (_event, payload: { messageId: number }) => {
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
        requireRealAuthSession(event);
        return verifySignedMessage(payload.messageId);
      },
      { logger, requireAuth: true, requireRealSession: true },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export { deletePgpIdentity };
