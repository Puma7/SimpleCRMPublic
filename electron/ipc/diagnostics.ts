import path from 'node:path';
import { app, type IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getAppLogStore } from '../diagnostics/app-log-store';
import { installAppLogCapture } from '../diagnostics/app-log-capture';
import type { AppLogLevel } from '../diagnostics/app-log-store';

type Disposer = () => void;

let captureRestore: (() => void) | null = null;

function resolveLogFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'logs', 'app-events.jsonl');
  } catch {
    return path.join(process.cwd(), '.tmp', 'app-events.jsonl');
  }
}

function ensureAppLogStore(): ReturnType<typeof getAppLogStore> {
  const filePath = resolveLogFilePath();
  const store = getAppLogStore(filePath);
  if (!captureRestore) {
    captureRestore = installAppLogCapture(store, console);
  }
  return store;
}

export function registerDiagnosticsHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): Disposer {
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(
      IPCChannels.Diagnostics.GetServerLogs,
      async (_event: IpcMainInvokeEvent, payload: { level?: AppLogLevel; limit?: number } = {}) => {
        const store = ensureAppLogStore();
        return store.recent({
          level: payload.level ?? 'warn',
          limit: payload.limit ?? 1000,
        });
      },
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Diagnostics.ClearServerLogs,
      async () => {
        ensureAppLogStore().clear();
        return { success: true as const };
      },
      { logger: options.logger, requireAuth: true, requireRealSession: true },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Diagnostics.SelfTestServerLogs,
      async () => {
        const written = ensureAppLogStore().selfTest();
        return { written };
      },
      { logger: options.logger, requireAuth: true, requireRealSession: true },
    ),
  );

  return () => {
    for (const d of disposers) d();
    if (captureRestore) {
      captureRestore();
      captureRestore = null;
    }
  };
}
