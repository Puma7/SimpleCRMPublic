import { randomBytes, timingSafeEqual } from 'crypto';
import type { Kysely } from 'kysely';

import type {
  ReturnsPortalResolveResult,
  ReturnsPortalSettings,
  ReturnsPortalSettingsApiPort,
} from '../api/types';
import type { ServerDatabase, WorkspacePortalSettingsRow } from './schema';

/** Cleartext length of the portal token in hex (32 bytes → 64 hex chars). */
const PORTAL_TOKEN_BYTES = 32;
const PORTAL_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export type PostgresReturnsPortalPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  /** Inject for tests. Production uses crypto.randomBytes. */
  generateToken?: () => string;
}>;

/**
 * Port for the per-workspace portal token + enable flag, plus the cross-
 * workspace token → workspace resolver the public dispatcher uses.
 *
 * The settings table is NOT under workspace RLS (see migration 0022), so
 * this port talks to the database WITHOUT `withWorkspaceTransaction`. That
 * lets `resolveByToken` work for unauthenticated requests — but it also
 * means every method explicitly carries the workspaceId in its WHERE
 * clause to avoid accidental cross-workspace writes.
 */
export function createPostgresReturnsPortalPort(
  options: PostgresReturnsPortalPortOptions,
): ReturnsPortalSettingsApiPort {
  const generateToken = options.generateToken ?? defaultGenerateToken;

  return {
    async get(input) {
      const row = await loadRow(options.db, input.workspaceId);
      return rowToSettings(row, { revealToken: true });
    },

    async rotate(input) {
      const token = generateToken();
      const enable = input.enable === undefined ? true : input.enable === true;
      const updated_at = new Date();
      // Upsert keyed on workspace_id. ON CONFLICT preserves the (false) default
      // for `enabled` only on a brand-new row; existing rows respect the caller's
      // intent (or stay at their current `enabled` when input.enable is omitted).
      const existing = await loadRow(options.db, input.workspaceId);
      if (existing) {
        await options.db
          .updateTable('workspace_portal_settings')
          .set({
            returns_portal_token: token,
            returns_portal_enabled: input.enable === undefined ? existing.returns_portal_enabled : enable,
            updated_at,
          })
          .where('workspace_id', '=', input.workspaceId)
          .execute();
      } else {
        await options.db
          .insertInto('workspace_portal_settings')
          .values({
            workspace_id: input.workspaceId,
            returns_portal_token: token,
            returns_portal_enabled: enable,
          })
          .execute();
      }
      const next = await loadRow(options.db, input.workspaceId);
      return rowToSettings(next, { revealToken: true });
    },

    async setEnabled(input) {
      const existing = await loadRow(options.db, input.workspaceId);
      if (!existing) {
        // Nothing to enable until rotate() has been called once.
        return rowToSettings(null, { revealToken: true });
      }
      await options.db
        .updateTable('workspace_portal_settings')
        .set({ returns_portal_enabled: input.enabled, updated_at: new Date() })
        .where('workspace_id', '=', input.workspaceId)
        .execute();
      const next = await loadRow(options.db, input.workspaceId);
      return rowToSettings(next, { revealToken: true });
    },

    async revoke(input) {
      const existing = await loadRow(options.db, input.workspaceId);
      if (!existing) {
        return rowToSettings(null, { revealToken: true });
      }
      await options.db
        .updateTable('workspace_portal_settings')
        .set({ returns_portal_token: null, returns_portal_enabled: false, updated_at: new Date() })
        .where('workspace_id', '=', input.workspaceId)
        .execute();
      const next = await loadRow(options.db, input.workspaceId);
      return rowToSettings(next, { revealToken: true });
    },

    async resolveByToken(input) {
      // The token comes from an unauthenticated request, so reject anything
      // that doesn't match the exact shape we issue. This avoids surfacing a
      // database row to attackers using malformed inputs (LIKE wildcards,
      // SQLi-shaped strings, etc) and short-circuits before touching the DB.
      if (!input.token || !PORTAL_TOKEN_PATTERN.test(input.token)) {
        return { ok: false, reason: 'unknown_token' };
      }
      const rows = await options.db
        .selectFrom('workspace_portal_settings')
        .selectAll()
        .where('returns_portal_token', '=', input.token)
        .limit(2)
        .execute();
      if (rows.length === 0) return { ok: false, reason: 'unknown_token' };

      // Constant-time equality between the request and the stored token to
      // close the timing side-channel that string equality (and ilike) would
      // open. The DB lookup itself already used an index, so a request for a
      // valid-shaped but unknown token still returns a "no rows" empty result
      // before we ever get here — the timingSafeEqual is belt-and-braces.
      const row = rows[0]! as WorkspacePortalSettingsRow;
      const stored = row.returns_portal_token;
      if (!stored) return { ok: false, reason: 'unknown_token' };
      const a = Buffer.from(input.token);
      const b = Buffer.from(stored);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, reason: 'unknown_token' };
      }
      if (!row.returns_portal_enabled) {
        return { ok: false, reason: 'portal_disabled' };
      }
      return { ok: true, workspaceId: String(row.workspace_id), enabled: true };
    },
  };
}

async function loadRow(
  db: Kysely<ServerDatabase>,
  workspaceId: string,
): Promise<WorkspacePortalSettingsRow | null> {
  const row = await db
    .selectFrom('workspace_portal_settings')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  return row ?? null;
}

function rowToSettings(
  row: WorkspacePortalSettingsRow | null,
  options: { revealToken: boolean },
): ReturnsPortalSettings {
  if (!row) {
    return { enabled: false, token: null, hasToken: false, updatedAt: null };
  }
  const token = row.returns_portal_token;
  const updatedAtRaw: unknown = row.updated_at;
  const updatedAt = updatedAtRaw instanceof Date
    ? updatedAtRaw.toISOString()
    : typeof updatedAtRaw === 'string'
      ? updatedAtRaw
      : null;
  return {
    enabled: Boolean(row.returns_portal_enabled),
    token: options.revealToken ? token : null,
    hasToken: token !== null,
    updatedAt,
  };
}

function defaultGenerateToken(): string {
  return randomBytes(PORTAL_TOKEN_BYTES).toString('hex');
}
