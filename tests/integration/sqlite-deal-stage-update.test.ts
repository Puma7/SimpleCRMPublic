/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-deal-stage-update` },
}));

const mockFireDealStageChanged = jest.fn();
jest.mock('../../electron/workflow/workflow-trigger-dispatch', () => ({
  fireDealStageChangedWorkflows: (...args: unknown[]) => mockFireDealStageChanged(...args),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, updateDeal } from '../../electron/sqlite-service';

describe('updateDeal stage change side effects', () => {
  let db: Database.Database;

  beforeEach(() => {
    mockFireDealStageChanged.mockReset();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare("INSERT INTO customers (id, name) VALUES (1, 'Ada')").run();
    db.prepare("INSERT INTO deals (id, customer_id, name, stage) VALUES (1, 1, 'Projekt', 'Angebot')").run();
  });

  afterEach(() => {
    closeDatabase();
  });

  const stageLogs = () =>
    db.prepare("SELECT title, metadata FROM activity_log WHERE deal_id = 1 AND activity_type = 'stage_change'").all();
  const flushDynamicImports = () => new Promise((resolve) => setTimeout(resolve, 20));

  // F-A10-08: Ein Phasenwechsel ueber den Bearbeiten-Dialog (updateDeal) schrieb kein Activity-Log und loeste crm.deal_stage_changed nicht aus.
  test('a stage change through updateDeal logs the change and fires the stage workflows', async () => {
    expect(updateDeal(1, { name: 'Projekt', stage: 'Gewonnen' })).toEqual({ success: true, error: undefined });
    await flushDynamicImports();

    expect(stageLogs()).toEqual([
      {
        title: 'Deal-Phase geändert: Angebot → Gewonnen',
        metadata: JSON.stringify({ old_stage: 'Angebot', new_stage: 'Gewonnen' }),
      },
    ]);
    expect(mockFireDealStageChanged).toHaveBeenCalledWith(1, 1, 'Angebot', 'Gewonnen');
  });

  test('saving the dialog without a stage change creates no log and no trigger', async () => {
    expect(updateDeal(1, { name: 'Projekt neu', stage: 'Angebot' }).success).toBe(true);
    expect(updateDeal(1, { notes: 'nur Notiz' }).success).toBe(true);
    await flushDynamicImports();

    expect(stageLogs()).toEqual([]);
    expect(mockFireDealStageChanged).not.toHaveBeenCalled();
  });
});
