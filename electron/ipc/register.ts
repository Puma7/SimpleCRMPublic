import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { z, ZodTypeAny } from 'zod';
import { InvokeChannel } from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema, isDeprecatedChannel } from '../../shared/ipc/schemas';
import { getSessionFromEvent, touchSessionActivity } from '../auth/session-store';
import { resolveAuthContext } from '../auth/current-user';
import type { SessionRole } from '../auth/session-store';
import { getDb } from '../sqlite-service';
import { canAccessAccount, type AccountAccessLevel } from '../auth/account-access';
import { ipcChannelRequiresAuth } from '../../shared/ipc/channel-auth-policy';
import { resolveEmailChannelAccountId } from './ipc-account-scope';

export interface RegisterIpcOptions {
  logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  onDeprecatedUse?: (channel: InvokeChannel) => void;
  requireAuth?: boolean;
  /** When true with requireAuth, synthetic bootstrap session is rejected. */
  requireRealSession?: boolean;
  requireRole?: SessionRole[];
  accountScope?: (payload: unknown) => number | undefined;
  accountAccess?: AccountAccessLevel;
}

export type IpcHandler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  payload: any,
) => Promise<unknown> | unknown;

function parseWithSchema(schema: ZodTypeAny, value: unknown) {
  // Skip parsing for permissive schemas. instanceof works in both zod v3 and v4
  // (v4 removed the ZodFirstPartyTypeKind enum that the previous check used).
  if (!schema || schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return value;
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw result.error;
}

export function registerIpcHandler<C extends InvokeChannel>(
  channel: C,
  handler: IpcHandler<C>,
  options: RegisterIpcOptions = {},
) {
  const {
    logger = console,
    onDeprecatedUse,
    requireAuth: requireAuthOption,
    requireRealSession = false,
    requireRole,
    accountScope,
    accountAccess = 'ro',
  } = options;
  const requireAuth = requireAuthOption ?? ipcChannelRequiresAuth(channel);
  const payloadSchema = getPayloadSchema(channel);
  const resultSchema = getResultSchema(channel);
  const deprecated = isDeprecatedChannel(channel);

  const wrappedHandler = async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (deprecated && onDeprecatedUse) {
        onDeprecatedUse(channel);
      }

      const payload = args.length <= 1 ? args[0] : args;
      const parsedPayload = parseWithSchema(payloadSchema, payload);

      if (requireAuth) {
        const session = requireRealSession
          ? getSessionFromEvent(event)
          : resolveAuthContext(event);
        if (!session) throw new Error('Nicht angemeldet');
        if (!requireRealSession && getSessionFromEvent(event)) {
          touchSessionActivity(event.sender.id);
        }
        if (requireRole && !requireRole.includes(session.role)) {
          throw new Error('Keine Berechtigung');
        }
        const accountId =
          accountScope?.(parsedPayload) ?? resolveEmailChannelAccountId(channel, parsedPayload);
        if (accountId != null) {
          const db = getDb();
          if (!db) throw new Error('Database not initialized');
          if (!canAccessAccount(db, session.userId, accountId, accountAccess, session.role)) {
            throw new Error('Kein Zugriff auf dieses Konto');
          }
        }
      }

      const result = await handler(event, parsedPayload);
      return parseWithSchema(resultSchema, result);
    } catch (error) {
      logger.error(`[IPC] Handler error for ${channel}:`, error);
      throw error;
    }
  };

  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, wrappedHandler);

  return () => ipcMain.removeHandler(channel);
}
