import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Kysely, Selectable } from 'kysely';

import { normalizeEmailAddress } from '@simplecrm/core';

import type {
  SmtpRelayAdminPort,
  SmtpRelayAllowedAccountRecord,
  SmtpRelayAllowedAccountResult,
  SmtpRelayCredentialCreateResult,
  SmtpRelayCredentialRecord,
  SmtpRelayCredentialRevokeResult,
  SmtpRelayMutationInput,
  SmtpRelayMutationResult,
  SmtpRelayRecord,
  SmtpRelaySubmissionRecord,
} from '../api/types';
import type {
  EmailAccountsTable,
  ServerDatabase,
} from './schema';
import type { PostgresSecretPort } from './postgres-secret-port';
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

/**
 * The email account a relayed message is routed through (the sender's
 * fields). Narrowed to exactly the columns `resolveRoutingAccount` actually
 * selects (`relayRoutingAccountColumns`, defined below) rather than the full
 * `email_accounts` row — the query never fetches the rest, so claiming the
 * full table type here would let a caller (or a future refactor) reference a
 * field that silently comes back `undefined` at runtime, right before it
 * feeds the live outbound SMTP connection parameters.
 */
export type SmtpRelayRoutingAccount = Pick<
  Selectable<EmailAccountsTable>,
  typeof relayRoutingAccountColumns[number]
>;

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
  /**
   * Per-message revalidation for an already-authenticated SMTP session. AUTH
   * only gates NEW connections; a long-lived session keeps its resolved
   * credential id, so an admin who disables the relay or revokes the
   * credential mid-session must still be able to stop further submissions on
   * that connection. Returns the config only when the relay is still enabled
   * AND the specific credential is still un-revoked; otherwise null.
   */
  revalidateSession(input: {
    workspaceId: string;
    relayId: string;
    credentialId: string;
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
          // A disabled relay must not resolve config for the runtime send path
          // — verifyCredential already blocks new AUTH on a disabled relay, and
          // this keeps the submission pipeline from acting on one that was
          // disabled after the session authenticated.
          .where('enabled', '=', true)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      return row ? mapRelayConfigRow(row as Record<string, unknown>) : null;
    },

    async revalidateSession(input): Promise<SmtpRelayConfig | null> {
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('smtp_relays as relay')
          .innerJoin('smtp_relay_credentials as cred', (join) => join
            .onRef('cred.relay_id', '=', 'relay.id')
            .onRef('cred.workspace_id', '=', 'relay.workspace_id'))
          .select(relayConfigColumns.map((column) => `relay.${column}` as never))
          .where('relay.workspace_id', '=', input.workspaceId)
          .where('relay.id', '=', input.relayId)
          .where('cred.id', '=', input.credentialId)
          .where('relay.enabled', '=', true)
          .where('cred.revoked_at', 'is', null)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      return row ? mapRelayConfigRow(row as Record<string, unknown>) : null;
    },
  };
}

