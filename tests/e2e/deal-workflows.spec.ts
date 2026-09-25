import { test, expect, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';
let session: ElectronTestSession;
let page: Page;
test.beforeAll(async () => {
  session = await launchAuthenticatedElectron('deal-workflows');
  page = session.page;
});
test.afterAll(async () => { await session?.close(); });

test.beforeEach(async () => {
  await page.getByRole('link', { name: 'Deals', exact: true }).click();
  await page.getByRole('button', { name: 'Tabellenansicht', exact: true }).click();
});
test('deal table and export controls render', async () => {
  await expect(page.getByRole('heading', { name: 'Deals', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Deals suchen...')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Phase', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportieren', exact: true })).toBeVisible();
});
test('deal creation can be cancelled', async () => {
  await page.getByRole('button', { name: /neuer deal/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /neuen deal hinzufügen/i })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
test('deal view switches between kanban and table', async () => {
  await page.getByRole('button', { name: 'Kanban-Ansicht', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Interessent.*0/ })).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tabellenansicht', exact: true }).click();
  await expect(page.locator('table')).toBeVisible();
});
test('deal stage filter changes the empty state', async () => {
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Gewonnen', exact: true }).click();
  await expect(page.getByText('Keine Deals in Phase "Gewonnen".', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Alle Deals', exact: true }).click();
  await expect(page.getByText('Erstellen Sie Ihren ersten Deal, um Ihre Pipeline zu starten.', { exact: true })).toBeVisible();
});
