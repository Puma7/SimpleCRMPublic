import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import {
  ensureAuthenticated,
  launchAuthenticatedElectron,
  type ElectronTestSession,
} from './helpers/electron-session';

const SCREENSHOT_DIR = path.join(process.cwd(), 'test-results', 'workflow-screenshots');

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

let session: ElectronTestSession;
let page: Page;

test.describe.serial('Workflow GUI smoke (manual parity)', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    session = await launchAuthenticatedElectron('workflow-parity');
    page = session.page;
  });

  test.afterAll(async () => {
    await session.close();
  });

  test('opens workflow editor after isolated setup', async () => {
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
      'KI antwortet mit Textbaustein',
      'Themen & Mitarbeiter',
      'KI-Qualitätsprüfung',
      'Rechnung',
    ]) {
      await expect(dialog.getByText(snippet, { exact: false }).first()).toBeVisible();
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'playwright-workflow-templates.png'), fullPage: true });
  });
});
