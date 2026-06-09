import { returnsSchemaMigration } from '../../packages/server/src/migrations/0021_returns_schema';
import { serverMigrations } from '../../packages/server/src/migrations';

describe('returnsSchemaMigration (0021)', () => {
  test('is registered in the migration set in numeric order', () => {
    expect(serverMigrations).toContain(returnsSchemaMigration);
    const index = serverMigrations.indexOf(returnsSchemaMigration);
    // Every prior migration's numeric id must be smaller — assertValidMigrationSet
    // already enforces this globally, but we keep the focused check so a future
    // accidental reorder around this migration surfaces here too.
    for (let i = 0; i < index; i += 1) {
      expect(serverMigrations[i]!.id < returnsSchemaMigration.id).toBe(true);
    }
  });

  test('id matches the four-digit migration naming convention', () => {
    expect(returnsSchemaMigration.id).toBe('0021_returns_schema');
    expect(returnsSchemaMigration.id).toMatch(/^\d{4}_[a-z0-9_]+$/);
  });

  test('creates the three return tables with workspace_id + FK to workspaces', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    for (const table of ['return_reasons', 'returns', 'return_items']) {
      expect(up).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      // every table is workspace-scoped + cascades on workspace deletion.
      expect(up).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*workspace_id uuid NOT NULL REFERENCES workspaces\\(id\\) ON DELETE CASCADE`),
      );
    }
  });

  test('enables ROW LEVEL SECURITY + workspace-isolation policy on every table', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    for (const table of ['return_reasons', 'returns', 'return_items']) {
      expect(up).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(up).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(up).toContain(`CREATE POLICY ${table}_workspace_isolation ON ${table}`);
      expect(up).toContain('app.can_access_workspace(workspace_id)');
    }
  });

  test('enforces the documented enum vocabulary at the column level', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    // Status enum (the workflow lifecycle).
    expect(up).toContain(
      "CHECK (status IN ('pending','approved','received','refunded','exchanged','credited','rejected','cancelled'))",
    );
    // Outcome enum (Resolvia-style refund/exchange/credit/keep steering).
    expect(up).toContain("CHECK (outcome IS NULL OR outcome IN ('refund','exchange','credit','keep'))");
    // Item condition enum.
    expect(up).toContain("CHECK (condition IS NULL OR condition IN ('new','opened','used','damaged'))");
    // Quantity guard.
    expect(up).toContain('quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0)');
  });

  test('links returns to the originating customer/email message with SET NULL on delete', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    expect(up).toContain('customer_id bigint REFERENCES customers(id) ON DELETE SET NULL');
    expect(up).toContain('email_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL');
    // return_items cascade-delete with their parent return.
    expect(up).toContain('return_id bigint NOT NULL REFERENCES returns(id) ON DELETE CASCADE');
  });

  test('enforces uniqueness of return_number and reason code per workspace', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    expect(up).toContain('UNIQUE (workspace_id, code)'); // return_reasons
    expect(up).toContain('UNIQUE (workspace_id, return_number)'); // returns
  });

  test('creates the indexes the API will rely on for list/filter queries', () => {
    const up = returnsSchemaMigration.upSql.join('\n');
    expect(up).toContain('returns_workspace_status_idx');
    expect(up).toContain('returns_workspace_customer_idx');
    expect(up).toContain('returns_workspace_order_idx');
    expect(up).toContain('return_items_return_idx');
    expect(up).toContain('return_items_workspace_product_idx');
    expect(up).toContain('return_reasons_workspace_active_idx');
  });

  test('downSql cleanly reverses what upSql created (drops in dependency order)', () => {
    const down = returnsSchemaMigration.downSql.join('\n');
    // policies dropped before tables.
    expect(down).toContain('DROP POLICY IF EXISTS return_items_workspace_isolation ON return_items;');
    expect(down).toContain('DROP POLICY IF EXISTS returns_workspace_isolation ON returns;');
    expect(down).toContain('DROP POLICY IF EXISTS return_reasons_workspace_isolation ON return_reasons;');
    expect(down).toContain('DROP TABLE IF EXISTS return_items;');
    expect(down).toContain('DROP TABLE IF EXISTS returns;');
    expect(down).toContain('DROP TABLE IF EXISTS return_reasons;');
    // and child tables come before parents in the DROP order.
    expect(down.indexOf('DROP TABLE IF EXISTS return_items;')).toBeLessThan(
      down.indexOf('DROP TABLE IF EXISTS returns;'),
    );
    expect(down.indexOf('DROP TABLE IF EXISTS returns;')).toBeLessThan(
      down.indexOf('DROP TABLE IF EXISTS return_reasons;'),
    );
  });
});
