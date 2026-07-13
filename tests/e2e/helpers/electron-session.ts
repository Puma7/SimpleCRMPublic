import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  fs.writeFileSync(
    path.join(userDataDir, 'config.json'),
    `${JSON.stringify({ version: 1, mode: 'standalone', selectedAt: new Date().toISOString() }, null, 2)}\n`,
  );

  const mainPath = path.resolve(process.cwd(), 'dist-electron/main.js');
  const app = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();

  const close = async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };

  try {
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
    return { app, page, userDataDir, close };
  } catch (error) {
    await close();
    throw error;
  }
}
