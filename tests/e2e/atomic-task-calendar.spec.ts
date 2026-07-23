import { expect, test, type Page } from '@playwright/test';
import { launchAuthenticatedElectron, type ElectronTestSession } from './helpers/electron-session';

const RUN_ID = Date.now();
const CUSTOMER_NAME = `Atomic-${RUN_ID}`;
const COMPANY_NAME = `Atomic GmbH ${RUN_ID}`;
const TASK_TITLE = `Atomare Aufgabe ${RUN_ID}`;
const INITIAL_DUE_DATE = '2030-02-14';
const MOVED_DUE_DATE = '2030-02-18';

interface TaskRecord {
  id: number;
  title: string;
  due_date: string | null;
  calendar_event_id: number | null;
  customer_company?: string | null;
}

interface CalendarEventRecord {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  task_id: number | null;
}

interface MutationResult {
  success: boolean;
  error?: string;
  id?: number;
  event?: CalendarEventRecord;
  task?: TaskRecord | null;
}

async function invoke<T>(page: Page, channel: string, payload?: unknown): Promise<T> {
  return page.evaluate(
    async ({ invokeChannel, invokePayload }) => {
      const api = (window as unknown as {
        electronAPI: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
      }).electronAPI;
      return api.invoke(invokeChannel, invokePayload);
    },
    { invokeChannel: channel, invokePayload: payload },
  ) as Promise<T>;
}

test.describe('atomic task and calendar desktop flow', () => {
  let session: ElectronTestSession;
  let page: Page;

  test.beforeAll(async () => {
    session = await launchAuthenticatedElectron('atomic-task-calendar');
    page = session.page;
    await session.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000);
    });
  });

  test.afterAll(async () => {
    await session.close();
  });

  test('creates, searches, moves, unlinks, and deletes a linked task and event', async () => {
    await page.getByRole('link', { name: 'Kunden', exact: true }).click();
    await page.getByRole('button', { name: /kunde hinzuf/i }).click();

    const customerDialog = page.getByRole('dialog');
    await customerDialog.locator('#firstName').fill('E2E');
    await customerDialog.locator('#name').fill(CUSTOMER_NAME);
    await customerDialog.locator('#company').fill(COMPANY_NAME);
    await customerDialog.locator('#email').fill(`atomic-${RUN_ID}@test.example`);
    await customerDialog.getByRole('button', { name: 'Kunde erstellen' }).click();
    await expect(customerDialog).not.toBeVisible();

    await page.getByRole('link', { name: 'Aufgaben', exact: true }).click();
    await page.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();

    const taskDialog = page.getByRole('dialog', { name: /neue aufgabe/i });
    await taskDialog.locator('#title').fill(TASK_TITLE);
    await taskDialog.locator('#description').fill('Atomarer Electron-E2E-Test');
    await taskDialog.getByRole('combobox').first().click();
    const customerSearch = page.getByPlaceholder('Kunde suchen...');
    await customerSearch.fill(COMPANY_NAME);
    await page.locator('[role="option"]').filter({ hasText: CUSTOMER_NAME }).click();
    await taskDialog.locator('#due_date').fill(INITIAL_DUE_DATE);
    await expect(taskDialog.getByRole('switch', { name: /in kalender eintragen/i })).toBeChecked();
    await taskDialog.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();
    await expect(taskDialog).not.toBeVisible();

    const taskRow = page.locator('table tbody tr').filter({ hasText: TASK_TITLE });
    await expect(taskRow).toContainText(COMPANY_NAME);

    const taskSearch = page.getByPlaceholder('Aufgaben suchen...');
    await taskSearch.fill(COMPANY_NAME);
    await expect(taskRow).toBeVisible();
    await taskSearch.clear();

    const tasks = await invoke<TaskRecord[]>(page, 'tasks:get-all', {
      limit: 100,
      offset: 0,
      filter: { query: TASK_TITLE },
    });
    const task = tasks.find((candidate) => candidate.title === TASK_TITLE);
    expect(task).toBeDefined();
    expect(task?.customer_company).toBe(COMPANY_NAME);
    expect(task?.calendar_event_id).toEqual(expect.any(Number));

    const taskId = task!.id;
    const eventId = task!.calendar_event_id!;
    const events = await invoke<CalendarEventRecord[]>(page, 'db:getCalendarEvents', {
      startDate: '2030-02-01',
      endDate: '2030-03-01',
    });
    expect(events.find((event) => event.id === eventId)).toMatchObject({
      title: TASK_TITLE,
      task_id: taskId,
    });

    const moved = await invoke<MutationResult>(page, 'db:updateCalendarEvent', {
      id: eventId,
      event: {
        start_date: `${MOVED_DUE_DATE}T00:00:00.000Z`,
        end_date: '2030-02-19T00:00:00.000Z',
        all_day: true,
      },
      schedule: { mode: 'existing', taskId, dueDate: MOVED_DUE_DATE },
    });
    expect(moved).toMatchObject({
      success: true,
      event: { id: eventId, task_id: taskId },
      task: { id: taskId, due_date: MOVED_DUE_DATE },
    });

    const unlinked = await invoke<MutationResult>(page, 'db:updateCalendarEvent', {
      id: eventId,
      event: {},
      schedule: { mode: 'none' },
    });
    expect(unlinked).toMatchObject({
      success: true,
      event: { id: eventId, task_id: null },
    });

    const survivingTask = await invoke<TaskRecord | null>(page, 'tasks:get-by-id', taskId);
    expect(survivingTask).toMatchObject({
      id: taskId,
      due_date: null,
      calendar_event_id: null,
    });

    expect(await invoke<MutationResult>(page, 'db:deleteCalendarEvent', eventId)).toMatchObject({
      success: true,
    });
    expect(await invoke<CalendarEventRecord[]>(page, 'db:getCalendarEvents', {
      startDate: '2030-02-01',
      endDate: '2030-03-01',
    })).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: eventId })]));

    expect(await invoke<MutationResult>(page, 'tasks:delete', taskId)).toMatchObject({
      success: true,
    });
    expect(await invoke<TaskRecord | null>(page, 'tasks:get-by-id', taskId)).toBeNull();
  });
});
