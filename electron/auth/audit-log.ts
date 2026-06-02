import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { AUTH_AUDIT_LOG_TABLE } from '../database-schema';

export function logAuthAction(
  db: Database.Database,
  input: {
    userId?: string | null;
    action: string;
    resourceType?: string;
    resourceId?: string;
    detail?: Record<string, unknown>;
  },
): void {
  const prev = db
    .prepare(`SELECT row_hash FROM ${AUTH_AUDIT_LOG_TABLE} ORDER BY id DESC LIMIT 1`)
    .get() as { row_hash: string } | undefined;
  const prevHash = prev?.row_hash ?? '';
  const at = new Date().toISOString();
  const payload = JSON.stringify({
    userId: input.userId ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    detail: input.detail ?? null,
    at,
    prevHash,
  });
  const rowHash = createHash('sha256').update(payload).digest('hex');
  db.prepare(
    `INSERT INTO ${AUTH_AUDIT_LOG_TABLE} (user_id, action, resource_type, resource_id, detail_json, prev_hash, row_hash, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId ?? null,
    input.action,
    input.resourceType ?? null,
    input.resourceId ?? null,
    input.detail ? JSON.stringify(input.detail) : null,
    prevHash || null,
    rowHash,
    at,
  );
}

export type AuditLogRow = {
  id: number;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail_json: string | null;
  prev_hash: string | null;
  row_hash: string;
  at: string;
};

export function listAuditLog(
  db: Database.Database,
  opts: { limit?: number; offset?: number } = {},
): AuditLogRow[] {
  const lim = Math.min(opts.limit ?? 100, 500);
  const off = opts.offset ?? 0;
  return db
    .prepare(
      `SELECT id, user_id, action, resource_type, resource_id, detail_json, prev_hash, row_hash, at
       FROM ${AUTH_AUDIT_LOG_TABLE}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(lim, off) as AuditLogRow[];
}

export function verifyAuditLogChain(db: Database.Database): {
  valid: boolean;
  checked: number;
  firstBrokenId?: number;
} {
  const rows = db
    .prepare(
      `SELECT id, user_id, action, resource_type, resource_id, detail_json, prev_hash, row_hash, at
       FROM ${AUTH_AUDIT_LOG_TABLE} ORDER BY id ASC`,
    )
    .all() as AuditLogRow[];

  let prevHash = '';
  for (const row of rows) {
    const payload = JSON.stringify({
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
      at: row.at,
      prevHash,
    });
    const expected = createHash('sha256').update(payload).digest('hex');
    if ((row.prev_hash ?? '') !== prevHash) {
      return { valid: false, checked: row.id, firstBrokenId: row.id };
    }
    if (expected !== row.row_hash) {
      return { valid: false, checked: row.id, firstBrokenId: row.id };
    }
    prevHash = row.row_hash;
  }
  return { valid: true, checked: rows.length };
}
