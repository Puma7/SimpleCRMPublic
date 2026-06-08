import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';

const SETUP_USERNAME = 'tester';
const SETUP_PASSWORD = 'TestWorkflow123!';
const USER_DATA = path.join(os.tmpdir(), `simplecrm-wf-manual-${Date.now()}`);
const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots';

async function readAuthenticated(page: Page): Promise<boolean> {
  const session = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI?: { invoke: (ch: string, payload?: unknown) => Promise<unknown> } }).electronAPI;
    if (!api) return null;
    return api.invoke('auth:get-session', undefined);
  });
  return Boolean(
    session &&
      typeof session === 'object' &&
      (session as { authenticated?: boolean }).authenticated === true,
  );
}

async function ensureAuthenticated(page: Page): Promise<void> {
  if (!(await readAuthenticated(page))) {
    const loginRes = await page.evaluate(
      async ({ username, passphrase }) => {
        const api = (window as unknown as { electronAPI: { invoke: (ch: string, payload: unknown) => Promise<unknown> } }).electronAPI;
        return api.invoke('auth:login', { username, passphrase });
      },
      { username: SETUP_USERNAME, passphrase: SETUP_PASSWORD },
    );
    expect(loginRes && typeof loginRes === 'object' && (loginRes as { success?: boolean }).success).toBe(true);
  }

  // IPC session can exist before React AuthProvider refreshes — reload syncs UI auth state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => readAuthenticated(page), { timeout: 20_000 }).toBe(true);
}

async function goToWorkflows(page: Page): Promise<void> {
  await ensureAuthenticated(page);
  await page.evaluate(() => {
    window.location.hash = '#/email/workflows';
  });
  await expect(page.getByRole('link', { name: 'Workflows', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('h1').filter({ hasText: 'Workflows' })).toBeVisible({ timeout: 20_000 });
}

async function createBlankWorkflow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await expect(page.getByText('Neuer Workflow').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Hinzufügen', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Erweiterte Knoten werden geladen…')).toHaveCount(0, { timeout: 20_000 });
}

let app: ElectronApplication;
let page: Page;

test.describe.serial('Workflow GUI smoke (manual parity)', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(USER_DATA, 'config.json'),
      `${JSON.stringify({ version: 1, mode: 'standalone', selectedAt: new Date().toISOString() }, null, 2)}\n`,
    );

    const mainPath = path.resolve(process.cwd(), 'dist-electron/main.js');
    app = await electron.launch({
      args: [mainPath, `--user-data-dir=${USER_DATA}`, '--no-sandbox', '--disable-gpu'],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close();
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });

  test('setup, login, and open workflow editor', async () => {
    await expect(page.getByText('Ersteinrichtung', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.locator('#setup-username').fill(SETUP_USERNAME);
    await page.locator('#setup-pass').fill(SETUP_PASSWORD);
    await page.locator('#setup-pass2').fill(SETUP_PASSWORD);
    await page.getByRole('button', { name: 'Einmal-Passwort abrufen' }).click();
    await expect(page.locator('#setup-token')).not.toHaveValue('', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Passwort setzen' }).click();

    await expect.poll(async () => readAuthenticated(page), { timeout: 30_000 }).toBe(true);

    await goToWorkflows(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'playwright-workflows-list.png'), fullPage: true });
  });

  test('workflow node palette contains parity nodes', async () => {
    await createBlankWorkflow(page);

    const search = page.getByLabel('Workflow-Knoten suchen');
    const mustHave = [
      'Auto-Antwort',
      'Textbaustein',
      'Entwurf versenden',
      'Versand freigeben',
      'KI-Klassifizierung',
      'Verzögerung',
      'Kopie weiterleiten',
      'Tag setzen',
      'Kategorie setzen',
      'Mitarbeiter zuweisen',
    ];
    for (const label of mustHave) {
      await search.fill(label);
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 8_000 });
      await search.fill('');
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'playwright-workflow-palette.png'), fullPage: true });
  });

  test('workflow templates dialog lists key templates', async () => {
    await page.getByRole('button', { name: 'Vorlagen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Workflow-Vorlagen')).toBeVisible();
    for (const snippet of [
      'KI antwortet vollautomatisch',
      'Themen & Mitarbeiter',
      'KI-Qualitätsprüfung',
      'Rechnung',
    ]) {
      await expect(dialog.getByText(snippet, { exact: false }).first()).toBeVisible();
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'playwright-workflow-templates.png'), fullPage: true });
  });
});
