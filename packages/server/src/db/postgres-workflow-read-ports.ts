import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';

import type {
  AiProfileApiPort,
  AiProfileListResult,
  AiProfileMutationInput,
  AiProfileMutationPortResult,
  AiProfileRecord,
  AiPromptApiPort,
  AiPromptListResult,
  AiPromptMutationInput,
  AiPromptMutationPortResult,
  AiPromptRecord,
  AiPromptReorderPortResult,
  WorkflowApiPort,
  WorkflowListResult,
  WorkflowMutationInput,
  WorkflowMutationPortResult,
  WorkflowRecord,
} from '../api/types';
import type {
  EmailAiProfilesTable,
  EmailAiPromptsTable,
  EmailWorkflowsTable,
  ServerDatabase,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';
import {
  resolveEmailAccountReference,
  type EmailAccountReference,
} from './resolve-email-account-reference';
import type { PostgresSecretPort } from './postgres-secret-port';

export type PostgresWorkflowReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  secrets?: PostgresSecretPort;
}>;

type AiProfileRow = Selectable<EmailAiProfilesTable>;
type AiPromptRow = Selectable<EmailAiPromptsTable>;
type WorkflowRow = Selectable<EmailWorkflowsTable>;
type AiProfileReference = Readonly<{
  id: number;
  sourceSqliteId: number | null;
}>;