// Accepts a permissive row shape because `revalidateSession` selects the same
// columns through a join with an `as never` alias map (which erases the row
// type to `{}`), while `loadRelayConfig` selects them directly. Both feed the
// identical config mapping.
function mapRelayConfigRow(row: Record<string, unknown>): SmtpRelayConfig {
  const followup = row.followup_workflow_id;
  return {
    trackingMode: row.tracking_mode as 'off' | 'rule' | 'always',
    trackingSubjectPatterns: (row.tracking_subject_patterns as string | null) ?? null,
    allowHeaderOverride: Boolean(row.allow_header_override),
    maxRecipients: Number(row.max_recipients),
    maxMessageBytes: Number(row.max_message_bytes),
    rateLimitPerMin: Number(row.rate_limit_per_min),
    allowArbitraryRecipients: Boolean(row.allow_arbitrary_recipients),
    followupWorkflowId: followup === null || followup === undefined ? null : Number(followup),
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

/**
 * The set of normalised From addresses an allowed-account mapping "claims" for
 * routing: the account's own address AND its optional `from_address` override
 * (mirroring `resolveRoutingAccount`, which matches either). Used to detect
 * collisions between mappings on any shared claimed address.
 */
function collectClaimedAddresses(
  accountEmail: string | null | undefined,
  fromAddress: string | null | undefined,
): Set<string> {
  const claims = new Set<string>();
  const account = accountEmail == null ? null : normalizeEmailAddress(String(accountEmail));
  if (account) claims.add(account);
  const override = fromAddress == null ? null : normalizeEmailAddress(String(fromAddress));
  if (override) claims.add(override);
  return claims;
}

// ---------------------------------------------------------------------------
// Management port (the API surface behind /api/v1/email/relays)
// ---------------------------------------------------------------------------

export type PostgresSmtpRelayAdminPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /** Required for credential creation (plaintext reveal-once storage). */
  secrets?: Pick<PostgresSecretPort, 'writeSecret' | 'deleteSecret'>;
  generateId?: () => string;
  generateUsername?: () => string;
  generatePassword?: () => string;
  now?: () => Date;
}>;

const relayAdminSelectColumns = [
  'id',
  'label',
  'enabled',
  'tracking_mode',
  'tracking_subject_patterns',
  'allow_header_override',
  'max_recipients',
  'max_message_bytes',
  'rate_limit_per_min',
  'allow_arbitrary_recipients',
  'followup_workflow_id',
  'created_at',
] as const;

const relayCredentialSelectColumns = [
  'id',
  'relay_id',
  'username',
  'last_used_at',
  'revoked_at',
  'created_at',
] as const;

const relaySubmissionSelectColumns = [
  'id',
  'status',
  'recipient_count',
  'tracking_applied',
  'tracking_rule_reason',
  'message_id',
  'smtp_message_id_header',
  'error_text',
  'created_at',
] as const;

/** How often createCredential retries a fresh username after a UNIQUE conflict. */
const USERNAME_GENERATION_ATTEMPTS = 5;

const RELAY_DEFAULTS = {
  enabled: true,
  allowArbitraryRecipients: false,
  maxRecipients: 50,
  maxMessageBytes: 26_214_400,
  rateLimitPerMin: 60,
  trackingMode: 'rule' as const,
  trackingSubjectPatterns: null,
  allowHeaderOverride: true,
  followupWorkflowId: null,
};

export function createPostgresSmtpRelayAdminPort(
  options: PostgresSmtpRelayAdminPortOptions,
): SmtpRelayAdminPort {
  const generateId = options.generateId ?? randomUUID;
  const generateUsername = options.generateUsername ?? generateRelayUsername;
  const generatePassword = options.generatePassword ?? generateRelayPassword;
  const now = options.now ?? (() => new Date());
  const applySession = options.applyWorkspaceSession;

  async function loadRelayRecord(
    trx: WorkspaceTransaction,
    workspaceId: string,
    relayRow: RelayAdminRow,
  ): Promise<SmtpRelayRecord> {
    const accountRows = await trx
      .selectFrom('smtp_relay_allowed_accounts as allowed')
      .innerJoin('email_accounts as acct', (join) => join
        .onRef('acct.id', '=', 'allowed.account_id')
        .onRef('acct.workspace_id', '=', 'allowed.workspace_id'))
      .select([
        'allowed.account_id as account_id',
        'allowed.from_address as from_address',
        'acct.email_address as email_address',
        'acct.display_name as display_name',
      ])
      .where('allowed.workspace_id', '=', workspaceId)
      .where('allowed.relay_id', '=', String(relayRow.id))
      .execute();
    const credentialRows = await trx
      .selectFrom('smtp_relay_credentials')
      .select(relayCredentialSelectColumns)
      .where('workspace_id', '=', workspaceId)
      .where('relay_id', '=', String(relayRow.id))
      .orderBy('created_at', 'asc')
      .execute();
    return {
      ...mapRelayAdminRow(relayRow),
      allowedAccounts: accountRows.map(mapAllowedAccountRow),
      credentials: credentialRows.map(mapRelayCredentialRow),
    };
  }

  return {
    async listRelays(input): Promise<readonly SmtpRelayRecord[]> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const relayRows = await trx
            .selectFrom('smtp_relays')
            .select(relayAdminSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('created_at', 'asc')
            .execute();
          if (relayRows.length === 0) return [];

          const accountRows = await trx
            .selectFrom('smtp_relay_allowed_accounts as allowed')
            .innerJoin('email_accounts as acct', (join) => join
              .onRef('acct.id', '=', 'allowed.account_id')
              .onRef('acct.workspace_id', '=', 'allowed.workspace_id'))
            .select([
              'allowed.relay_id as relay_id',
              'allowed.account_id as account_id',
              'allowed.from_address as from_address',
              'acct.email_address as email_address',
              'acct.display_name as display_name',
            ])
            .where('allowed.workspace_id', '=', input.workspaceId)
            .execute();
          const credentialRows = await trx
            .selectFrom('smtp_relay_credentials')
            .select(relayCredentialSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('created_at', 'asc')
            .execute();

          return relayRows.map((row) => ({
            ...mapRelayAdminRow(row),
            allowedAccounts: accountRows
              .filter((account) => String(account.relay_id) === String(row.id))
              .map(mapAllowedAccountRow),
            credentials: credentialRows
              .filter((credential) => String(credential.relay_id) === String(row.id))
              .map(mapRelayCredentialRow),
          }));
        },
        { applySession },
      );
    },

    async createRelay(input): Promise<SmtpRelayMutationResult> {
      const timestamp = now();
      try {
        const relay = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
          async (trx) => {
            const row = await trx
              .insertInto('smtp_relays')
              .values({
                id: generateId(),
                workspace_id: input.workspaceId,
                label: input.values.label.trim(),
                enabled: input.values.enabled ?? RELAY_DEFAULTS.enabled,
                allow_arbitrary_recipients:
                  input.values.allowArbitraryRecipients ?? RELAY_DEFAULTS.allowArbitraryRecipients,
                max_recipients: input.values.maxRecipients ?? RELAY_DEFAULTS.maxRecipients,
                max_message_bytes: input.values.maxMessageBytes ?? RELAY_DEFAULTS.maxMessageBytes,
                rate_limit_per_min: input.values.rateLimitPerMin ?? RELAY_DEFAULTS.rateLimitPerMin,
                tracking_mode: input.values.trackingMode ?? RELAY_DEFAULTS.trackingMode,
                tracking_subject_patterns:
                  input.values.trackingSubjectPatterns ?? RELAY_DEFAULTS.trackingSubjectPatterns,
                allow_header_override:
                  input.values.allowHeaderOverride ?? RELAY_DEFAULTS.allowHeaderOverride,
                followup_workflow_id:
                  input.values.followupWorkflowId ?? RELAY_DEFAULTS.followupWorkflowId,
                created_by_user_id: input.actorUserId,
                created_at: timestamp,
                updated_at: timestamp,
              })
              .returning(relayAdminSelectColumns)
              .executeTakeFirstOrThrow();
            return mapRelayAdminRow(row);
          },
          { applySession },
        );
        return { ok: true, relay: { ...relay, allowedAccounts: [], credentials: [] } };
      } catch (caught) {
        const code = mapRelayConstraintViolation(caught);
        if (code) return { ok: false, code };
        throw caught;
      }
    },

    async updateRelay(input): Promise<SmtpRelayMutationResult | null> {
      const timestamp = now();
      try {
        const relay = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
          async (trx) => {
            const row = await trx
              .updateTable('smtp_relays')
              .set({
                ...relayUpdateColumns(input.values),
                updated_at: timestamp,
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.relayId)
              .returning(relayAdminSelectColumns)
              .executeTakeFirst();
            if (!row) return null;
            return loadRelayRecord(trx, input.workspaceId, row);
          },
          { applySession },
        );
        return relay ? { ok: true, relay } : null;
      } catch (caught) {
        const code = mapRelayConstraintViolation(caught);
        if (code) return { ok: false, code };
        throw caught;
      }
    },

    async deleteRelay(input): Promise<{ id: string; label: string } | null> {
      const result = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          // Collect credential secrets BEFORE the cascade removes the rows, so
          // the encrypted plaintexts do not linger as orphans in the secret store.
          const credentials = await trx
            .selectFrom('smtp_relay_credentials')
            .select(['id', 'secret_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('relay_id', '=', input.relayId)
            .execute();
          const row = await trx
            .deleteFrom('smtp_relays')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.relayId)
            .returning(['id', 'label'])
            .executeTakeFirst();
          if (!row) return null;
          return {
            relay: { id: String(row.id), label: row.label },
            secretCredentialIds: credentials
              .filter((credential) => credential.secret_id !== null)
              .map((credential) => String(credential.id)),
          };
        },
        { applySession },
      );
      if (!result) return null;
      for (const credentialId of result.secretCredentialIds) {
        await options.secrets
          ?.deleteSecret(smtpRelayCredentialSecretIdentifier(input.workspaceId, credentialId))
          .catch(() => false);
      }
      return result.relay;
    },

    async addAllowedAccount(input): Promise<SmtpRelayAllowedAccountResult> {
      const timestamp = now();
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          const relay = await trx
            .selectFrom('smtp_relays')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.relayId)
            .executeTakeFirst();
          if (!relay) return { ok: false, code: 'relay_not_found' } as const;

          const account = await trx
            .selectFrom('email_accounts')
            .select(['id', 'email_address', 'display_name'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.accountId)
            .executeTakeFirst();
          if (!account) return { ok: false, code: 'account_not_found' } as const;

          const existing = await trx
            .selectFrom('smtp_relay_allowed_accounts')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('relay_id', '=', input.relayId)
            .where('account_id', '=', input.accountId)
            .executeTakeFirst();
          if (existing) return { ok: false, code: 'duplicate_account' } as const;

          const fromAddress = input.fromAddress?.trim() || null;

          // resolveRoutingAccount matches an inbound From against BOTH an
          // allowed account's own address AND its `from_address` override (the
          // `||` in its predicate), with no ORDER BY — so an allowed entry
          // "claims" up to two From addresses. Two entries that share ANY
          // claimed address make routing for it non-deterministic (could pick
          // either account's SMTP credentials). Comparing only the single
          // effective address (override ?? account email) misses collisions
          // where the new entry's account email clashes with a sibling's
          // override, or vice versa — so compare the FULL claimed-address set
          // of the new mapping against every sibling's full set.
          const newClaims = collectClaimedAddresses(account.email_address, fromAddress);
          if (newClaims.size > 0) {
            const siblings = await trx
              .selectFrom('smtp_relay_allowed_accounts as allowed')
              .innerJoin('email_accounts as acct', (join) => join
                .onRef('acct.id', '=', 'allowed.account_id')
                .onRef('acct.workspace_id', '=', 'allowed.workspace_id'))
              .where('allowed.workspace_id', '=', input.workspaceId)
              .where('allowed.relay_id', '=', input.relayId)
              .select(['allowed.from_address as allowed_from_address', 'acct.email_address'])
              .execute();
            const collides = siblings.some((sibling) => {
              const siblingClaims = collectClaimedAddresses(
                sibling.email_address,
                sibling.allowed_from_address,
              );
              for (const claimed of siblingClaims) {
                if (newClaims.has(claimed)) return true;
              }
              return false;
            });
            if (collides) return { ok: false, code: 'duplicate_from_address' } as const;
          }

          await trx
            .insertInto('smtp_relay_allowed_accounts')
            .values({
              id: generateId(),
              workspace_id: input.workspaceId,
              relay_id: input.relayId,
              account_id: input.accountId,
              from_address: fromAddress,
              created_at: timestamp,
            })
            .execute();

          return {
            ok: true,
            account: {
              accountId: Number(account.id),
              fromAddress,
              emailAddress: account.email_address,
              displayName: account.display_name,
            },
          } as const;
        },
        { applySession },
      );
    },

    async removeAllowedAccount(input): Promise<boolean> {
      const removed = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => trx
          .deleteFrom('smtp_relay_allowed_accounts')
          .where('workspace_id', '=', input.workspaceId)
          .where('relay_id', '=', input.relayId)
          .where('account_id', '=', input.accountId)
          .returning(['id'])
          .executeTakeFirst(),
        { applySession },
      );
      return Boolean(removed);
    },

    async createCredential(input): Promise<SmtpRelayCredentialCreateResult> {
      const secrets = options.secrets;
      if (!secrets) return { ok: false, code: 'secret_port_unavailable' };

      const relay = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('smtp_relays')
          .select(['id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.relayId)
          .executeTakeFirst(),
        { applySession },
      );
      if (!relay) return { ok: false, code: 'relay_not_found' };

      const id = generateId();
      const password = generatePassword();
      const secretIdentifier = smtpRelayCredentialSecretIdentifier(input.workspaceId, id);
      const secret = await secrets.writeSecret({
        ...secretIdentifier,
        value: password,
      });

      try {
        // The generated username must be globally unique (SMTP AUTH usernames
        // are not workspace-scoped) — retry with a fresh one on a UNIQUE
        // conflict. Every attempt is its own transaction so the aborted insert
        // does not poison the retry.
        for (let attempt = 1; ; attempt += 1) {
          const username = generateUsername();
          try {
            const credential = await withWorkspaceTransaction(
              options.db,
              { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
              async (trx) => {
                const timestamp = now();
                const row = await trx
                  .insertInto('smtp_relay_credentials')
                  .values({
                    id,
                    workspace_id: input.workspaceId,
                    relay_id: input.relayId,
                    username,
                    password_hash: hashRelayPassword(password),
                    secret_id: secret.id,
                    last_used_at: null,
                    revoked_at: null,
                    created_at: timestamp,
                    updated_at: timestamp,
                  })
                  .returning(relayCredentialSelectColumns)
                  .executeTakeFirstOrThrow();
                return mapRelayCredentialRow(row);
              },
              { applySession },
            );
            return { ok: true, credential, password };
          } catch (caught) {
            if (isUniqueViolation(caught) && attempt < USERNAME_GENERATION_ATTEMPTS) continue;
            throw caught;
          }
        }
      } catch (caught) {
        await secrets.deleteSecret(secretIdentifier).catch(() => false);
        throw caught;
      }
    },

    async revokeCredential(input): Promise<SmtpRelayCredentialRevokeResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => trx
          .selectFrom('smtp_relay_credentials')
          .select([...relayCredentialSelectColumns, 'secret_id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('relay_id', '=', input.relayId)
          .where('id', '=', input.credentialId)
          .executeTakeFirst(),
        { applySession },
      );
      if (!current) return null;
      if (current.secret_id !== null && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      const credential = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'admin' },
        async (trx) => {
          const timestamp = now();
          const row = await trx
            .updateTable('smtp_relay_credentials')
            .set({
              secret_id: null,
              revoked_at: current.revoked_at ?? timestamp,
              updated_at: timestamp,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.credentialId)
            .returning(relayCredentialSelectColumns)
            .executeTakeFirstOrThrow();
          return mapRelayCredentialRow(row);
        },
        { applySession },
      );

      if (current.secret_id !== null) {
        await options.secrets?.deleteSecret(
          smtpRelayCredentialSecretIdentifier(input.workspaceId, input.credentialId),
        );
      }

      return { ok: true, credential };
    },

    async listSubmissions(input): Promise<readonly SmtpRelaySubmissionRecord[] | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const relay = await trx
            .selectFrom('smtp_relays')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.relayId)
            .executeTakeFirst();
          if (!relay) return null;

          const rows = await trx
            .selectFrom('smtp_relay_submissions')
            .select(relaySubmissionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('relay_id', '=', input.relayId)
            .orderBy('created_at', 'desc')
            .limit(input.limit)
            .execute();
          return rows.map(mapRelaySubmissionRow);
        },
        { applySession },
      );
    },
  };
}

