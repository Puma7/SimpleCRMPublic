import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';

import type {
  SpamDecisionApiPort,
  SpamDecisionListResult,
  SpamDecisionMutationInput,
  SpamDecisionMutationPortResult,
  SpamDecisionRecord,
  SpamFeatureStatApiPort,
  SpamFeatureStatListResult,
  SpamFeatureStatRecord,
  SpamLearningEventApiPort,
  SpamLearningEventListResult,
  SpamLearningEventMutationInput,
  SpamLearningEventMutationPortResult,
  SpamLearningEventRecord,
  SpamListEntryApiPort,
  SpamListEntryListResult,
  SpamListEntryMutationInput,
  SpamListEntryMutationPortResult,
  SpamListEntryRecord,
} from '../api/types';
import type {
  EmailSpamDecisionsTable,
  EmailSpamFeatureStatsTable,
  EmailSpamLearningEventsTable,
  EmailSpamListEntriesTable,
  ServerDatabase,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresSpamReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type SpamListEntryRow = Selectable<EmailSpamListEntriesTable>;
type SpamLearningEventRow = Selectable<EmailSpamLearningEventsTable>;
type SpamDecisionRow = Selectable<EmailSpamDecisionsTable>;
type SpamFeatureStatRow = Selectable<EmailSpamFeatureStatsTable>;
type EmailAccountReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type EmailMessageReference = Readonly<{
  id: number;
  sourceSqliteId: number;
  accountId: number;
  accountSourceSqliteId: number;
}>;

const spamListEntrySelectColumns = [
  'id',
  'source_sqlite_id',
  'list_type',
  'pattern_type',
  'pattern',
  'account_source_sqlite_id',
  'account_id',
  'note',
  'created_at',
  'updated_at',
] as const;

const spamLearningEventSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'account_source_sqlite_id',
  'message_id',
  'account_id',
  'label',
  'source',
  'feature_keys_json',
  'created_at',
  'updated_at',
] as const;

const spamDecisionSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'account_source_sqlite_id',
  'message_id',
  'account_id',
  'score',
  'status',
  'source',
  'breakdown_json',
  'model_version',
  'created_at',
  'updated_at',
] as const;

const spamFeatureStatSelectColumns = [
  'feature_key',
  'spam_count',
  'ham_count',
  'updated_at',
] as const;

