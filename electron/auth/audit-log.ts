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
