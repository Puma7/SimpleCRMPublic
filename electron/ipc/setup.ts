import { app, dialog, IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import {
  readElectronDeployConfig,
  deleteElectronDeployConfig,
  writeElectronDeployConfig,
  type ElectronDeployConfigInput,
} from '../setup/deploy-config';

type Disposer = () => void;

export function registerSetupHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  getUserDataDir?: () => string;
  now?: () => Date;
  confirmDeployConfigReset?: () => Promise<boolean>;
  restartApp?: () => void;
}): Disposer {
  const { logger } = options;
  const getUserDataDir = options.getUserDataDir ?? (() => app.getPath('userData'));
  const now = options.now ?? (() => new Date());
  const confirmDeployConfigReset = options.confirmDeployConfigReset ?? (async () => {
    const response = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Abbrechen', 'Konfiguration zuruecksetzen'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Betriebsmodus aendern',
      message: 'Gespeicherte Betriebs- und Server-Konfiguration zuruecksetzen?',
      detail: 'Die App startet danach neu und zeigt die Ersteinrichtung. Lokale CRM-Daten werden nicht geloescht.',
    });
    return response.response === 1;
  });
  const restartApp = options.restartApp ?? (() => {
    app.relaunch();
    app.exit(0);
  });
  const disposers: Disposer[] = [];
  let saveQueue: Promise<void> = Promise.resolve();
  let resetInProgress = false;

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.GetDeployConfig,
    async () => readElectronDeployConfig(getUserDataDir()),
    { logger, requireAuth: false },
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Setup.ResetDeployConfig,
    async () => {
      let result: { success: true } | { success: false; error: string } = {
        success: false,
        error: 'deploy config could not be reset',
      };
      const operation = saveQueue.then(async () => {
        const existing = await readElectronDeployConfig(getUserDataDir());
        if (existing.status !== 'ok') {
          result = { success: false, error: 'deploy config is not configured' };
          return;
        }
        if (!await confirmDeployConfigReset()) {
          result = { success: false, error: 'deploy config reset was cancelled' };
          return;
        }
        resetInProgress = true;
        try {
          await deleteElectronDeployConfig(getUserDataDir());
        } catch (error) {
          resetInProgress = false;
          const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
          logger.warn('[setup] could not reset deploy config', { error: message });
          result = { success: false, error: message };
          return;
        }
        result = { success: true };
        restartApp();
      });
      saveQueue = operation.catch(() => undefined);
      await operation;
      return result;
    },
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
        if (resetInProgress) {
          result = { success: false, error: 'deploy config reset is in progress' };
          return;
        }
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
