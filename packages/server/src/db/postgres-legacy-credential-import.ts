import type { Kysely } from 'kysely';

import type { ServerDatabase } from './schema';
import type { PostgresSecretPort, SecretIdentifier } from './postgres-secret-port';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './workspace-context';

export const LEGACY_EMAIL_KEYTAR_SERVICE = 'SimpleCRMElectron-Email';
export const LEGACY_EMAIL_AI_KEYTAR_SERVICE = 'SimpleCRMElectron-EmailAI';
export const LEGACY_PGP_KEYTAR_SERVICE = 'SimpleCRMElectron-PGP';

export type LegacyCredentialSourcePort = Readonly<{
  readSecret(input: {
    service: string;
    account: string;
  }): Promise<string | Buffer | null>;
}>;

export type LegacyCredentialImportInput = Readonly<{
  workspaceId: string;
  source: LegacyCredentialSourcePort;
  secrets: PostgresSecretPort;
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type LegacyCredentialImportResult = Readonly<{
  imported: readonly LegacyCredentialImportItem[];
  skipped: readonly LegacyCredentialImportSkip[];
}>;

export type LegacyCredentialImportItem = Readonly<{
  targetTable: LegacyCredentialTargetTable;
  targetId: number | string;
  service: string;
  account: string;
  secret: SecretIdentifier & { id: string };
}>;

export type LegacyCredentialImportSkip = Readonly<{
  targetTable: LegacyCredentialTargetTable;
  targetId: number | string;
  service: string;
  account: string;
  reason: 'already_linked' | 'missing_legacy_secret';
}>;

export type LegacyCredentialTargetTable = 'email_accounts' | 'email_ai_profiles' | 'pgp_identities';

type CredentialCandidate = Readonly<{
  targetTable: LegacyCredentialTargetTable;
  targetId: number | string;
  service: string;
  account: string | null;
  secret: SecretIdentifier;
  alreadyLinked: boolean;
  link(secretId: string): Promise<void>;
}>;

export async function importLegacyCredentialsToPostgresSecrets(
  input: LegacyCredentialImportInput,
): Promise<LegacyCredentialImportResult> {
  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for legacy credential import');
  }

  const candidates = await collectCredentialCandidates(input);
  const imported: LegacyCredentialImportItem[] = [];
  const skipped: LegacyCredentialImportSkip[] = [];

  for (const candidate of candidates) {
    if (!candidate.account) continue;
    if (candidate.alreadyLinked) {
      skipped.push(skip(candidate, 'already_linked'));
      continue;
    }

    const value = await input.source.readSecret({
      service: candidate.service,
      account: candidate.account,
    });
    if (isMissingSecretValue(value)) {
      skipped.push(skip(candidate, 'missing_legacy_secret'));
      continue;
    }

    const secret = await input.secrets.writeSecret({
      ...candidate.secret,
      value,
    });
    await candidate.link(secret.id);
    imported.push({
      targetTable: candidate.targetTable,
      targetId: candidate.targetId,
      service: candidate.service,
      account: candidate.account,
      secret: {
        id: secret.id,
        workspaceId: secret.workspaceId,
        kind: secret.kind,
        name: secret.name,
      },
    });
  }

  return { imported, skipped };
}

async function collectCredentialCandidates(
  input: LegacyCredentialImportInput,
): Promise<readonly CredentialCandidate[]> {
  const workspaceId = input.workspaceId.trim();
  const emailAccounts = await input.db
    .selectFrom('email_accounts')
    .select([
      'id',
      'keytar_account_key',
      'imap_password_secret_id',
      'smtp_keytar_account_key',
      'smtp_password_secret_id',
      'oauth_refresh_keytar_key',
      'oauth_refresh_secret_id',
    ])
    .where('workspace_id', '=', workspaceId)
    .execute();
  const aiProfiles = await input.db
    .selectFrom('email_ai_profiles')
    .select(['id', 'legacy_keytar_account', 'secret_id'])
    .where('workspace_id', '=', workspaceId)
    .execute();
  const pgpIdentities = await input.db
    .selectFrom('pgp_identities')
    .select(['id', 'legacy_keytar_private_key_handle', 'private_key_secret_id'])
    .where('workspace_id', '=', workspaceId)
    .execute();

  return [
    ...emailAccounts.flatMap((row) => emailAccountCandidates(input, workspaceId, row)),
    ...aiProfiles.map((row) => aiProfileCandidate(input, workspaceId, row)),
    ...pgpIdentities.map((row) => pgpIdentityCandidate(input, workspaceId, row)),
  ];
}

