import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { requireAuthSession } from '../auth/current-user';
import {
  listPgpIdentities,
  generatePgpIdentity,
  importPublicKeyArmored,
  decryptMessageBody,
  detectPgpInbound,
  deletePgpIdentity,
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
        const session = requireAuthSession(event);
        return listPgpIdentities(session.userId);
      },
      { logger, requireAuth: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.GenerateIdentity,
      async (event, payload: { email: string; passphrase: string }) => {
        const session = requireAuthSession(event);
        return generatePgpIdentity(session.userId, payload.email, payload.passphrase);
      },
      { logger, requireAuth: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.ImportPeerKey,
      async (_event, payload: { armored: string }) => {
        return importPublicKeyArmored(payload.armored);
      },
      { logger, requireAuth: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DecryptMessage,
      async (event, payload: { messageId: number; passphrase: string }) => {
        requireAuthSession(event);
        return decryptMessageBody(payload.messageId, payload.passphrase);
      },
      { logger, requireAuth: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Pgp.DetectInbound,
      async (_event, payload: { messageId: number }) => {
        detectPgpInbound(payload.messageId);
        return { success: true as const };
      },
      { logger },
    ),
  );

  return () => disposers.forEach((d) => d());
}

export { deletePgpIdentity };
