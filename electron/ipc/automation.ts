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
  parseScopesInput,
} from '../automation/settings';
import { restartAutomationApiServer } from '../automation/server';

type Disposer = () => void;

export function registerAutomationHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): Disposer {
  const { logger } = options;
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Automation.GetSettings, async () => getAutomationApiSettings(), {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Automation.SetSettings,
      async (
        _event: IpcMainInvokeEvent,
        payload: { enabled?: boolean; port?: number; bindLan?: boolean },
      ) => {
        setAutomationApiSettings(payload);
        await restartAutomationApiServer(logger);
        return { success: true as const };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Automation.GenerateApiKey,
      async (_event: IpcMainInvokeEvent, payload?: { scopes?: AutomationScope[] }) => {
        const key = generateApiKeyToken();
        const scopes = parseScopesInput(payload?.scopes);
        await saveApiCredentials({ key, scopes, createdAt: new Date().toISOString() });
        await restartAutomationApiServer(logger);
        return {
          success: true as const,
          key,
          scopes,
          hint: 'Key wird nur einmal angezeigt. In n8n als Bearer-Token speichern.',
        };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Automation.RevokeApiKey, async () => {
      await revokeApiCredentials();
      await restartAutomationApiServer(logger);
      return { success: true as const };
    }, { logger }),
  );

  return () => disposers.forEach((d) => d());
}
