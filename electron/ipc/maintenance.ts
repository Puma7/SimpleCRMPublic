import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import {
  executeDesktopHardReset,
  getDesktopMaintenanceStatus,
  previewDesktopHardReset,
  runDesktopRepair,
} from '../maintenance/reset-service';
import { getUpdateStatus, checkForUpdates, quitAndInstall } from '../update-service';

type Disposer = () => void;

export function registerMaintenanceHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  appVersion: string;
}): Disposer {
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.GetStatus,
      async () => getDesktopMaintenanceStatus(options.appVersion),
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.RunDoctor,
      async () => ({ ok: false, error: 'Doctor ist nur in der Server-Edition verfügbar' }),
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.CheckMigrations,
      async () => ({ ok: false, error: 'Migrationen sind nur in der Server-Edition verfügbar' }),
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.RunRepair,
      async () => runDesktopRepair(options.logger),
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.PreviewHardReset,
      async () => previewDesktopHardReset(),
      { logger: options.logger, requireRole: ['owner'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.ExecuteHardReset,
      async (_event, payload: { confirmPhrase?: string; acknowledgeDataLoss?: boolean }) => executeDesktopHardReset({
        confirmPhrase: String(payload?.confirmPhrase ?? ''),
        acknowledgeDataLoss: payload?.acknowledgeDataLoss === true,
      }),
      { logger: options.logger, requireRole: ['owner'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.CheckForUpdates,
      async () => {
        try {
          const info = await checkForUpdates();
          return { success: true as const, info, status: getUpdateStatus() };
        } catch (error) {
          return {
            success: false as const,
            error: error instanceof Error ? error.message : String(error),
            status: getUpdateStatus(),
          };
        }
      },
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.InstallUpdate,
      async () => {
        quitAndInstall();
        return { success: true as const };
      },
      { logger: options.logger, requireRole: ['owner', 'admin'] },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Maintenance.GetUpdateStatus,
      async () => getUpdateStatus(),
      { logger: options.logger },
    ),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
