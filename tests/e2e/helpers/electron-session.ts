import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const SETUP_USERNAME = 'e2e-owner';
const SETUP_PASSWORD = 'SimpleCRME2E123!';

export interface ElectronTestSession {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  logPath: string;
  close: () => Promise<void>;
}

export async function readAuthenticated(page: Page): Promise<boolean> {
  const session = await page.evaluate(async () => {
    const api = (window as unknown as {
      electronAPI?: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
    }).electronAPI;
    if (!api) return null;
    return api.invoke('auth:get-session', undefined);
  });
  return Boolean(
    session
      && typeof session === 'object'
      && (session as { authenticated?: boolean }).authenticated === true,
  );
}

export async function ensureAuthenticated(page: Page): Promise<void> {
  if (!(await readAuthenticated(page))) {
    const loginResult = await page.evaluate(
      async ({ username, passphrase }) => {
        const api = (window as unknown as {
          electronAPI: { invoke: (channel: string, payload: unknown) => Promise<unknown> };
        }).electronAPI;
        return api.invoke('auth:login', { username, passphrase });
      },
      { username: SETUP_USERNAME, passphrase: SETUP_PASSWORD },
    );
    expect(
      loginResult
        && typeof loginResult === 'object'
        && (loginResult as { success?: boolean }).success,
    ).toBe(true);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => readAuthenticated(page), { timeout: 20_000 }).toBe(true);
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 20_000 });
}

export async function launchAuthenticatedElectron(name: string): Promise<ElectronTestSession> {
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `simplecrm-${safeName}-`));
  const logDir = path.resolve(process.env.SIMPLECRM_E2E_LOG_DIR || path.join('test-results', 'electron-logs'));
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${safeName}-${Date.now()}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.on('error', () => undefined);
  const writeLog = (source: string, value: unknown) => {
    if (!logStream.destroyed) {
      logStream.write(`[${new Date().toISOString()}] [${source}] ${String(value)}\n`);
    }
  };
  const closeLog = () => new Promise<void>((resolve) => {
    if (logStream.closed || logStream.destroyed) {
      resolve();
      return;
    }
    logStream.end(resolve);
  });

  fs.writeFileSync(
    path.join(userDataDir, 'config.json'),
    `${JSON.stringify({ version: 1, mode: 'standalone', selectedAt: new Date().toISOString() }, null, 2)}\n`,
  );

  const mainPath = path.resolve(process.cwd(), 'dist-electron/main.js');
  const launchArgs = [mainPath, `--user-data-dir=${userDataDir}`, '--disable-gpu'];
  if (process.env.SIMPLECRM_E2E_NO_SANDBOX === '1') {
    launchArgs.push('--no-sandbox');
  }

  let app: ElectronApplication;
  try {
    writeLog('launch', `starting ${launchArgs.join(' ')}`);
    app = await electron.launch({
      args: launchArgs,
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 30_000,
    });
    writeLog('launch', 'connected');
  } catch (error) {
    writeLog('launch-error', error instanceof Error ? error.stack || error.message : error);
    await closeLog();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  const child = app.process();
  child.stdout?.on('data', (chunk) => writeLog('electron-stdout', chunk));
  child.stderr?.on('data', (chunk) => writeLog('electron-stderr', chunk));
  child.on('exit', (code, signal) => writeLog('electron-exit', `code=${code ?? 'null'} signal=${signal ?? 'null'}`));
  app.on('console', (message) => writeLog('electron-console', `${message.type()}: ${message.text()}`));

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    let closeTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        closeTimer = setTimeout(() => {
          writeLog('electron-close', 'timed out; terminating test process');
          const processId = app.process().pid;
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(processId), '/T', '/F'], { windowsHide: true });
          } else {
            app.process().kill('SIGKILL');
          }
          resolve();
        }, 10_000);
      }),
    ]);
    if (closeTimer) clearTimeout(closeTimer);
    await closeLog();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };

  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    writeLog('launch', 'first window ready');
    page.on('console', (message) => writeLog('renderer-console', `${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => writeLog('renderer-pageerror', error.stack || error.message));
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Ersteinrichtung', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.locator('#setup-username').fill(SETUP_USERNAME);
    await page.locator('#setup-pass').fill(SETUP_PASSWORD);
    await page.locator('#setup-pass2').fill(SETUP_PASSWORD);
    await page.getByRole('button', { name: 'Einmal-Passwort abrufen' }).click();
    await expect(page.locator('#setup-token')).not.toHaveValue('', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Passwort setzen' }).click();
    await expect.poll(() => readAuthenticated(page), { timeout: 30_000 }).toBe(true);
    await ensureAuthenticated(page);
    return { app, page, userDataDir, logPath, close };
  } catch (error) {
    await close();
    throw error;
  }
}
