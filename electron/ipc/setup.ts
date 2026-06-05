import { app, IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import {
  readElectronDeployConfig,
  writeElectronDeployConfig,
  type ElectronDeployConfigInput,
} from '../setup/deploy-config';

type Disposer = () => void;

export function registerSetupHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  getUserDataDir?: () => string;
  now?: () => Date;
}): Disposer {
  const { logger } = options;
  const getUserDataDir = options.getUserDataDir ?? (() => app.getPath('userData'));
  const now = options.now ?? (() => new Date());
  const disposers: Disposer[] = [];

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.GetDeployConfig,
    async () => readElectronDeployConfig(getUserDataDir()),
    { logger, requireAuth: false },
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.SaveDeployConfig,
    async (_event: IpcMainInvokeEvent, payload: ElectronDeployConfigInput) => {
      try {
        const config = await writeElectronDeployConfig(getUserDataDir(), payload, { now: now() });
        return { success: true as const, config };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
        logger.warn('[setup] could not save deploy config', { error: message });
        return { success: false as const, error: message };
      }
    },
    { logger, requireAuth: false },
  ));

  return () => disposers.forEach((dispose) => dispose());
}