function generateRelayUsername(): string {
  return `relay-${randomBytes(4).toString('hex')}`;
}

function generateRelayPassword(): string {
  // 32 random bytes -> 43 base64url characters, comfortably above the 32-char floor.
  return randomBytes(32).toString('base64url');
}

function smtpRelayCredentialSecretIdentifier(workspaceId: string, credentialId: string): {
  workspaceId: string;
  kind: string;
  name: string;
} {
  return {
    workspaceId,
    kind: 'smtp_relay.credential',
    name: `smtp_relay_credential:${credentialId}:password`,
  };
}

type RelayAdminRow = {
  id: string;
  label: string;
  enabled: boolean;
  tracking_mode: 'off' | 'rule' | 'always';
  tracking_subject_patterns: string | null;
  allow_header_override: boolean;
  max_recipients: number;
  max_message_bytes: number;
  rate_limit_per_min: number;
  allow_arbitrary_recipients: boolean;
  followup_workflow_id: number | null;
  created_at: Date | string;
};

function relayUpdateColumns(values: SmtpRelayMutationInput): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (values.label !== undefined) set.label = values.label.trim();
  if (values.enabled !== undefined) set.enabled = values.enabled;
  if (values.trackingMode !== undefined) set.tracking_mode = values.trackingMode;
  if (values.trackingSubjectPatterns !== undefined) set.tracking_subject_patterns = values.trackingSubjectPatterns;
  if (values.allowHeaderOverride !== undefined) set.allow_header_override = values.allowHeaderOverride;
  if (values.maxRecipients !== undefined) set.max_recipients = values.maxRecipients;
  if (values.maxMessageBytes !== undefined) set.max_message_bytes = values.maxMessageBytes;
  if (values.rateLimitPerMin !== undefined) set.rate_limit_per_min = values.rateLimitPerMin;
  if (values.allowArbitraryRecipients !== undefined) set.allow_arbitrary_recipients = values.allowArbitraryRecipients;
  if (values.followupWorkflowId !== undefined) set.followup_workflow_id = values.followupWorkflowId;
  return set;
}

