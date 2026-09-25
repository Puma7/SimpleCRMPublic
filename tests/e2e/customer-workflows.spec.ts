import { test, expect, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';
let session: ElectronTestSession;
let page: Page;
test.beforeAll(async () => {
  session = await launchAuthenticatedElectron('customer-workflows');
  page = session.page;
});
test.afterAll(async () => { await session?.close(); });

const CUSTOMER = 'Suchkunde-Änderung';
test.beforeAll(async () => {
  await page.getByRole('link', { name: 'Kunden', exact: true }).click();
  await page.getByRole('button', { name: /kunde hinzufügen/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#name').fill(CUSTOMER);
  await dialog.getByRole('button', { name: 'Kunde erstellen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
test.beforeEach(async () => {
  await page.locator('nav').first().getByRole('link', { name: 'Kunden', exact: true }).click();
  await page.getByPlaceholder('Kunden suchen...').clear();
});
test('customer search hides and restores an existing record', async () => {
  const customer = page.getByRole('link', { name: CUSTOMER, exact: true });
  await expect(customer).toBeVisible();
  await page.getByPlaceholder('Kunden suchen...').fill('xxxxxxxxnotexistingcustomer');
  await expect(customer).toHaveCount(0);
  await page.getByPlaceholder('Kunden suchen...').fill('Suchkunde');
  await expect(customer).toBeVisible();
});
test('customer detail shows the seeded record', async () => {
  await page.getByRole('link', { name: CUSTOMER, exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/\d+/);
  await expect(page.getByRole('heading', { name: CUSTOMER, exact: true })).toBeVisible();
});
test('customer creation can be cancelled', async () => {
  await page.getByRole('button', { name: /kunde hinzufügen/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /neuen kunden hinzufügen/i })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportieren', exact: true })).toBeVisible();
});