export function createPostgresSpamListEntryReadPort(options: PostgresSpamReadPortOptions): SpamListEntryApiPort {
  return {
    async list(input): Promise<SpamListEntryListResult> {
      const limit = normalizeLimit(input.limit, 'Spam list entry');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_spam_list_entries')
            .select(spamListEntrySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.listType !== undefined) query = query.where('list_type', '=', input.listType);
          if (input.patternType !== undefined) query = query.where('pattern_type', '=', input.patternType);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('pattern', 'ilike', pattern),
              eb('note', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapSpamListEntryRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<SpamListEntryRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_spam_list_entries')
            .select(spamListEntrySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapSpamListEntryRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<SpamListEntryMutationPortResult> {
      const values = normalizeSpamListEntryMutation(input.values, {
        requireAtLeastOneField: true,
        requireListType: true,
        requirePatternType: true,
        requirePattern: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = values.accountId === undefined || values.accountId === null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'account_not_found' };
          }

          const conflict = await resolveSpamListEntryConflict(trx, input.workspaceId, {
            listType: values.listType as 'allow' | 'block',
            patternType: values.patternType as 'email' | 'domain',
            pattern: values.pattern as string,
            accountId: account?.id ?? null,
          });
          if (conflict) return { ok: false, code: 'entry_conflict' };

          const now = new Date();
          const row = await trx
            .insertInto('email_spam_list_entries')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedSpamListEntrySourceSqliteId(),
              list_type: values.listType as 'allow' | 'block',
              pattern_type: values.patternType as 'email' | 'domain',
              pattern: values.pattern as string,
              account_source_sqlite_id: account?.sourceSqliteId ?? null,
              account_id: account?.id ?? null,
              note: values.note ?? null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(spamListEntrySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, entry: mapSpamListEntryRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<SpamListEntryMutationPortResult | null> {
      const values = normalizeSpamListEntryMutation(input.values, {
        requireAtLeastOneField: true,
        requireListType: false,
        requirePatternType: false,
        requirePattern: false,
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
            .selectFrom('email_spam_list_entries')
            .select(spamListEntrySelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const account = values.accountId === undefined
            ? {
              id: current.account_id === null ? null : Number(current.account_id),
              sourceSqliteId: current.account_source_sqlite_id === null ? null : Number(current.account_source_sqlite_id),
            }
            : values.accountId === null
              ? { id: null, sourceSqliteId: null }
              : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            return { ok: false, code: 'account_not_found' };
          }

          const merged = {
            listType: values.listType ?? current.list_type,
            patternType: values.patternType ?? current.pattern_type,
            pattern: values.pattern ?? current.pattern,
            accountId: account?.id ?? null,
          };
          const conflict = await resolveSpamListEntryConflict(trx, input.workspaceId, merged, input.id);
          if (conflict) return { ok: false, code: 'entry_conflict' };

          const now = new Date();
          const row = await trx
            .updateTable('email_spam_list_entries')
            .set({
              ...mutationToSpamListEntryPatch(values),
              ...(values.accountId === undefined ? {} : {
                account_id: account?.id ?? null,
                account_source_sqlite_id: account?.sourceSqliteId ?? null,
              }),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(spamListEntrySelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, entry: mapSpamListEntryRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<SpamListEntryRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_spam_list_entries')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(spamListEntrySelectColumns)
            .executeTakeFirst();
          return row ? mapSpamListEntryRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresSpamLearningEventReadPort(options: PostgresSpamReadPortOptions): SpamLearningEventApiPort {
  return {
    async list(input): Promise<SpamLearningEventListResult> {
      const limit = normalizeLimit(input.limit, 'Spam learning event');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_spam_learning_events')
            .select(spamLearningEventSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.label !== undefined) query = query.where('label', '=', input.label);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapSpamLearningEventRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<SpamLearningEventRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_spam_learning_events')
            .select(spamLearningEventSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapSpamLearningEventRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<SpamLearningEventMutationPortResult> {
      const values = normalizeSpamLearningEventMutation(input.values);
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = await resolveEmailAccountReference(trx, input.workspaceId, values.accountId as number);
          if (!account) return { ok: false, code: 'account_not_found' };

          const message = values.messageId === undefined || values.messageId === null
            ? null
            : await resolveEmailMessageReference(trx, input.workspaceId, values.messageId);
          if (values.messageId !== undefined && values.messageId !== null && !message) {
            return { ok: false, code: 'message_not_found' };
          }
          if (message && message.accountId !== account.id) {
            return { ok: false, code: 'message_account_mismatch' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('email_spam_learning_events')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedSpamLearningEventSourceSqliteId(),
              message_source_sqlite_id: message?.sourceSqliteId ?? null,
              account_source_sqlite_id: account.sourceSqliteId,
              message_id: message?.id ?? null,
              account_id: account.id,
              label: values.label as 'spam' | 'ham',
              source: values.source ?? 'server_api',
              feature_keys_json: values.featureKeys ?? null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(spamLearningEventSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, event: mapSpamLearningEventRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresSpamDecisionReadPort(options: PostgresSpamReadPortOptions): SpamDecisionApiPort {
  return {
    async list(input): Promise<SpamDecisionListResult> {
      const limit = normalizeLimit(input.limit, 'Spam decision');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_spam_decisions')
            .select(spamDecisionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.status !== undefined) query = query.where('status', '=', input.status);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapSpamDecisionRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<SpamDecisionRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_spam_decisions')
            .select(spamDecisionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapSpamDecisionRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<SpamDecisionMutationPortResult> {
      const values = normalizeSpamDecisionMutation(input.values, {
        requireAtLeastOneField: true,
        requireAccountId: true,
        requireScore: true,
        requireStatus: true,
        requireSource: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = await resolveEmailAccountReference(trx, input.workspaceId, values.accountId as number);
          if (!account) return { ok: false, code: 'account_not_found' };

          const message = values.messageId === undefined || values.messageId === null
            ? null
            : await resolveEmailMessageReference(trx, input.workspaceId, values.messageId);
          if (values.messageId !== undefined && values.messageId !== null && !message) {
            return { ok: false, code: 'message_not_found' };
          }
          if (message && message.accountId !== account.id) {
            return { ok: false, code: 'message_account_mismatch' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('email_spam_decisions')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedSpamDecisionSourceSqliteId(),
              message_source_sqlite_id: message?.sourceSqliteId ?? null,
              account_source_sqlite_id: account.sourceSqliteId,
              message_id: message?.id ?? null,
              account_id: account.id,
              score: values.score as number,
              status: values.status as 'clean' | 'review' | 'spam',
              source: values.source as string,
              breakdown_json: values.breakdown ?? null,
              model_version: values.modelVersion ?? 1,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(spamDecisionSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, decision: mapSpamDecisionRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<SpamDecisionMutationPortResult | null> {
      const values = normalizeSpamDecisionMutation(input.values, {
        requireAtLeastOneField: true,
        requireAccountId: false,
        requireScore: false,
        requireStatus: false,
        requireSource: false,
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
            .selectFrom('email_spam_decisions')
            .select(spamDecisionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const account = values.accountId === undefined
            ? current.account_id === null
              ? null
              : {
                id: Number(current.account_id),
                sourceSqliteId: Number(current.account_source_sqlite_id),
              }
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && !account) {
            return { ok: false, code: 'account_not_found' };
          }

          const message = values.messageId === undefined
            ? current.message_id === null
              ? null
              : await resolveEmailMessageReference(trx, input.workspaceId, Number(current.message_id))
            : values.messageId === null
              ? null
              : await resolveEmailMessageReference(trx, input.workspaceId, values.messageId);
          if (values.messageId !== undefined && values.messageId !== null && !message) {
            return { ok: false, code: 'message_not_found' };
          }
          if (message && account && message.accountId !== account.id) {
            return { ok: false, code: 'message_account_mismatch' };
          }

          const now = new Date();
          const row = await trx
            .updateTable('email_spam_decisions')
            .set({
              ...mutationToSpamDecisionPatch(values),
              ...(values.accountId === undefined ? {} : {
                account_id: account!.id,
                account_source_sqlite_id: account!.sourceSqliteId,
              }),
              ...(values.messageId === undefined ? {} : {
                message_id: message?.id ?? null,
                message_source_sqlite_id: message?.sourceSqliteId ?? null,
              }),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(spamDecisionSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, decision: mapSpamDecisionRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<SpamDecisionRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_spam_decisions')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(spamDecisionSelectColumns)
            .executeTakeFirst();
          return row ? mapSpamDecisionRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresSpamFeatureStatReadPort(options: PostgresSpamReadPortOptions): SpamFeatureStatApiPort {
  return {
    async list(input): Promise<SpamFeatureStatListResult> {
      const limit = normalizeLimit(input.limit, 'Spam feature stat');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_spam_feature_stats')
            .select(spamFeatureStatSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('feature_key', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('feature_key', '>', input.cursor);
          const search = input.search?.trim();
          if (search) query = query.where('feature_key', 'ilike', `%${search}%`);

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapSpamFeatureStatRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.feature_key ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<SpamFeatureStatRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_spam_feature_stats')
            .select(spamFeatureStatSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('feature_key', '=', input.featureKey)
            .executeTakeFirst();
          return row ? mapSpamFeatureStatRow(row) : null;
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

function normalizeSpamListEntryMutation(
  values: SpamListEntryMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireListType: boolean;
    requirePatternType: boolean;
    requirePattern: boolean;
  },
): SpamListEntryMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Spam list entry mutation must include at least one field');
  }
  if (options.requireListType && normalized.listType === undefined) throw new Error('Spam list entry listType is required');
  if (options.requirePatternType && normalized.patternType === undefined) throw new Error('Spam list entry patternType is required');
  if (options.requirePattern && normalized.pattern === undefined) throw new Error('Spam list entry pattern is required');
  if (normalized.listType !== undefined && normalized.listType !== 'allow' && normalized.listType !== 'block') {
    throw new Error('Spam list entry listType must be allow or block');
  }
  if (normalized.patternType !== undefined && normalized.patternType !== 'email' && normalized.patternType !== 'domain') {
    throw new Error('Spam list entry patternType must be email or domain');
  }
  if (normalized.pattern !== undefined) {
    const pattern = normalized.pattern.trim();
    if (!pattern) throw new Error('Spam list entry pattern must not be empty');
    normalized.pattern = pattern;
  }
  if (normalized.note !== undefined && normalized.note !== null) {
    const note = normalized.note.trim();
    normalized.note = note === '' ? null : note;
  }
  if (
    normalized.accountId !== undefined
    && normalized.accountId !== null
    && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)
  ) {
    throw new Error('Spam list entry accountId must be a positive integer');
  }
  return normalized;
}

function mutationToSpamListEntryPatch(values: SpamListEntryMutationInput): Partial<Updateable<EmailSpamListEntriesTable>> {
  return {
    ...(values.listType === undefined ? {} : { list_type: values.listType }),
    ...(values.patternType === undefined ? {} : { pattern_type: values.patternType }),
    ...(values.pattern === undefined ? {} : { pattern: values.pattern }),
    ...(values.note === undefined ? {} : { note: values.note }),
  };
}

function normalizeSpamLearningEventMutation(values: SpamLearningEventMutationInput): SpamLearningEventMutationInput {
  const normalized = { ...values };
  if (!Number.isSafeInteger(normalized.accountId) || (normalized.accountId as number) <= 0) {
    throw new Error('Spam learning event accountId is required');
  }
  if (normalized.messageId !== undefined && normalized.messageId !== null) {
    if (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0) {
      throw new Error('Spam learning event messageId must be a positive integer');
    }
  }
  if (normalized.label !== 'spam' && normalized.label !== 'ham') {
    throw new Error('Spam learning event label must be spam or ham');
  }
  if (normalized.source !== undefined) {
    const source = normalized.source.trim();
    if (!source) throw new Error('Spam learning event source must not be empty');
    normalized.source = source;
  }
  if (normalized.featureKeys !== undefined && normalized.featureKeys !== null && !isJsonCompatible(normalized.featureKeys)) {
    throw new Error('Spam learning event featureKeys must be JSON-compatible');
  }
  return normalized;
}

function normalizeSpamDecisionMutation(
  values: SpamDecisionMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireAccountId: boolean;
    requireScore: boolean;
    requireStatus: boolean;
    requireSource: boolean;
  },
): SpamDecisionMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Spam decision mutation must include at least one field');
  }
  if (options.requireAccountId && normalized.accountId === undefined) throw new Error('Spam decision accountId is required');
  if (options.requireScore && normalized.score === undefined) throw new Error('Spam decision score is required');
  if (options.requireStatus && normalized.status === undefined) throw new Error('Spam decision status is required');
  if (options.requireSource && normalized.source === undefined) throw new Error('Spam decision source is required');

  if (normalized.accountId !== undefined && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)) {
    throw new Error('Spam decision accountId must be a positive integer');
  }
  if (normalized.messageId !== undefined && normalized.messageId !== null) {
    if (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0) {
      throw new Error('Spam decision messageId must be a positive integer');
    }
  }
  if (normalized.score !== undefined && (!Number.isSafeInteger(normalized.score) || normalized.score < 0 || normalized.score > 100)) {
    throw new Error('Spam decision score must be an integer between 0 and 100');
  }
  if (
    normalized.status !== undefined
    && normalized.status !== 'clean'
    && normalized.status !== 'review'
    && normalized.status !== 'spam'
  ) {
    throw new Error('Spam decision status must be clean, review, or spam');
  }
  if (normalized.source !== undefined) {
    const source = normalized.source.trim();
    if (!source) throw new Error('Spam decision source must not be empty');
    normalized.source = source;
  }
  if (normalized.breakdown !== undefined && normalized.breakdown !== null) {
    if ((!Array.isArray(normalized.breakdown) && !isPlainObject(normalized.breakdown)) || !isJsonCompatible(normalized.breakdown)) {
      throw new Error('Spam decision breakdown must be a JSON object, array, or null');
    }
  }
  if (normalized.modelVersion !== undefined && (!Number.isSafeInteger(normalized.modelVersion) || normalized.modelVersion <= 0)) {
    throw new Error('Spam decision modelVersion must be a positive integer');
  }
  if (normalized.modelVersion === undefined && options.requireSource) normalized.modelVersion = 1;
  return normalized;
}

function mutationToSpamDecisionPatch(values: SpamDecisionMutationInput): Partial<Updateable<EmailSpamDecisionsTable>> {
  return {
    ...(values.score === undefined ? {} : { score: values.score }),
    ...(values.status === undefined ? {} : { status: values.status }),
    ...(values.source === undefined ? {} : { source: values.source }),
    ...(values.breakdown === undefined ? {} : { breakdown_json: values.breakdown }),
    ...(values.modelVersion === undefined ? {} : { model_version: values.modelVersion }),
  };
}

async function resolveEmailAccountReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number,
): Promise<EmailAccountReference | null> {
  const row = await trx
    .selectFrom('email_accounts')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

async function resolveEmailMessageReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<EmailMessageReference | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id', 'account_id', 'account_source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    accountId: Number(row.account_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
  };
}

async function resolveSpamListEntryConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  values: {
    listType: 'allow' | 'block';
    patternType: 'email' | 'domain';
    pattern: string;
    accountId: number | null;
  },
  excludingId?: number,
): Promise<boolean> {
  let query = trx
    .selectFrom('email_spam_list_entries')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('list_type', '=', values.listType)
    .where('pattern_type', '=', values.patternType)
    .where('pattern', '=', values.pattern);
  query = values.accountId === null
    ? query.where('account_id', 'is', null)
    : query.where('account_id', '=', values.accountId);
  if (excludingId !== undefined) query = query.where('id', '<>', excludingId);
  return (await query.executeTakeFirst()) !== undefined;
}

function serverCreatedSpamListEntrySourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_spam_list_entries', 'id'))`;
}

function serverCreatedSpamLearningEventSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_spam_learning_events', 'id'))`;
}

function serverCreatedSpamDecisionSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_spam_decisions', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonCompatible(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonCompatible);
  }
  return false;
}

function mapSpamListEntryRow(
  row: Pick<SpamListEntryRow, typeof spamListEntrySelectColumns[number]>,
): SpamListEntryRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    listType: row.list_type,
    patternType: row.pattern_type,
    pattern: row.pattern,
    accountSourceSqliteId: row.account_source_sqlite_id === null ? null : Number(row.account_source_sqlite_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    note: row.note,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapSpamLearningEventRow(
  row: Pick<SpamLearningEventRow, typeof spamLearningEventSelectColumns[number]>,
): SpamLearningEventRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    messageSourceSqliteId: row.message_source_sqlite_id === null ? null : Number(row.message_source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    label: row.label,
    source: row.source,
    featureKeys: row.feature_keys_json,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapSpamDecisionRow(
  row: Pick<SpamDecisionRow, typeof spamDecisionSelectColumns[number]>,
): SpamDecisionRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: row.source_sqlite_id === null ? null : Number(row.source_sqlite_id),
    messageSourceSqliteId: row.message_source_sqlite_id === null ? null : Number(row.message_source_sqlite_id),
    accountSourceSqliteId: Number(row.account_source_sqlite_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    score: row.score,
    status: row.status,
    source: row.source,
    breakdown: row.breakdown_json,
    modelVersion: row.model_version,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapSpamFeatureStatRow(
  row: Pick<SpamFeatureStatRow, typeof spamFeatureStatSelectColumns[number]>,
): SpamFeatureStatRecord {
  return {
    featureKey: row.feature_key,
    spamCount: row.spam_count,
    hamCount: row.ham_count,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
