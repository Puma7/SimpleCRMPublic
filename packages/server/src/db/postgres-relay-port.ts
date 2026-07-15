import { createHash, randomUUID } from 'node:crypto';

import type { Kysely, Selectable } from 'kysely';

import { normalizeEmailAddress } from '@simplecrm/core';

import type {
  EmailAccountsTable,
  ServerDatabase,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresSmtpRelayPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

/** Identity resolved from a successful SMTP AUTH against a relay credential. */
export type SmtpRelayCredentialMatch = Readonly<{
  workspaceId: string;
  relayId: string;
  credentialId: string;
}>;

/** The email account a relayed message is routed through (the sender's fields). */
export type SmtpRelayRoutingAccount = Selectable<EmailAccountsTable>;

/** The relay's tracking + submission-limit configuration. */
export type SmtpRelayConfig = Readonly<{
  trackingMode: 'off' | 'rule' | 'always';
  trackingSubjectPatterns: string | null;
  allowHeaderOverride: boolean;
  maxRecipients: number;
  maxMessageBytes: number;
  rateLimitPerMin: number;
  allowArbitraryRecipients: boolean;
  followupWorkflowId: number | null;
}>;

export type PostgresSmtpRelayPort = Readonly<{
  verifyCredential(input: {
    username: string;
    password: string;
  }): Promise<SmtpRelayCredentialMatch | null>;
  resolveRoutingAccount(input: {
    workspaceId: string;
    relayId: string;
    fromAddress: string;
  }): Promise<SmtpRelayRoutingAccount | null>;
  loadRelayConfig(input: {
    workspaceId: string;
    relayId: string;
  }): Promise<SmtpRelayConfig | null>;
}>;

/** Columns of `email_accounts` a relayed send needs to actually deliver mail. */
const relayRoutingAccountColumns = [
  'id',
  'workspace_id',
  'source_sqlite_id',
  'display_name',
  'email_address',
  'protocol',
  'smtp_host',
  'smtp_port',
  'smtp_tls',
  'smtp_username',
  'smtp_use_imap_auth',
  'smtp_keytar_account_key',
  'smtp_password_secret_id',
  'imap_username',
  'keytar_account_key',
  'imap_password_secret_id',
  'oauth_provider',
  'oauth_refresh_keytar_key',
  'oauth_refresh_secret_id',
] as const;

const relayConfigColumns = [
  'tracking_mode',
  'tracking_subject_patterns',
  'allow_header_override',
  'max_recipients',
  'max_message_bytes',
  'rate_limit_per_min',
  'allow_arbitrary_recipients',
  'followup_workflow_id',
] as const;

export function createPostgresSmtpRelayPort(
  options: PostgresSmtpRelayPortOptions,
): PostgresSmtpRelayPort {
  const now = options.now ?? (() => new Date());

  return {
    async verifyCredential(input): Promise<SmtpRelayCredentialMatch | null> {
      const username = input.username.trim();
      // Reject empty inputs before touching the DB — an empty password would
      // still hash to a fixed value and could match a mis-seeded row.
      if (!username || !input.password) return null;

      // Cross-workspace lookup: the SMTP AUTH username is not workspace-scoped,
      // so we resolve the owning workspace from the credential itself. The match
      // is performed by the DB on the indexed `password_hash` column — we never
      // string-compare the secret in JS, which keeps the check constant-time-ish
      // and avoids leaking a timing side-channel.
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
        async (trx) => trx
          .selectFrom('smtp_relay_credentials as cred')
          .innerJoin('smtp_relays as relay', (join) => join
            .onRef('relay.id', '=', 'cred.relay_id')
            .onRef('relay.workspace_id', '=', 'cred.workspace_id'))
          .select([
            'cred.id as credential_id',
            'cred.workspace_id as workspace_id',
            'cred.relay_id as relay_id',
          ])
          .where('cred.username', '=', username)
          .where('cred.password_hash', '=', hashRelayPassword(input.password))
          .where('cred.revoked_at', 'is', null)
          .where('relay.enabled', '=', true)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!row) return null;

      const match: SmtpRelayCredentialMatch = {
        workspaceId: String(row.workspace_id),
        relayId: String(row.relay_id),
        credentialId: String(row.credential_id),
      };

      // Best-effort last_used_at bump; never fail auth because the touch failed.
      await touchCredentialLastUsed(options, match, now()).catch(() => undefined);

      return match;
    },

    async resolveRoutingAccount(input): Promise<SmtpRelayRoutingAccount | null> {
      const target = normalizeEmailAddress(input.fromAddress);
      if (!target) return null;

      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('smtp_relay_allowed_accounts as allowed')
            .innerJoin('email_accounts as acct', (join) => join
              .onRef('acct.id', '=', 'allowed.account_id')
              .onRef('acct.workspace_id', '=', 'allowed.workspace_id'))
            .where('allowed.workspace_id', '=', input.workspaceId)
            .where('allowed.relay_id', '=', input.relayId)
            .select('allowed.from_address as allowed_from_address')
            .select(relayRoutingAccountColumns.map((column) => `acct.${column} as ${column}` as never))
            .execute();

          // The relay permits a From when it equals either the mapped account's
          // own address OR an explicit `from_address` override on the mapping.
          // Compare canonically (case-insensitive, plus-tag/domain normalised)
          // on both sides so the same helper governs matching everywhere.
          const match = rows.find((row) => {
            const record = row as Record<string, unknown>;
            const accountAddress = normalizeEmailAddress(String(record.email_address ?? ''));
            const overrideRaw = record.allowed_from_address;
            const overrideAddress = overrideRaw == null
              ? null
              : normalizeEmailAddress(String(overrideRaw));
            return accountAddress === target || overrideAddress === target;
          });
          if (!match) return null;

          const { allowed_from_address: _ignored, ...account } = match as Record<string, unknown>;
          return account as unknown as SmtpRelayRoutingAccount;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async loadRelayConfig(input): Promise<SmtpRelayConfig | null> {
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('smtp_relays')
          .select(relayConfigColumns)
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.relayId)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!row) return null;

      return {
        trackingMode: row.tracking_mode,
        trackingSubjectPatterns: row.tracking_subject_patterns,
        allowHeaderOverride: Boolean(row.allow_header_override),
        maxRecipients: Number(row.max_recipients),
        maxMessageBytes: Number(row.max_message_bytes),
        rateLimitPerMin: Number(row.rate_limit_per_min),
        allowArbitraryRecipients: Boolean(row.allow_arbitrary_recipients),
        followupWorkflowId: row.followup_workflow_id === null ? null : Number(row.followup_workflow_id),
      };
    },
  };
}

async function touchCredentialLastUsed(
  options: PostgresSmtpRelayPortOptions,
  match: SmtpRelayCredentialMatch,
  timestamp: Date,
): Promise<void> {
  await withWorkspaceTransaction(
    options.db,
    { workspaceId: match.workspaceId, role: 'system' },
    async (trx: WorkspaceTransaction) => {
      await trx
        .updateTable('smtp_relay_credentials')
        .set({ last_used_at: timestamp, updated_at: timestamp })
        .where('workspace_id', '=', match.workspaceId)
        .where('id', '=', match.credentialId)
        .where('revoked_at', 'is', null)
        .execute();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

/**
 * Hash a relay credential password the same way automation API keys are hashed
 * (`sha256:` + lowercase hex). `hashAutomationApiKey` in the automation port is
 * not exported, so we replicate the exact scheme here to keep the stored
 * `password_hash` format identical across the two credential systems.
 */
function hashRelayPassword(password: string): string {
  return `sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
}