function emailAccountCandidates(
  input: LegacyCredentialImportInput,
  workspaceId: string,
  row: {
    id: number;
    keytar_account_key: string | null;
    imap_password_secret_id: string | null;
    smtp_keytar_account_key: string | null;
    smtp_password_secret_id: string | null;
    oauth_refresh_keytar_key: string | null;
    oauth_refresh_secret_id: string | null;
  },
): readonly CredentialCandidate[] {
  return [
    {
      targetTable: 'email_accounts',
      targetId: row.id,
      service: LEGACY_EMAIL_KEYTAR_SERVICE,
      account: normalizedAccount(row.keytar_account_key),
      secret: secretIdentifier(workspaceId, 'email.account.imap_password', `email_account:${row.id}:imap`),
      alreadyLinked: Boolean(row.imap_password_secret_id),
      link: (secretId) => updateEmailAccountSecret(input, workspaceId, row.id, 'imap_password_secret_id', secretId),
    },
    {
      targetTable: 'email_accounts',
      targetId: row.id,
      service: LEGACY_EMAIL_KEYTAR_SERVICE,
      account: normalizedAccount(row.smtp_keytar_account_key),
      secret: secretIdentifier(workspaceId, 'email.account.smtp_password', `email_account:${row.id}:smtp`),
      alreadyLinked: Boolean(row.smtp_password_secret_id),
      link: (secretId) => updateEmailAccountSecret(input, workspaceId, row.id, 'smtp_password_secret_id', secretId),
    },
    {
      targetTable: 'email_accounts',
      targetId: row.id,
      service: LEGACY_EMAIL_KEYTAR_SERVICE,
      account: normalizedAccount(row.oauth_refresh_keytar_key),
      secret: secretIdentifier(workspaceId, 'email.account.oauth_refresh_token', `email_account:${row.id}:oauth_refresh`),
      alreadyLinked: Boolean(row.oauth_refresh_secret_id),
      link: (secretId) => updateEmailAccountSecret(input, workspaceId, row.id, 'oauth_refresh_secret_id', secretId),
    },
  ];
}

function aiProfileCandidate(
  input: LegacyCredentialImportInput,
  workspaceId: string,
  row: {
    id: number;
    legacy_keytar_account: string | null;
    secret_id: string | null;
  },
): CredentialCandidate {
  return {
    targetTable: 'email_ai_profiles',
    targetId: row.id,
    service: LEGACY_EMAIL_AI_KEYTAR_SERVICE,
    account: normalizedAccount(row.legacy_keytar_account),
    secret: secretIdentifier(workspaceId, 'email.ai_profile.api_key', `email_ai_profile:${row.id}:api_key`),
    alreadyLinked: Boolean(row.secret_id),
    link: (secretId) => updateSingleSecretReference(input, workspaceId, 'email_ai_profiles', row.id, 'secret_id', secretId),
  };
}

function pgpIdentityCandidate(
  input: LegacyCredentialImportInput,
  workspaceId: string,
  row: {
    id: number;
    legacy_keytar_private_key_handle: string | null;
    private_key_secret_id: string | null;
  },
): CredentialCandidate {
  return {
    targetTable: 'pgp_identities',
    targetId: row.id,
    service: LEGACY_PGP_KEYTAR_SERVICE,
    account: normalizedAccount(row.legacy_keytar_private_key_handle),
    secret: secretIdentifier(workspaceId, 'pgp.identity.private_key', `pgp_identity:${row.id}:private_key`),
    alreadyLinked: Boolean(row.private_key_secret_id),
    link: (secretId) => updateSingleSecretReference(
      input,
      workspaceId,
      'pgp_identities',
      row.id,
      'private_key_secret_id',
      secretId,
    ),
  };
}

function updateEmailAccountSecret(
  input: LegacyCredentialImportInput,
  workspaceId: string,
  id: number,
  column: 'imap_password_secret_id' | 'smtp_password_secret_id' | 'oauth_refresh_secret_id',
  secretId: string,
): Promise<void> {
  return withWorkspaceTransaction(input.db, {
    workspaceId,
    role: 'system',
  }, async (trx) => {
    await trx
      .updateTable('email_accounts')
      .set({ [column]: secretId })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
  }, { applySession: input.applyWorkspaceSession });
}

function updateSingleSecretReference(
  input: LegacyCredentialImportInput,
  workspaceId: string,
  table: 'email_ai_profiles' | 'pgp_identities',
  id: number,
  column: 'secret_id' | 'private_key_secret_id',
  secretId: string,
): Promise<void> {
  return withWorkspaceTransaction(input.db, {
    workspaceId,
    role: 'system',
  }, async (trx) => {
    await trx
      .updateTable(table)
      .set({ [column]: secretId })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
  }, { applySession: input.applyWorkspaceSession });
}

function secretIdentifier(workspaceId: string, kind: string, name: string): SecretIdentifier {
  return { workspaceId, kind, name };
}

function normalizedAccount(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMissingSecretValue(value: string | Buffer | null): value is null | '' {
  return value === null || (typeof value === 'string' && value.length === 0);
}

function skip(candidate: CredentialCandidate, reason: LegacyCredentialImportSkip['reason']): LegacyCredentialImportSkip {
  return {
    targetTable: candidate.targetTable,
    targetId: candidate.targetId,
    service: candidate.service,
    account: candidate.account ?? '',
    reason,
  };
}
