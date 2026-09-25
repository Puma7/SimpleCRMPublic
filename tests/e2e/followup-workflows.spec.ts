import { test, expect, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';
let session: ElectronTestSession;
let page: Page;
test.beforeAll(async () => {
  session = await launchAuthenticatedElectron('followup-workflows');
  page = session.page;
});
test.afterAll(async () => { await session?.close(); });

test.beforeEach(async () => {
  await page.getByRole('link', { name: 'Nachverfolgung', exact: true }).click();
  await page.getByRole('button', { name: /^Heute\s*0$/ }).click();
});
test('empty queues have zero counts', async () => {
  await expect(page.getByRole('heading', { name: 'Nachverfolgung', exact: true })).toBeVisible();
  for (const name of [/^Heute\s*0$/, /^Überfällig\s*0$/, /^Diese Woche\s*0$/]) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
});
test('switching queues changes the empty state', async () => {
  await page.getByRole('button', { name: /^Überfällig\s*0$/ }).click();
  await expect(page.getByRole('heading', { name: 'Keine überfälligen Aufgaben', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Diese Woche\s*0$/ }).click();
  await expect(page.getByRole('heading', { name: 'Keine Aufgaben diese Woche', exact: true })).toBeVisible();
});
test('empty state offers a working next queue action', async () => {
  await expect(page.getByRole('heading', { name: 'Keine Aufgaben für heute', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Diese Woche', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keine Aufgaben diese Woche', exact: true })).toBeVisible();
});
test('without an item the detail panel shows a placeholder', async () => {
  await expect(page.getByText('Zeile auswählen um Details anzuzeigen', { exact: true })).toBeVisible();
});
