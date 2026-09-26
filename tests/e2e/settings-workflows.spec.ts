import { test, expect, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';
let session: ElectronTestSession;
let page: Page;
test.beforeAll(async () => {
  session = await launchAuthenticatedElectron('settings-workflows');
  page = session.page;
});
test.afterAll(async () => { await session?.close(); });

test.beforeEach(async () => { await page.getByRole('link', { name: 'Einstellungen', exact: true }).click(); });
test('connection settings expose labelled fields and controls', async () => {
  await expect(page.getByText('MSSQL-Server & JTL', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Server', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Datenbank', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /verbindung testen/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /synchronisation starten/i })).toBeVisible();
});
test('custom fields section is reachable from settings', async () => {
  await page.getByRole('link', { name: 'Benutzerdefinierte Felder', exact: true }).click();
  await expect(page.getByRole('button', { name: /benutzerdefiniertes feld hinzufügen/i })).toBeVisible();
});
