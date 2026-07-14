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
  let saveQueue: Promise<void> = Promise.resolve();

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.GetDeployConfig,
    async () => readElectronDeployConfig(getUserDataDir()),
    { logger, requireAuth: false },
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.SaveDeployConfig,
    async (_event: IpcMainInvokeEvent, payload: ElectronDeployConfigInput) => {
      let result: { success: true; config: Awaited<ReturnType<typeof writeElectronDeployConfig>> }
        | { success: false; error: string } = {
          success: false,
          error: 'deploy config could not be saved',
        };
      const operation = saveQueue.then(async () => {
        const existing = await readElectronDeployConfig(getUserDataDir());
        if (existing.status === 'ok') {
          result = {
            success: false,
            error: 'deploy config is already configured; use authenticated maintenance to change it',
          };
          return;
        }
      try {
        const config = await writeElectronDeployConfig(getUserDataDir(), payload, { now: now() });
          result = { success: true, config };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
        logger.warn('[setup] could not save deploy config', { error: message });
          result = { success: false, error: message };
      }
      });
      saveQueue = operation.catch(() => undefined);
      await operation;
      return result;
    },
    { logger, requireAuth: false },
  ));

  return () => disposers.forEach((dispose) => dispose());
}