function mapRelayAdminRow(row: RelayAdminRow): Omit<SmtpRelayRecord, 'allowedAccounts' | 'credentials'> {
  return {
    id: String(row.id),
    label: row.label,
    enabled: Boolean(row.enabled),
    trackingMode: row.tracking_mode,
    trackingSubjectPatterns: row.tracking_subject_patterns,
    allowHeaderOverride: Boolean(row.allow_header_override),
    maxRecipients: Number(row.max_recipients),
    maxMessageBytes: Number(row.max_message_bytes),
    rateLimitPerMin: Number(row.rate_limit_per_min),
    allowArbitraryRecipients: Boolean(row.allow_arbitrary_recipients),
    followupWorkflowId: row.followup_workflow_id === null ? null : Number(row.followup_workflow_id),
    createdAt: timestampToIso(row.created_at),
  };
}

function mapAllowedAccountRow(row: {
  account_id: number | string;
  from_address: string | null;
  email_address: string;
  display_name: string;
}): SmtpRelayAllowedAccountRecord {
  return {
    accountId: Number(row.account_id),
    fromAddress: row.from_address,
    emailAddress: row.email_address,
    displayName: row.display_name,
  };
}

function mapRelayCredentialRow(row: {
  id: string;
  username: string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}): SmtpRelayCredentialRecord {
  return {
    id: String(row.id),
    username: row.username,
    lastUsedAt: timestampToIsoOrNull(row.last_used_at),
    revokedAt: timestampToIsoOrNull(row.revoked_at),
    createdAt: timestampToIso(row.created_at),
  };
}