const aiProfileSelectColumns = [
  'id',
  'source_sqlite_id',
  'label',
  'provider',
  'base_url',
  'model',
  'embedding_model',
  'legacy_keytar_account',
  'secret_id',
  'is_default',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const aiPromptSelectColumns = [
  'id',
  'source_sqlite_id',
  'label',
  'user_template',
  'target',
  'profile_source_sqlite_id',
  'profile_id',
  'account_source_sqlite_id',
  'account_id',
  'override_key',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const workflowSelectColumns = [
  'id',
  'source_sqlite_id',
  'name',
  'trigger_name',
  'enabled',
  'priority',
  'definition_json',
  'graph_json',
  'cron_expr',
  'schedule_account_source_sqlite_id',
  'schedule_account_id',
  'account_source_sqlite_id',
  'account_id',
  'override_key',
  'execution_mode',
  'engine_version',
  'legacy_created_by_user_id',
  'created_by_user_id',
  'created_at',
  'updated_at',
] as const;

export function createPostgresAiProfileReadPort(options: PostgresWorkflowReadPortOptions): AiProfileApiPort {
  return {
    async list(input): Promise<AiProfileListResult> {
      const limit = normalizeLimit(input.limit, 'AI profile');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_ai_profiles')
            .select(aiProfileSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('label', 'ilike', pattern),
              eb('provider', 'ilike', pattern),
              eb('model', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapAiProfileRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<AiProfileRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_ai_profiles')
            .select(aiProfileSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapAiProfileRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<AiProfileMutationPortResult> {
      const values = normalizeAiProfileMutation(input.values, {
        requireAtLeastOneField: true,
        requireLabel: true,
        requireProvider: true,
        requireBaseUrl: true,
        requireModel: true,
      });
      if (typeof values.apiKey === 'string' && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      let profile = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .insertInto('email_ai_profiles')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedAiProfileSourceSqliteId(),
              label: values.label as string,
              provider: values.provider as string,
              base_url: values.baseUrl as string,
              model: values.model as string,
              embedding_model: values.embeddingModel ?? null,
              legacy_keytar_account: null,
              secret_id: null,
              is_default: values.isDefault ?? false,
              sort_order: values.sortOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(aiProfileSelectColumns)
            .executeTakeFirstOrThrow();

          if (values.isDefault === true) {
            await clearOtherDefaultAiProfiles(trx, input.workspaceId, Number(row.id), now);
          }

          return mapAiProfileRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      if (typeof values.apiKey === 'string') {
        profile = await writeAiProfileApiKey(options, input.workspaceId, profile.id, values.apiKey);
      }

      return { ok: true, profile };
    },
    async update(input): Promise<AiProfileMutationPortResult | null> {
      const values = normalizeAiProfileMutation(input.values, {
        requireAtLeastOneField: true,
        requireLabel: false,
        requireProvider: false,
        requireBaseUrl: false,
        requireModel: false,
      });

      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => trx
            .selectFrom('email_ai_profiles')
            .select(aiProfileSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;

      let secretId: string | null | undefined;
      if (typeof values.apiKey === 'string') {
        if (!options.secrets) return { ok: false, code: 'secret_port_unavailable' };
        const secret = await options.secrets.writeSecret({
          ...aiProfileApiKeySecretIdentifier(input.workspaceId, input.id),
          value: values.apiKey,
        });
        secretId = secret.id;
      } else if (values.apiKey === null) {
        if (current.secret_id !== null && !options.secrets) {
          return { ok: false, code: 'secret_port_unavailable' };
        }
        secretId = null;
      }

      const profile = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .updateTable('email_ai_profiles')
            .set({
              ...mutationToAiProfilePatch(values, secretId),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(aiProfileSelectColumns)
            .executeTakeFirstOrThrow();

          if (values.isDefault === true) {
            await clearOtherDefaultAiProfiles(trx, input.workspaceId, input.id, now);
          }

          return mapAiProfileRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      if (values.apiKey === null && current.secret_id !== null) {
        await options.secrets?.deleteSecret(aiProfileApiKeySecretIdentifier(input.workspaceId, input.id));
      }

      return { ok: true, profile };
    },
    async delete(input): Promise<AiProfileMutationPortResult | null> {
      const current = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => trx
            .selectFrom('email_ai_profiles')
            .select(aiProfileSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!current) return null;
      if (current.secret_id !== null && !options.secrets) {
        return { ok: false, code: 'secret_port_unavailable' };
      }

      const profile = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_ai_profiles')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(aiProfileSelectColumns)
            .executeTakeFirstOrThrow();
          return mapAiProfileRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      if (current.secret_id !== null) {
        await options.secrets?.deleteSecret(aiProfileApiKeySecretIdentifier(input.workspaceId, input.id));
      }

      return { ok: true, profile };
    },
  };
}

export function createPostgresAiPromptReadPort(options: PostgresWorkflowReadPortOptions): AiPromptApiPort {
  return {
    async list(input): Promise<AiPromptListResult> {
      const limit = normalizeLimit(input.limit, 'AI prompt');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_ai_prompts')
            .select(aiPromptSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.target !== undefined) query = query.where('target', '=', input.target);
          if (input.profileId !== undefined) query = query.where('profile_id', '=', input.profileId);
          if (input.accountId === undefined) {
            query = query.where('account_id', 'is', null);
          } else {
            const account = await resolveEmailAccountReference(trx, input.workspaceId, input.accountId);
            if (!account) return { items: [], nextCursor: null };
            query = query.where((eb) => eb.or([
              eb('account_id', 'is', null),
              eb('account_id', '=', account.id),
            ]));
          }
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('label', 'ilike', pattern),
              eb('user_template', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapAiPromptRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<AiPromptRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_ai_prompts')
            .select(aiPromptSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapAiPromptRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<AiPromptMutationPortResult> {
      const values = normalizeAiPromptMutation(input.values, {
        requireAtLeastOneField: true,
        requireLabel: true,
        requireUserTemplate: true,
        requireTarget: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const profile = values.profileId === undefined || values.profileId === null
            ? null
            : await resolveAiProfileReference(trx, input.workspaceId, values.profileId);
          if (values.profileId !== undefined && values.profileId !== null && !profile) {
            return { ok: false, code: 'profile_not_found' };
          }
          const account = values.accountId === undefined || values.accountId === null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'profile_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('email_ai_prompts')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedAiPromptSourceSqliteId(),
              label: values.label as string,
              user_template: values.userTemplate as string,
              target: values.target as string,
              profile_source_sqlite_id: profile?.sourceSqliteId ?? null,
              profile_id: profile?.id ?? null,
              account_source_sqlite_id: account?.sourceSqliteId ?? null,
              account_id: account?.id ?? null,
              override_key: values.overrideKey ?? null,
              sort_order: values.sortOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(aiPromptSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, prompt: mapAiPromptRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<AiPromptMutationPortResult | null> {
      const values = normalizeAiPromptMutation(input.values, {
        requireAtLeastOneField: true,
        requireLabel: false,
        requireUserTemplate: false,
        requireTarget: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_ai_prompts')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const profile = values.profileId === undefined
            ? undefined
            : values.profileId === null
              ? null
              : await resolveAiProfileReference(trx, input.workspaceId, values.profileId);
          if (values.profileId !== undefined && values.profileId !== null && !profile) {
            return { ok: false, code: 'profile_not_found' };
          }
          const account = values.accountId === undefined
            ? undefined
            : values.accountId === null
              ? null
              : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'profile_not_found' };
          }

          const row = await trx
            .updateTable('email_ai_prompts')
            .set({
              ...mutationToAiPromptPatch(values, profile, account),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(aiPromptSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, prompt: mapAiPromptRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async reorder(input): Promise<AiPromptReorderPortResult> {
      if (input.updates.length === 0) return { ok: true, prompts: [] };
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const ids = Array.from(new Set(input.updates.map((update) => update.id)));
          const existing = await trx
            .selectFrom('email_ai_prompts')
            .select('id')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', 'in', ids)
            .execute();
          const existingIds = new Set(existing.map((row) => Number(row.id)));
          for (const id of ids) {
            if (!existingIds.has(id)) return { ok: false, code: 'prompt_not_found', id };
          }

          const updated: AiPromptRecord[] = [];
          const now = new Date();
          for (const update of input.updates) {
            const row = await trx
              .updateTable('email_ai_prompts')
              .set({
                sort_order: update.sortOrder,
                updated_at: now,
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', update.id)
              .returning(aiPromptSelectColumns)
              .executeTakeFirstOrThrow();
            updated.push(mapAiPromptRow(row));
          }
          return { ok: true, prompts: updated };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<AiPromptRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_ai_prompts')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(aiPromptSelectColumns)
            .executeTakeFirst();
          return row ? mapAiPromptRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowReadPort(options: PostgresWorkflowReadPortOptions): WorkflowApiPort {
  return {
    async list(input): Promise<WorkflowListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflows')
            .select(workflowSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.triggerName !== undefined) query = query.where('trigger_name', '=', input.triggerName);
          if (input.enabled !== undefined) query = query.where('enabled', '=', input.enabled);
          if (input.accountId !== undefined) {
            query = query.where((eb) => eb.or([
              eb('account_id', 'is', null),
              eb('account_id', '=', input.accountId!),
            ]));
          }
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('name', 'ilike', pattern),
              eb('trigger_name', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapWorkflowRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_workflows')
            .select(workflowSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapWorkflowRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<WorkflowMutationPortResult> {
      const values = normalizeWorkflowMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: true,
        requireTriggerName: true,
        requireDefinition: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const scheduleAccount = values.scheduleAccountId === undefined || values.scheduleAccountId === null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.scheduleAccountId);
          if (values.scheduleAccountId !== undefined && values.scheduleAccountId !== null && !scheduleAccount) {
            return { ok: false, code: 'schedule_account_not_found' };
          }
          const account = values.accountId === undefined || values.accountId === null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'schedule_account_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('email_workflows')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedWorkflowSourceSqliteId(),
              name: values.name as string,
              trigger_name: values.triggerName as string,
              enabled: values.enabled ?? true,
              priority: values.priority ?? 100,
              definition_json: values.definition,
              graph_json: values.graph ?? null,
              cron_expr: values.cronExpr ?? null,
              schedule_account_source_sqlite_id: scheduleAccount?.sourceSqliteId ?? null,
              schedule_account_id: scheduleAccount?.id ?? null,
              account_source_sqlite_id: account?.sourceSqliteId ?? null,
              account_id: account?.id ?? null,
              override_key: values.overrideKey ?? null,
              execution_mode: values.executionMode ?? 'graph',
              engine_version: values.engineVersion ?? 1,
              legacy_created_by_user_id: null,
              created_by_user_id: input.actorUserId,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(workflowSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, workflow: mapWorkflowRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<WorkflowMutationPortResult | null> {
      const values = normalizeWorkflowMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: false,
        requireTriggerName: false,
        requireDefinition: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await trx
            .selectFrom('email_workflows')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const scheduleAccount = values.scheduleAccountId === undefined
            ? undefined
            : values.scheduleAccountId === null
              ? null
              : await resolveEmailAccountReference(trx, input.workspaceId, values.scheduleAccountId);
          if (values.scheduleAccountId !== undefined && values.scheduleAccountId !== null && !scheduleAccount) {
            return { ok: false, code: 'schedule_account_not_found' };
          }
          const account = values.accountId === undefined
            ? undefined
            : values.accountId === null
              ? null
              : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'schedule_account_not_found' };
          }

          const row = await trx
            .updateTable('email_workflows')
            .set({
              ...mutationToWorkflowPatch(values, scheduleAccount, account),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, workflow: mapWorkflowRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<WorkflowRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_workflows')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowSelectColumns)
            .executeTakeFirst();
          return row ? mapWorkflowRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function normalizeLimit(limit: number, label: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${label} list limit must be between 1 and 100`);
  }
  return limit;
}

function normalizeAiProfileMutation(
  values: AiProfileMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireLabel: boolean;
    requireProvider: boolean;
    requireBaseUrl: boolean;
    requireModel: boolean;
  },
): AiProfileMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('AI profile mutation must include at least one field');
  }
  if (options.requireLabel && normalized.label === undefined) throw new Error('AI profile label is required');
  if (options.requireProvider && normalized.provider === undefined) throw new Error('AI profile provider is required');
  if (options.requireBaseUrl && normalized.baseUrl === undefined) throw new Error('AI profile baseUrl is required');
  if (options.requireModel && normalized.model === undefined) throw new Error('AI profile model is required');

  for (const key of ['label', 'provider', 'model'] as const) {
    if (normalized[key] !== undefined) {
      const value = normalized[key]?.trim();
      if (!value) throw new Error(`AI profile ${key} must not be empty`);
      normalized[key] = value;
    }
  }
  if (normalized.baseUrl !== undefined) {
    normalized.baseUrl = normalizeAiProfileBaseUrl(normalized.baseUrl);
  }
  if (normalized.embeddingModel !== undefined && normalized.embeddingModel !== null) {
    const value = normalized.embeddingModel.trim();
    if (!value) throw new Error('AI profile embeddingModel must not be empty');
    normalized.embeddingModel = value;
  }
  if (
    normalized.isDefault !== undefined
    && typeof normalized.isDefault !== 'boolean'
  ) {
    throw new Error('AI profile isDefault must be boolean');
  }
  if (
    normalized.sortOrder !== undefined
    && (!Number.isSafeInteger(normalized.sortOrder) || normalized.sortOrder < 0)
  ) {
    throw new Error('AI profile sortOrder must be a non-negative integer');
  }
  if (normalized.apiKey !== undefined && normalized.apiKey !== null) {
    const value = normalized.apiKey.trim();
    if (!value) throw new Error('AI profile apiKey must not be empty');
    normalized.apiKey = value;
  }
  return normalized;
}

function normalizeAiProfileBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('AI profile baseUrl must not be empty');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AI profile baseUrl must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function mutationToAiProfilePatch(
  values: AiProfileMutationInput,
  secretId: string | null | undefined,
): Partial<Updateable<EmailAiProfilesTable>> {
  return {
    ...(values.label === undefined ? {} : { label: values.label }),
    ...(values.provider === undefined ? {} : { provider: values.provider }),
    ...(values.baseUrl === undefined ? {} : { base_url: values.baseUrl }),
    ...(values.model === undefined ? {} : { model: values.model }),
    ...(values.embeddingModel === undefined ? {} : { embedding_model: values.embeddingModel }),
    ...(values.isDefault === undefined ? {} : { is_default: values.isDefault }),
    ...(values.sortOrder === undefined ? {} : { sort_order: values.sortOrder }),
    ...(values.apiKey === undefined ? {} : {
      legacy_keytar_account: null,
      ...(secretId === undefined ? {} : { secret_id: secretId }),
    }),
  };
}

async function clearOtherDefaultAiProfiles(
  trx: WorkspaceTransaction,
  workspaceId: string,
  profileId: number,
  now: Date,
): Promise<void> {
  await trx
    .updateTable('email_ai_profiles')
    .set({
      is_default: false,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '!=', profileId)
    .where('is_default', '=', true)
    .execute();
}

async function writeAiProfileApiKey(
  options: PostgresWorkflowReadPortOptions,
  workspaceId: string,
  profileId: number,
  apiKey: string,
): Promise<AiProfileRecord> {
  if (!options.secrets) throw new Error('AI profile secret port is not configured');
  const secret = await options.secrets.writeSecret({
    ...aiProfileApiKeySecretIdentifier(workspaceId, profileId),
    value: apiKey,
  });
  return withWorkspaceTransaction(
    options.db,
    {
      workspaceId,
      role: 'system',
    },
    async (trx) => {
      const row = await trx
        .updateTable('email_ai_profiles')
        .set({
          legacy_keytar_account: null,
          secret_id: secret.id,
          updated_at: new Date(),
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', profileId)
        .returning(aiProfileSelectColumns)
        .executeTakeFirstOrThrow();
      return mapAiProfileRow(row);
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function aiProfileApiKeySecretIdentifier(workspaceId: string, profileId: number): {
  workspaceId: string;
  kind: string;
  name: string;
} {
  return {
    workspaceId,
    kind: 'email.ai_profile.api_key',
    name: `email_ai_profile:${profileId}:api_key`,
  };
}

function normalizeWorkflowMutation(
  values: WorkflowMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireTriggerName: boolean;
    requireDefinition: boolean;
  },
): WorkflowMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Workflow mutation must include at least one field');
  }
  if (options.requireName && normalized.name === undefined) throw new Error('Workflow name is required');
  if (options.requireTriggerName && normalized.triggerName === undefined) {
    throw new Error('Workflow triggerName is required');
  }
  if (options.requireDefinition && normalized.definition === undefined) {
    throw new Error('Workflow definition is required');
  }

  for (const key of ['name', 'triggerName', 'executionMode'] as const) {
    if (normalized[key] !== undefined) {
      const value = normalized[key]?.trim();
      if (!value) throw new Error(`Workflow ${key} must not be empty`);
      normalized[key] = value;
    }
  }
  if (normalized.enabled !== undefined && typeof normalized.enabled !== 'boolean') {
    throw new Error('Workflow enabled must be boolean');
  }
  if (
    normalized.priority !== undefined
    && (!Number.isSafeInteger(normalized.priority) || normalized.priority < 0)
  ) {
    throw new Error('Workflow priority must be a non-negative integer');
  }
  if (normalized.definition !== undefined) {
    assertJsonObjectLike(normalized.definition, 'Workflow definition');
  }
  if (normalized.graph !== undefined && normalized.graph !== null) {
    assertJsonObjectLike(normalized.graph, 'Workflow graph');
  }
  if (normalized.cronExpr !== undefined && normalized.cronExpr !== null) {
    const value = normalized.cronExpr.trim();
    if (!value) throw new Error('Workflow cronExpr must not be empty');
    normalized.cronExpr = value;
  }
  if (
    normalized.scheduleAccountId !== undefined
    && normalized.scheduleAccountId !== null
    && (!Number.isSafeInteger(normalized.scheduleAccountId) || normalized.scheduleAccountId <= 0)
  ) {
    throw new Error('Workflow scheduleAccountId must be a positive integer');
  }
  if (
    normalized.accountId !== undefined
    && normalized.accountId !== null
    && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)
  ) {
    throw new Error('Workflow accountId must be a positive integer');
  }
  if (normalized.overrideKey !== undefined && normalized.overrideKey !== null) {
    const value = normalized.overrideKey.trim();
    normalized.overrideKey = value || null;
  }
  if (
    normalized.engineVersion !== undefined
    && (!Number.isSafeInteger(normalized.engineVersion) || normalized.engineVersion <= 0)
  ) {
    throw new Error('Workflow engineVersion must be a positive integer');
  }
  return normalized;
}

function mutationToWorkflowPatch(
  values: WorkflowMutationInput,
  scheduleAccount: EmailAccountReference | null | undefined,
  account: EmailAccountReference | null | undefined,
): Partial<Updateable<EmailWorkflowsTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.triggerName === undefined ? {} : { trigger_name: values.triggerName }),
    ...(values.enabled === undefined ? {} : { enabled: values.enabled }),
    ...(values.priority === undefined ? {} : { priority: values.priority }),
    ...(values.definition === undefined ? {} : { definition_json: values.definition }),
    ...(values.graph === undefined ? {} : { graph_json: values.graph }),
    ...(values.cronExpr === undefined ? {} : { cron_expr: values.cronExpr }),
    ...(values.executionMode === undefined ? {} : { execution_mode: values.executionMode }),
    ...(values.engineVersion === undefined ? {} : { engine_version: values.engineVersion }),
    ...(values.scheduleAccountId === undefined ? {} : {
      schedule_account_id: scheduleAccount?.id ?? null,
      schedule_account_source_sqlite_id: scheduleAccount?.sourceSqliteId ?? null,
    }),
    ...(values.accountId === undefined ? {} : {
      account_id: account?.id ?? null,
      account_source_sqlite_id: account?.sourceSqliteId ?? null,
    }),
    ...(values.overrideKey === undefined ? {} : { override_key: values.overrideKey }),
  };
}

function assertJsonObjectLike(value: unknown, label: string): void {
  if (!isJsonObjectLike(value) || !isJsonCompatible(value)) {
    throw new Error(`${label} must be a JSON object or array`);
  }
}

function isJsonObjectLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value);
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (isPlainObject(value)) {
    return Object.values(value).every((item) => item !== undefined && isJsonCompatible(item));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeAiPromptMutation(
  values: AiPromptMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireLabel: boolean;
    requireUserTemplate: boolean;
    requireTarget: boolean;
  },
): AiPromptMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('AI prompt mutation must include at least one field');
  }
  if (options.requireLabel && normalized.label === undefined) throw new Error('AI prompt label is required');
  if (options.requireUserTemplate && normalized.userTemplate === undefined) {
    throw new Error('AI prompt userTemplate is required');
  }
  if (options.requireTarget && normalized.target === undefined) throw new Error('AI prompt target is required');
  for (const key of ['label', 'userTemplate', 'target'] as const) {
    if (normalized[key] !== undefined) {
      const value = normalized[key]?.trim();
      if (!value) throw new Error(`AI prompt ${key} must not be empty`);
      normalized[key] = value;
    }
  }
  if (
    normalized.profileId !== undefined
    && normalized.profileId !== null
    && (!Number.isSafeInteger(normalized.profileId) || normalized.profileId <= 0)
  ) {
    throw new Error('AI prompt profileId must be a positive integer');
  }
  if (
    normalized.accountId !== undefined
    && normalized.accountId !== null
    && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)
  ) {
    throw new Error('AI prompt accountId must be a positive integer');
  }
  if (normalized.overrideKey !== undefined && normalized.overrideKey !== null) {
    const value = normalized.overrideKey.trim();
    normalized.overrideKey = value || null;
  }
  if (
    normalized.sortOrder !== undefined
    && (!Number.isSafeInteger(normalized.sortOrder) || normalized.sortOrder < 0)
  ) {
    throw new Error('AI prompt sortOrder must be a non-negative integer');
  }
  return normalized;
}

function mutationToAiPromptPatch(
  values: AiPromptMutationInput,
  profile: AiProfileReference | null | undefined,
  account: EmailAccountReference | null | undefined,
): Partial<Updateable<EmailAiPromptsTable>> {
  return {
    ...(values.label === undefined ? {} : { label: values.label }),
    ...(values.userTemplate === undefined ? {} : { user_template: values.userTemplate }),
    ...(values.target === undefined ? {} : { target: values.target }),
    ...(values.sortOrder === undefined ? {} : { sort_order: values.sortOrder }),
    ...(values.profileId === undefined ? {} : {
      profile_id: profile?.id ?? null,
      profile_source_sqlite_id: profile?.sourceSqliteId ?? null,
    }),
    ...(values.accountId === undefined ? {} : {
      account_id: account?.id ?? null,
      account_source_sqlite_id: account?.sourceSqliteId ?? null,
    }),
    ...(values.overrideKey === undefined ? {} : { override_key: values.overrideKey }),
  };
}

async function resolveAiProfileReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  profileId: number,
): Promise<AiProfileReference | null> {
  const row = await trx
    .selectFrom('email_ai_profiles')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', profileId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
  };
}

function serverCreatedAiProfileSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_ai_profiles', 'id'))`;
}

function serverCreatedAiPromptSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_ai_prompts', 'id'))`;
}

function serverCreatedWorkflowSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_workflows', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function mapAiProfileRow(row: Pick<AiProfileRow, typeof aiProfileSelectColumns[number]>): AiProfileRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    label: row.label,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    embeddingModel: row.embedding_model,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    apiKeyConfigured: Boolean(row.secret_id ?? row.legacy_keytar_account),
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapAiPromptRow(row: Pick<AiPromptRow, typeof aiPromptSelectColumns[number]>): AiPromptRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    label: row.label,
    userTemplate: row.user_template,
    target: row.target,
    profileSourceSqliteId: row.profile_source_sqlite_id === null ? null : Number(row.profile_source_sqlite_id),
    profileId: row.profile_id === null ? null : Number(row.profile_id),
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    overrideKey: row.override_key,
    sortOrder: row.sort_order,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowRow(row: Pick<WorkflowRow, typeof workflowSelectColumns[number]>): WorkflowRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    name: row.name,
    triggerName: row.trigger_name,
    enabled: row.enabled,
    priority: row.priority,
    definition: row.definition_json,
    graph: row.graph_json,
    cronExpr: row.cron_expr,
    scheduleAccountSourceSqliteId: row.schedule_account_source_sqlite_id === null
      ? null
      : Number(row.schedule_account_source_sqlite_id),
    scheduleAccountId: row.schedule_account_id === null ? null : Number(row.schedule_account_id),
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    overrideKey: row.override_key,
    executionMode: row.execution_mode,
    engineVersion: row.engine_version,
    legacyCreatedByUserId: row.legacy_created_by_user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
