const store = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT key FROM sync_info')) {
        return {
          all: () => [...store.keys()].map((key) => ({ key })),
        };
      }
      return {
        get: (...args: unknown[]) => {
          const sql = String(args[0] ?? '');
          const id = args[1] as number | undefined;
          if (sql.includes('email_messages') && sql.includes('folder_id')) return undefined;
          if (sql.includes('email_folders')) return id === 99 ? undefined : { id };
          if (sql.includes('folder_kind')) return undefined;
          if (sql.includes('workflow_delayed_jobs')) {
            return id === 1 ? { status: 'done' } : undefined;
          }
          if (sql.includes('email_messages')) return id === 404 ? undefined : { id };
          return undefined;
        },
      };
    },
  }),
  getSyncInfo: (key: string) => store.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    store.set(key, value);
  },
  deleteSyncInfo: (key: string) => {
    store.delete(key);
  },
}));

import { sweepStaleSyncInfoKeys } from '../../electron/sync-info-maintenance';

describe('sweepStaleSyncInfoKeys', () => {
  beforeEach(() => {
    store.clear();
  });

  test('removes old deal_stage trigger keys (pre-S1 format)', () => {
    store.set('workflow_trigger_fired:crm.deal_stage_changed:5:won', '1');
    store.set('workflow_trigger_fired:crm.deal_stage_changed:5:open:won', '1');
    const { removed } = sweepStaleSyncInfoKeys();
    expect(removed).toBe(1);
    expect(store.has('workflow_trigger_fired:crm.deal_stage_changed:5:won')).toBe(false);
    expect(store.has('workflow_trigger_fired:crm.deal_stage_changed:5:open:won')).toBe(true);
  });

  test('removes imap_uid_fail for missing message', () => {
    store.set('imap_uid_fail:1:500', '5');
    const { removed } = sweepStaleSyncInfoKeys();
    expect(removed).toBe(1);
    expect(store.has('imap_uid_fail:1:500')).toBe(false);
  });

  test('removes expired webhook_dedup keys', () => {
    store.set('webhook_dedup:abc', String(Date.now() - 10 * 60 * 1000));
    const { removed } = sweepStaleSyncInfoKeys();
    expect(removed).toBe(1);
  });
});
