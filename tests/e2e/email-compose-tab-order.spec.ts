import { expect, test, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';

let session: ElectronTestSession;
let page: Page;

test.describe.serial('email compose tab order', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    session = await launchAuthenticatedElectron('email-compose-tab-order');
    page = session.page;

    await page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: { invoke: (channel: string, payload: unknown) => Promise<unknown> };
      }).electronAPI;
      await api.invoke('email:create-account', {
        displayName: 'E2E Compose',
        emailAddress: 'compose-e2e@example.test',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapTls: true,
        imapUsername: 'compose-e2e@example.test',
        imapPassword: 'not-used-by-this-test',
      });
    });

    await page.evaluate(() => {
      window.location.hash = '#/email';
    });
    await expect(page.getByRole('link', { name: 'Postfach', exact: true })).toBeVisible();
  });

  test.afterAll(async () => {
    if (session) await session.close();
  });

  test('tabs from recipients through subject into the editable message body', async () => {
    await page.getByRole('button', { name: 'Verfassen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Neue Nachricht', exact: true })).toBeVisible();

    const to = dialog.getByPlaceholder('empfänger@example.com');
    const cc = dialog.getByPlaceholder('optional', { exact: true });
    const bcc = dialog.getByPlaceholder('Blindkopie, optional');
    const subject = dialog.getByLabel('Betreff', { exact: true });
    const editor = dialog.locator('.ql-editor');

    await to.focus();
    await expect(to).toBeFocused();
    await to.press('Tab');
    await expect(cc).toBeFocused();
    await cc.press('Tab');
    await expect(bcc).toBeFocused();
    await bcc.press('Tab');
    await expect(subject).toBeFocused();
    await subject.press('Tab');
    await expect(editor).toBeFocused();

    await editor.pressSequentially('Tab-Reihenfolge');
    await expect(editor).toContainText('Tab-Reihenfolge');
    await expect(dialog.locator('.ql-toolbar button:focus, .ql-toolbar select:focus')).toHaveCount(0);
  });
});