function mapRelaySubmissionRow(row: {
  id: string;
  status: 'received' | 'relayed' | 'failed';
  recipient_count: number;
  tracking_applied: boolean;
  tracking_rule_reason: string | null;
  message_id: number | string | null;
  smtp_message_id_header: string | null;
  error_text: string | null;
  created_at: Date | string;
}): SmtpRelaySubmissionRecord {
  return {
    id: String(row.id),
    status: row.status,
    recipientCount: Number(row.recipient_count),
    trackingApplied: Boolean(row.tracking_applied),
    trackingRuleReason: row.tracking_rule_reason,
    messageId: row.message_id === null ? null : Number(row.message_id),
    smtpMessageIdHeader: row.smtp_message_id_header,
    errorText: row.error_text,
    createdAt: timestampToIso(row.created_at),
  };
}

function mapRelayConstraintViolation(
  caught: unknown,
): 'duplicate_label' | 'followup_workflow_not_found' | null {
  if (isUniqueViolation(caught)) return 'duplicate_label';
  if (pgErrorCode(caught) === '23503' && pgErrorConstraint(caught).includes('followup_workflow')) {
    return 'followup_workflow_not_found';
  }
  return null;
}

function isUniqueViolation(caught: unknown): boolean {
  return pgErrorCode(caught) === '23505';
}

function pgErrorCode(caught: unknown): string | null {
  const code = (caught as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

function pgErrorConstraint(caught: unknown): string {
  const constraint = (caught as { constraint?: unknown } | null)?.constraint;
  return typeof constraint === 'string' ? constraint : '';
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
