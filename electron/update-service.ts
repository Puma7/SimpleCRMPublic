import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

type ManualUpdate = {
  releasePageUrl: string | null;
};

export type UpdateStatusPayload = {
  status: UpdateStatus;
  info?: unknown;
  error?: string;
  /** Set when this platform does not download or install updates itself. */
  manualUpdate?: ManualUpdate;
};

const STATUS_CHANNEL = 'update:status';
const PROGRESS_CHANNEL = 'update:download-progress';

// F-A7-10: The macOS builds are neither signed nor notarized. Squirrel.Mac
// rejects such updates, and nothing but the sha512 from the same release
// vouches for the download. Until the app is signed (docs/RELEASE.md), macOS
// only reports a new version and links to the release page; Windows is
// unchanged. Removing 'darwin' here re-enables automatic updates on macOS.
const MANUAL_UPDATE_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin']);

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

let getMainWindow: () => BrowserWindow | null = () => null;

let manualUpdate: ManualUpdate | null = null;

let currentStatus: UpdateStatusPayload = {
  status: 'idle',
};

function sendToRenderer(channel: string, payload: unknown) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  try {
    win.webContents.send(channel, payload);
  } catch (error) {
    log.error('[AutoUpdate] Failed to send IPC message:', error);
  }
}

function updateStatus(next: UpdateStatusPayload) {
  currentStatus = manualUpdate ? { ...next, manualUpdate } : next;
  sendToRenderer(STATUS_CHANNEL, currentStatus);
}

/**
 * Release page of the repository the updater reads from, taken from the
 * app-update.yml that electron-builder writes into the app resources.
 */
function readReleasePageUrl(updateConfigPath: string): string | null {
  let config: string;
  try {
    config = readFileSync(updateConfigPath, 'utf8');
  } catch {
    return null;
  }
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*['"]?([^'"\\s]+)['"]?[ \\t]*$`, 'm').exec(config)?.[1];
  const owner = field('owner');
  const repo = field('repo');
  if (field('provider') !== 'github' || !owner || !repo || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    return null;
  }
  return `https://github.com/${owner}/${repo}/releases`;
}

export function initializeAutoUpdater(options: {
  getMainWindow: () => BrowserWindow | null;
  logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  platform?: NodeJS.Platform;
  updateConfigPath?: string;
}) {
  const { logger = console } = options;

  getMainWindow = options.getMainWindow;

  const platform = options.platform ?? process.platform;
  manualUpdate = MANUAL_UPDATE_PLATFORMS.has(platform)
    ? {
      releasePageUrl: readReleasePageUrl(
        options.updateConfigPath ?? path.join(process.resourcesPath ?? '', 'app-update.yml'),
      ),
    }
    : null;
  currentStatus = manualUpdate ? { status: 'idle', manualUpdate } : { status: 'idle' };

  autoUpdater.logger = log;
  autoUpdater.autoDownload = manualUpdate === null;
  autoUpdater.autoInstallOnAppQuit = manualUpdate === null;

  logger.info(
    manualUpdate
      ? `[AutoUpdate] Initializing update check without download or install on ${platform}`
      : '[AutoUpdate] Initializing auto-updater',
  );

  autoUpdater.on('checking-for-update', () => {
    logger.info('[AutoUpdate] Checking for update...');
    updateStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    logger.info('[AutoUpdate] Update available:', info);
    updateStatus({ status: 'available', info });
  });

  autoUpdater.on('update-not-available', (info) => {
    logger.info('[AutoUpdate] No update available:', info);
    updateStatus({ status: 'not-available', info });
  });

  autoUpdater.on('error', (error) => {
    logger.error('[AutoUpdate] Error in auto-updater:', error);
    updateStatus({ status: 'error', error: error == null ? 'Unknown error' : String(error) });
  });

  autoUpdater.on('download-progress', (progress) => {
    logger.info(
      `[AutoUpdate] Download progress: ${progress.percent?.toFixed?.(2) ?? '0'}% (${progress.transferred}/${progress.total})`,
    );
    sendToRenderer(PROGRESS_CHANNEL, progress);
    updateStatus({ status: 'downloading', info: progress });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('[AutoUpdate] Update downloaded:', info);
    updateStatus({ status: 'downloaded', info });
  });
}

export function getUpdateStatus(): UpdateStatusPayload {
  return currentStatus;
}

export async function checkForUpdatesAndNotify() {
  return autoUpdater.checkForUpdatesAndNotify();
}

export async function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}

export function quitAndInstall() {
  if (manualUpdate) {
    throw new Error('Updates werden auf macOS nicht automatisch installiert. Bitte die neue Version von der Release-Seite herunterladen.');
  }
  log.info('[AutoUpdate] Quitting and installing update');
  autoUpdater.quitAndInstall();
}

