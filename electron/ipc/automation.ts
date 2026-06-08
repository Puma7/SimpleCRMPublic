import { IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import type { AutomationScope } from '../../shared/automation-api';
import { registerIpcHandler } from './register';
import {
  generateApiKeyToken,
  saveApiCredentials,
  revokeApiCredentials,
} from '../automation/automation-keytar';
import {
  getAutomationApiSettings,
  setAutomationApiSettings,
  parseScopesForKeyGeneration,
} from '../automation/settings';
import { restartAutomationApiServer } from '../automation/server';

const ADMIN_IPC_ROLES = ['owner', 'admin'] as const;

type Disposer = () => void;

export function registerAutomationHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): Disposer {
  const { logger } = options;
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Automation.GetSettings, async () => getAutomationApiSettings(), {
      logger,
      requireRole: [...ADMIN_IPC_ROLES],
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Automation.SetSettings,
      async (
        _event: IpcMainInvokeEvent,
        payload: { enabled?: boolean; port?: number; bindLan?: boolean },
      ) => {
        if (payload.port !== undefined) {
          const p = Math.floor(payload.port);
          if (!Number.isFinite(p) || p < 1024 || p > 65535) {
            return { success: false as const, error: 'Port muss zwischen 1024 und 65535 liegen' };
          }
        }
        setAutomationApiSettings(payload);
        await restartAutomationApiServer(logger);
        return { success: true as const };
      },
      { logger, requireRole: [...ADMIN_IPC_ROLES] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Automation.GenerateApiKey,
      async (_event: IpcMainInvokeEvent, payload?: { scopes?: AutomationScope[] }) => {
        const scopes = parseScopesForKeyGeneration(payload?.scopes);
        if (scopes.length === 0) {
          return { success: false as const, error: 'Mindestens ein Scope auswählen' };
        }
        const key = generateApiKeyToken();
        await saveApiCredentials({ key, scopes, createdAt: new Date().toISOString() });
        await restartAutomationApiServer(logger);
        return {
          success: true as const,
          key,
          scopes,
          hint: 'Key wird nur einmal angezeigt. In n8n als Bearer-Token speichern.',
        };
      },
      { logger, requireRole: [...ADMIN_IPC_ROLES] },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Automation.RevokeApiKey, async () => {
      await revokeApiCredentials();
      await restartAutomationApiServer(logger);
      return { success: true as const };
    }, { logger, requireRole: [...ADMIN_IPC_ROLES] }),
  );

  return () => disposers.forEach((d) => d());
}
