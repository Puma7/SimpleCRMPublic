import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { z, ZodTypeAny } from 'zod';
import { InvokeChannel } from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema, isDeprecatedChannel } from '../../shared/ipc/schemas';

export interface RegisterIpcOptions {
  logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  onDeprecatedUse?: (channel: InvokeChannel) => void;
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
  const { logger = console, onDeprecatedUse } = options;
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
