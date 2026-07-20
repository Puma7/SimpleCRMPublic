import { sql as kyselySql, type Kysely, type RawBuilder, type Selectable, type Updateable } from 'kysely';

import type {
  WorkflowDelayedJobApiPort,
  WorkflowDelayedJobListResult,
  WorkflowDelayedJobMutationInput,
  WorkflowDelayedJobMutationPortResult,
  WorkflowDelayedJobRecord,
  WorkflowForwardDedupApiPort,
  WorkflowForwardDedupListResult,
  WorkflowForwardDedupRecord,
  WorkflowKnowledgeBaseApiPort,
  WorkflowKnowledgeBaseListResult,
  WorkflowKnowledgeBaseMutationInput,
  WorkflowKnowledgeBaseRecord,
  WorkflowKnowledgeChunkApiPort,
  WorkflowKnowledgeChunkListResult,
  WorkflowKnowledgeChunkMutationInput,
  WorkflowKnowledgeChunkMutationPortResult,
  WorkflowKnowledgeChunkRecord,
  WorkflowMessageAppliedApiPort,
  WorkflowMessageAppliedListResult,
  WorkflowMessageAppliedRecord,
  WorkflowRunApiPort,
  WorkflowRunListResult,
  WorkflowRunRecord,
  WorkflowRunStepApiPort,
  WorkflowRunStepListResult,
  WorkflowRunStepRecord,
  WorkflowVersionApiPort,
  WorkflowVersionListResult,
  WorkflowVersionMutationInput,
  WorkflowVersionMutationPortResult,
  WorkflowVersionRecord,
} from '../api/types';
import type {
  EmailMessageWorkflowAppliedTable,
  EmailWorkflowForwardDedupTable,
  EmailWorkflowRunsTable,
  EmailWorkflowRunStepsTable,
  EmailWorkflowVersionsTable,
  ServerDatabase,
  WorkflowDelayedJobsTable,
  WorkflowKnowledgeBasesTable,
  WorkflowKnowledgeChunksTable,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';
import {
  resolveEmailAccountReference,
  type EmailAccountReference,
} from './resolve-email-account-reference';
import type { MailSqlScope } from '../mail-access/types';

export type PostgresWorkflowRuntimeReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type WorkflowVersionRow = Selectable<EmailWorkflowVersionsTable>;
type WorkflowReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type EmailMessageReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type WorkflowRunRow = Selectable<EmailWorkflowRunsTable>;
type WorkflowRunStepRow = Selectable<EmailWorkflowRunStepsTable>;
type WorkflowMessageAppliedRow = Selectable<EmailMessageWorkflowAppliedTable>;
type WorkflowForwardDedupRow = Selectable<EmailWorkflowForwardDedupTable>;
type WorkflowKnowledgeBaseRow = Selectable<WorkflowKnowledgeBasesTable>;
type WorkflowKnowledgeBaseReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type WorkflowKnowledgeChunkRow = Selectable<WorkflowKnowledgeChunksTable>;
type WorkflowDelayedJobRow = Selectable<WorkflowDelayedJobsTable>;

const workflowVersionSelectColumns = [
  'id',
  'source_sqlite_id',
  'workflow_source_sqlite_id',
  'workflow_id',
  'label',
  'graph_json',
  'definition_json',
  'created_at',
  'updated_at',
] as const;

const workflowRunSummaryColumns = [
  'id',
  'source_sqlite_id',
  'workflow_source_sqlite_id',
  'message_source_sqlite_id',
  'workflow_id',
  'message_id',
  'direction',
  'status',
  'started_at',
  'finished_at',
  'updated_at',
] as const;

const workflowRunDetailColumns = [
  ...workflowRunSummaryColumns,
  'log_json',
] as const;

const workflowRunStepSummaryColumns = [
  'id',
  'source_sqlite_id',
  'run_source_sqlite_id',
  'run_id',
  'node_id',
  'node_type',
  'status',
  'port',
  'duration_ms',
  'message',
  'created_at',
  'updated_at',
] as const;

const workflowRunStepDetailColumns = [
  ...workflowRunStepSummaryColumns,
  'detail_json',
] as const;

const workflowMessageAppliedSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'workflow_source_sqlite_id',
  'message_id',
  'workflow_id',
  'applied_at',
  'updated_at',
] as const;

const workflowForwardDedupSelectColumns = [
  'id',
  'source_sqlite_id',
  'message_source_sqlite_id',
  'workflow_source_sqlite_id',
  'message_id',
  'workflow_id',
  'dest',
  'created_at',
  'updated_at',
] as const;

const workflowKnowledgeBaseSelectColumns = [
  'id',
  'source_sqlite_id',
  'name',
  'description',
  'account_source_sqlite_id',
  'account_id',
  'override_key',
  'knowledge_context',
  'created_at',
  'updated_at',
] as const;

const workflowKnowledgeChunkSummaryColumns = [
  'id',
  'source_sqlite_id',
  'knowledge_base_source_sqlite_id',
  'knowledge_base_id',
  'title',
  'source_path',
  'embedding_json',
  'created_at',
  'updated_at',
] as const;

const workflowKnowledgeChunkDetailColumns = [
  ...workflowKnowledgeChunkSummaryColumns,
  'content',
] as const;

const workflowDelayedJobSummaryColumns = [
  'id',
  'source_sqlite_id',
  'workflow_source_sqlite_id',
  'message_source_sqlite_id',
  'workflow_id',
  'message_id',
  'resume_node_id',
  'execute_at',
  'status',
  'created_at',
  'updated_at',
] as const;

const workflowDelayedJobDetailColumns = [
  ...workflowDelayedJobSummaryColumns,
  'context_json',
] as const;

type WorkflowRunApiRow =
  & Pick<WorkflowRunRow, typeof workflowRunSummaryColumns[number]>
  & Partial<Pick<WorkflowRunRow, 'log_json'>>;

type WorkflowRunStepApiRow =
  & Pick<WorkflowRunStepRow, typeof workflowRunStepSummaryColumns[number]>
  & Partial<Pick<WorkflowRunStepRow, 'detail_json'>>;

type WorkflowKnowledgeChunkApiRow =
  & Pick<WorkflowKnowledgeChunkRow, typeof workflowKnowledgeChunkSummaryColumns[number]>
  & Partial<Pick<WorkflowKnowledgeChunkRow, 'content'>>;

type WorkflowDelayedJobApiRow =
  & Pick<WorkflowDelayedJobRow, typeof workflowDelayedJobSummaryColumns[number]>
  & Partial<Pick<WorkflowDelayedJobRow, 'context_json'>>;

export function createPostgresWorkflowVersionReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowVersionApiPort {
  return {
    async list(input): Promise<WorkflowVersionListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow version');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_versions')
            .select(workflowVersionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.workflowId !== undefined) query = query.where('workflow_id', '=', input.workflowId);
          const search = input.search?.trim();
          if (search) query = query.where('label', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapWorkflowVersionRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowVersionRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('email_workflow_versions')
            .select(workflowVersionSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapWorkflowVersionRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<WorkflowVersionMutationPortResult> {
      const values = normalizeWorkflowVersionMutation(input.values, {
        requireAtLeastOneField: true,
        requireWorkflowId: true,
        requireLabel: true,
        requireGraph: true,
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
          const workflow = await resolveWorkflowReference(trx, input.workspaceId, values.workflowId as number);
          if (!workflow) return { ok: false, code: 'workflow_not_found' };

          const now = new Date();
          const row = await trx
            .insertInto('email_workflow_versions')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedWorkflowVersionSourceSqliteId(),
              workflow_source_sqlite_id: workflow.sourceSqliteId,
              workflow_id: workflow.id,
              label: values.label as string,
              graph_json: values.graph,
              definition_json: values.definition,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(workflowVersionSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, version: mapWorkflowVersionRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<WorkflowVersionMutationPortResult | null> {
      const values = normalizeWorkflowVersionMutation(input.values, {
        requireAtLeastOneField: true,
        requireWorkflowId: false,
        requireLabel: false,
        requireGraph: false,
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
            .selectFrom('email_workflow_versions')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const workflow = values.workflowId === undefined
            ? undefined
            : await resolveWorkflowReference(trx, input.workspaceId, values.workflowId);
          if (values.workflowId !== undefined && !workflow) return { ok: false, code: 'workflow_not_found' };

          const row = await trx
            .updateTable('email_workflow_versions')
            .set({
              ...mutationToWorkflowVersionPatch(values, workflow ?? undefined),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowVersionSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, version: mapWorkflowVersionRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<WorkflowVersionRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('email_workflow_versions')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowVersionSelectColumns)
            .executeTakeFirst();
          return row ? mapWorkflowVersionRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowRunReadPort(options: PostgresWorkflowRuntimeReadPortOptions): WorkflowRunApiPort {
  return {
    async list(input): Promise<WorkflowRunListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow run');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_runs')
            .select(input.includeLog ? workflowRunDetailColumns : workflowRunSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.workflowId !== undefined) query = query.where('workflow_id', '=', input.workflowId);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.direction !== undefined) query = query.where('direction', '=', input.direction);
          if (input.status !== undefined) query = query.where('status', '=', input.status);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_workflow_runs.message_id');
          if (visibility) query = query.where(visibility);

          const rows = await query.execute();
          return pageNumeric(
            rows,
            limit,
            (row) => Number(row.id),
            (row) => mapWorkflowRunRow(row, input.includeLog),
          );
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowRunRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_runs')
            .select(input.includeLog ? workflowRunDetailColumns : workflowRunSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_workflow_runs.message_id');
          if (visibility) query = query.where(visibility);
          const row = await query.executeTakeFirst();
          return row ? mapWorkflowRunRow(row, input.includeLog) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowRunStepReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowRunStepApiPort {
  return {
    async list(input): Promise<WorkflowRunStepListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow run step');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_run_steps')
            .select(input.includeDetail ? workflowRunStepDetailColumns : workflowRunStepSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.runId !== undefined) query = query.where('run_id', '=', input.runId);
          if (input.nodeId !== undefined) query = query.where('node_id', '=', input.nodeId);
          if (input.nodeType !== undefined) query = query.where('node_type', '=', input.nodeType);
          if (input.status !== undefined) query = query.where('status', '=', input.status);
          const visibility = workflowRunStepVisibilityPredicate(input.mailScope, input.workspaceId);
          if (visibility) query = query.where(visibility);

          const rows = await query.execute();
          return pageNumeric(
            rows,
            limit,
            (row) => Number(row.id),
            (row) => mapWorkflowRunStepRow(row, input.includeDetail),
          );
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowRunStepRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_run_steps')
            .select(input.includeDetail ? workflowRunStepDetailColumns : workflowRunStepSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowRunStepVisibilityPredicate(input.mailScope, input.workspaceId);
          if (visibility) query = query.where(visibility);
          const row = await query.executeTakeFirst();
          return row ? mapWorkflowRunStepRow(row, input.includeDetail) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowMessageAppliedReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowMessageAppliedApiPort {
  return {
    async list(input): Promise<WorkflowMessageAppliedListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow message-applied');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_message_workflow_applied')
            .select(workflowMessageAppliedSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.workflowId !== undefined) query = query.where('workflow_id', '=', input.workflowId);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_message_workflow_applied.message_id');
          if (visibility) query = query.where(visibility);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapWorkflowMessageAppliedRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowMessageAppliedRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_message_workflow_applied')
            .select(workflowMessageAppliedSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_message_workflow_applied.message_id');
          if (visibility) query = query.where(visibility);
          const row = await query.executeTakeFirst();
          return row ? mapWorkflowMessageAppliedRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowForwardDedupReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowForwardDedupApiPort {
  return {
    async list(input): Promise<WorkflowForwardDedupListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow forward-dedup');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_forward_dedup')
            .select(workflowForwardDedupSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.workflowId !== undefined) query = query.where('workflow_id', '=', input.workflowId);
          if (input.dest !== undefined) query = query.where('dest', '=', input.dest);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_workflow_forward_dedup.message_id');
          if (visibility) query = query.where(visibility);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapWorkflowForwardDedupRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowForwardDedupRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_workflow_forward_dedup')
            .select(workflowForwardDedupSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'email_workflow_forward_dedup.message_id');
          if (visibility) query = query.where(visibility);
          const row = await query.executeTakeFirst();
          return row ? mapWorkflowForwardDedupRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowKnowledgeBaseReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowKnowledgeBaseApiPort {
  return {
    async list(input): Promise<WorkflowKnowledgeBaseListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow knowledge base');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('workflow_knowledge_bases')
            .select(workflowKnowledgeBaseSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
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
              eb('name', 'ilike', pattern),
              eb('description', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapWorkflowKnowledgeBaseRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowKnowledgeBaseRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('workflow_knowledge_bases')
            .select(workflowKnowledgeBaseSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapWorkflowKnowledgeBaseRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<WorkflowKnowledgeBaseRecord> {
      const values = normalizeKnowledgeBaseMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = values.accountId == null
            ? null
            : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            throw new Error('Workflow knowledge base accountId not found');
          }
          const now = new Date();
          const row = await trx
            .insertInto('workflow_knowledge_bases')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedKnowledgeBaseSourceSqliteId(),
              name: values.name as string,
              description: values.description ?? null,
              account_source_sqlite_id: account?.sourceSqliteId ?? null,
              account_id: account?.id ?? null,
              override_key: values.overrideKey ?? (values.knowledgeContext ? `kb.${values.knowledgeContext}` : null),
              knowledge_context: values.knowledgeContext ?? null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(workflowKnowledgeBaseSelectColumns)
            .executeTakeFirstOrThrow();
          return mapWorkflowKnowledgeBaseRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<WorkflowKnowledgeBaseRecord | null> {
      const values = normalizeKnowledgeBaseMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const account = values.accountId === undefined
            ? undefined
            : values.accountId === null
              ? null
              : await resolveEmailAccountReference(trx, input.workspaceId, values.accountId);
          if (values.accountId !== undefined && values.accountId !== null && !account) {
            throw new Error('Workflow knowledge base accountId not found');
          }
          const row = await trx
            .updateTable('workflow_knowledge_bases')
            .set({
              ...mutationToKnowledgeBasePatch(values, account),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowKnowledgeBaseSelectColumns)
            .executeTakeFirst();
          return row ? mapWorkflowKnowledgeBaseRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<WorkflowKnowledgeBaseRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('workflow_knowledge_bases')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowKnowledgeBaseSelectColumns)
            .executeTakeFirst();
          return row ? mapWorkflowKnowledgeBaseRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowKnowledgeChunkReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowKnowledgeChunkApiPort {
  return {
    async list(input): Promise<WorkflowKnowledgeChunkListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow knowledge chunk');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('workflow_knowledge_chunks')
            .select(input.includeContent ? workflowKnowledgeChunkDetailColumns : workflowKnowledgeChunkSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.knowledgeBaseId !== undefined) query = query.where('knowledge_base_id', '=', input.knowledgeBaseId);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('title', 'ilike', pattern),
              eb('content', 'ilike', pattern),
              eb('source_path', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(
            rows,
            limit,
            (row) => Number(row.id),
            (row) => mapWorkflowKnowledgeChunkRow(row, input.includeContent),
          );
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowKnowledgeChunkRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('workflow_knowledge_chunks')
            .select(input.includeContent ? workflowKnowledgeChunkDetailColumns : workflowKnowledgeChunkSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapWorkflowKnowledgeChunkRow(row, input.includeContent) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<WorkflowKnowledgeChunkMutationPortResult> {
      const values = normalizeKnowledgeChunkMutation(input.values, {
        requireAtLeastOneField: true,
        requireKnowledgeBaseId: true,
        requireContent: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const knowledgeBase = await resolveKnowledgeBaseReference(trx, input.workspaceId, values.knowledgeBaseId as number);
          if (!knowledgeBase) return { ok: false, code: 'knowledge_base_not_found' };

          const now = new Date();
          const row = await trx
            .insertInto('workflow_knowledge_chunks')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedKnowledgeChunkSourceSqliteId(),
              knowledge_base_source_sqlite_id: knowledgeBase.sourceSqliteId,
              knowledge_base_id: knowledgeBase.id,
              title: values.title ?? null,
              content: values.content as string,
              source_path: values.sourcePath ?? null,
              embedding_json: null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(workflowKnowledgeChunkDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, chunk: mapWorkflowKnowledgeChunkRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<WorkflowKnowledgeChunkMutationPortResult | null> {
      const values = normalizeKnowledgeChunkMutation(input.values, {
        requireAtLeastOneField: true,
        requireKnowledgeBaseId: false,
        requireContent: false,
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
            .selectFrom('workflow_knowledge_chunks')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          const knowledgeBase = values.knowledgeBaseId === undefined
            ? undefined
            : await resolveKnowledgeBaseReference(trx, input.workspaceId, values.knowledgeBaseId);
          if (values.knowledgeBaseId !== undefined && !knowledgeBase) {
            return { ok: false, code: 'knowledge_base_not_found' };
          }

          const row = await trx
            .updateTable('workflow_knowledge_chunks')
            .set({
              ...mutationToKnowledgeChunkPatch(values, knowledgeBase ?? undefined),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowKnowledgeChunkDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, chunk: mapWorkflowKnowledgeChunkRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<WorkflowKnowledgeChunkRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('workflow_knowledge_chunks')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(workflowKnowledgeChunkSummaryColumns)
            .executeTakeFirst();
          return row ? mapWorkflowKnowledgeChunkRow(row, false) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresWorkflowDelayedJobReadPort(
  options: PostgresWorkflowRuntimeReadPortOptions,
): WorkflowDelayedJobApiPort {
  return {
    async list(input): Promise<WorkflowDelayedJobListResult> {
      const limit = normalizeLimit(input.limit, 'Workflow delayed job');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('workflow_delayed_jobs')
            .select(input.includeContext ? workflowDelayedJobDetailColumns : workflowDelayedJobSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.workflowId !== undefined) query = query.where('workflow_id', '=', input.workflowId);
          if (input.messageId !== undefined) query = query.where('message_id', '=', input.messageId);
          if (input.status !== undefined) query = query.where('status', '=', input.status);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'workflow_delayed_jobs.message_id');
          if (visibility) query = query.where(visibility);

          const rows = await query.execute();
          return pageNumeric(
            rows,
            limit,
            (row) => Number(row.id),
            (row) => mapWorkflowDelayedJobRow(row, input.includeContext),
          );
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<WorkflowDelayedJobRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('workflow_delayed_jobs')
            .select(input.includeContext ? workflowDelayedJobDetailColumns : workflowDelayedJobSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowMessageVisibilityPredicate(input.mailScope, input.workspaceId, 'workflow_delayed_jobs.message_id');
          if (visibility) query = query.where(visibility);
          const row = await query.executeTakeFirst();
          return row ? mapWorkflowDelayedJobRow(row, input.includeContext) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<WorkflowDelayedJobMutationPortResult> {
      const values = normalizeWorkflowDelayedJobMutation(input.values, {
        requireAtLeastOneField: true,
        requireWorkflowId: true,
        requireExecuteAt: true,
        requireStatus: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const workflow = await resolveWorkflowReference(trx, input.workspaceId, values.workflowId as number);
          if (!workflow) return { ok: false, code: 'workflow_not_found' };

          const message = values.messageId === undefined || values.messageId === null
            ? null
            : await resolveEmailMessageReference(trx, input.workspaceId, values.messageId, input.mailScope);
          if (values.messageId !== undefined && values.messageId !== null && !message) {
            return { ok: false, code: 'message_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('workflow_delayed_jobs')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedWorkflowDelayedJobSourceSqliteId(),
              workflow_source_sqlite_id: workflow.sourceSqliteId,
              message_source_sqlite_id: message?.sourceSqliteId ?? null,
              workflow_id: workflow.id,
              message_id: message?.id ?? null,
              resume_node_id: values.resumeNodeId ?? null,
              execute_at: values.executeAt as string,
              context_json: values.context ?? null,
              status: values.status as string,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(workflowDelayedJobDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, job: mapWorkflowDelayedJobRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<WorkflowDelayedJobMutationPortResult | null> {
      const values = normalizeWorkflowDelayedJobMutation(input.values, {
        requireAtLeastOneField: true,
        requireWorkflowId: false,
        requireExecuteAt: false,
        requireStatus: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          let currentQuery = trx
            .selectFrom('workflow_delayed_jobs')
            .select(['id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const currentVisibility = workflowMessageVisibilityPredicate(
            input.mailScope,
            input.workspaceId,
            'workflow_delayed_jobs.message_id',
          );
          if (currentVisibility) currentQuery = currentQuery.where(currentVisibility);
          const current = await currentQuery.forUpdate().executeTakeFirst();
          if (!current) return null;

          const workflow = values.workflowId === undefined
            ? undefined
            : await resolveWorkflowReference(trx, input.workspaceId, values.workflowId);
          if (values.workflowId !== undefined && !workflow) return { ok: false, code: 'workflow_not_found' };

          const message = values.messageId === undefined || values.messageId === null
            ? values.messageId === null ? null : undefined
            : await resolveEmailMessageReference(trx, input.workspaceId, values.messageId, input.mailScope);
          if (values.messageId !== undefined && values.messageId !== null && !message) {
            return { ok: false, code: 'message_not_found' };
          }

          let updateQuery = trx
            .updateTable('workflow_delayed_jobs')
            .set({
              ...mutationToWorkflowDelayedJobPatch(values, workflow ?? undefined, message),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          if (currentVisibility) updateQuery = updateQuery.where(currentVisibility);
          const row = await updateQuery
            .returning(workflowDelayedJobDetailColumns)
            .executeTakeFirst();
          if (!row) return null;
          return { ok: true, job: mapWorkflowDelayedJobRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<WorkflowDelayedJobRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          let query = trx
            .deleteFrom('workflow_delayed_jobs')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id);
          const visibility = workflowMessageVisibilityPredicate(
            input.mailScope,
            input.workspaceId,
            'workflow_delayed_jobs.message_id',
          );
          if (visibility) query = query.where(visibility);
          const row = await query.returning(workflowDelayedJobSummaryColumns).executeTakeFirst();
          return row ? mapWorkflowDelayedJobRow(row, false) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function pageNumeric<TRow, TRecord>(
  rows: readonly TRow[],
  limit: number,
  cursorValue: (row: TRow) => number,
  map: (row: TRow) => TRecord,
): { items: readonly TRecord[]; nextCursor: number | null } {
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map(map),
    nextCursor: rows.length > limit ? cursorValue(pageRows[pageRows.length - 1] as TRow) : null,
  };
}

function workflowMessageVisibilityPredicate(
  scope: MailSqlScope | undefined,
  workspaceId: string,
  messageColumn: string,
): RawBuilder<boolean> | undefined {
  if (!scope || scope.kind === 'all') return undefined;
  const messageRef = kyselySql.ref(messageColumn);
  if (scope.kind === 'none') return kyselySql<boolean>`${messageRef} is null`;

  const branches: RawBuilder<boolean>[] = [];
  if (scope.accountIds.length > 0) {
    branches.push(kyselySql<boolean>`workflow_scope_message.account_id in (${kyselySql.join(scope.accountIds)})`);
  }
  if (scope.folderIds.length > 0) {
    branches.push(kyselySql<boolean>`workflow_scope_message.folder_id in (${kyselySql.join(scope.folderIds)})`);
  }
  if (scope.messageIds.length > 0) {
    branches.push(kyselySql<boolean>`workflow_scope_message.id in (${kyselySql.join(scope.messageIds)})`);
  }
  if (branches.length === 0) return kyselySql<boolean>`${messageRef} is null`;

  return kyselySql<boolean>`(
    ${messageRef} is null
    or exists (
      select 1
      from email_messages as workflow_scope_message
      where workflow_scope_message.workspace_id = ${workspaceId}
        and workflow_scope_message.id = ${messageRef}
        and (${kyselySql.join(branches, kyselySql` or `)})
    )
  )`;
}

function workflowRunStepVisibilityPredicate(
  scope: MailSqlScope | undefined,
  workspaceId: string,
): RawBuilder<boolean> | undefined {
  if (!scope || scope.kind === 'all') return undefined;
  const runBranches = scope.kind === 'none'
    ? kyselySql<boolean>`workflow_scope_run.message_id is null`
    : workflowRunStepRestrictedPredicate(scope, workspaceId);

  return kyselySql<boolean>`(
    email_workflow_run_steps.run_id is null
    or exists (
      select 1
      from email_workflow_runs as workflow_scope_run
      where workflow_scope_run.workspace_id = ${workspaceId}
        and workflow_scope_run.id = email_workflow_run_steps.run_id
        and ${runBranches}
    )
  )`;
}

function workflowRunStepRestrictedPredicate(
  scope: Extract<MailSqlScope, { kind: 'restricted' }>,
  workspaceId: string,
): RawBuilder<boolean> {
  const messageVisibility = workflowMessageVisibilityPredicate(scope, workspaceId, 'workflow_scope_run.message_id');
  return messageVisibility ?? kyselySql<boolean>`true`;
}

function normalizeLimit(limit: number, label: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${label} list limit must be between 1 and 100`);
  }
  return limit;
}

function normalizeWorkflowVersionMutation(
  values: WorkflowVersionMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireWorkflowId: boolean;
    requireLabel: boolean;
    requireGraph: boolean;
    requireDefinition: boolean;
  },
): WorkflowVersionMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Workflow version mutation must include at least one field');
  }
  if (options.requireWorkflowId && normalized.workflowId === undefined) {
    throw new Error('Workflow version workflowId is required');
  }
  if (options.requireLabel && normalized.label === undefined) throw new Error('Workflow version label is required');
  if (options.requireGraph && normalized.graph === undefined) throw new Error('Workflow version graph is required');
  if (options.requireDefinition && normalized.definition === undefined) {
    throw new Error('Workflow version definition is required');
  }
  if (
    normalized.workflowId !== undefined
    && (!Number.isSafeInteger(normalized.workflowId) || normalized.workflowId <= 0)
  ) {
    throw new Error('Workflow version workflowId must be a positive integer');
  }
  if (normalized.label !== undefined) {
    const label = normalized.label.trim();
    if (!label) throw new Error('Workflow version label must not be empty');
    normalized.label = label;
  }
  if (normalized.graph !== undefined) assertJsonObjectLike(normalized.graph, 'Workflow version graph');
  if (normalized.definition !== undefined) {
    assertJsonObjectLike(normalized.definition, 'Workflow version definition');
  }
  return normalized;
}

function normalizeKnowledgeBaseMutation(
  values: WorkflowKnowledgeBaseMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
  },
): WorkflowKnowledgeBaseMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Workflow knowledge base mutation must include at least one field');
  }
  if (options.requireName && normalized.name === undefined) {
    throw new Error('Workflow knowledge base name is required');
  }
  if (normalized.name !== undefined) {
    const name = normalized.name.trim();
    if (!name) throw new Error('Workflow knowledge base name must not be empty');
    normalized.name = name;
  }
  if (normalized.description !== undefined && normalized.description !== null) {
    const description = normalized.description.trim();
    if (!description) throw new Error('Workflow knowledge base description must not be empty');
    normalized.description = description;
  }
  if (
    normalized.accountId !== undefined
    && normalized.accountId !== null
    && (!Number.isSafeInteger(normalized.accountId) || normalized.accountId <= 0)
  ) {
    throw new Error('Workflow knowledge base accountId must be a positive integer');
  }
  if (normalized.overrideKey !== undefined && normalized.overrideKey !== null) {
    const value = normalized.overrideKey.trim();
    normalized.overrideKey = value || null;
  }
  if (normalized.knowledgeContext !== undefined && normalized.knowledgeContext !== null) {
    const value = String(normalized.knowledgeContext).trim();
    normalized.knowledgeContext = value || null;
  }
  return normalized;
}

function mutationToKnowledgeBasePatch(
  values: WorkflowKnowledgeBaseMutationInput,
  account: EmailAccountReference | null | undefined,
): Partial<Updateable<WorkflowKnowledgeBasesTable>> {
  const patch: Partial<Updateable<WorkflowKnowledgeBasesTable>> = {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.accountId === undefined ? {} : {
      account_id: account?.id ?? null,
      account_source_sqlite_id: account?.sourceSqliteId ?? null,
    }),
    ...(values.overrideKey === undefined ? {} : { override_key: values.overrideKey }),
    ...(values.knowledgeContext === undefined ? {} : { knowledge_context: values.knowledgeContext }),
  };
  // Match Electron updateKnowledgeBase: context-only patches refresh kb.<ctx> override_key.
  if (values.knowledgeContext !== undefined && values.overrideKey === undefined) {
    patch.override_key = values.knowledgeContext ? `kb.${values.knowledgeContext}` : null;
  }
  return patch;
}

function normalizeKnowledgeChunkMutation(
  values: WorkflowKnowledgeChunkMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireKnowledgeBaseId: boolean;
    requireContent: boolean;
  },
): WorkflowKnowledgeChunkMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Workflow knowledge chunk mutation must include at least one field');
  }
  if (options.requireKnowledgeBaseId && normalized.knowledgeBaseId === undefined) {
    throw new Error('Workflow knowledge chunk knowledgeBaseId is required');
  }
  if (options.requireContent && normalized.content === undefined) {
    throw new Error('Workflow knowledge chunk content is required');
  }
  if (normalized.knowledgeBaseId !== undefined && (!Number.isSafeInteger(normalized.knowledgeBaseId) || normalized.knowledgeBaseId <= 0)) {
    throw new Error('Workflow knowledge chunk knowledgeBaseId must be a positive integer');
  }
  if (normalized.title !== undefined && normalized.title !== null) {
    const title = normalized.title.trim();
    if (!title) throw new Error('Workflow knowledge chunk title must not be empty');
    normalized.title = title;
  }
  if (normalized.content !== undefined) {
    const content = normalized.content.trim();
    if (!content) throw new Error('Workflow knowledge chunk content must not be empty');
    normalized.content = content;
  }
  if (normalized.sourcePath !== undefined && normalized.sourcePath !== null) {
    const sourcePath = normalized.sourcePath.trim();
    if (!sourcePath) throw new Error('Workflow knowledge chunk sourcePath must not be empty');
    normalized.sourcePath = sourcePath;
  }
  return normalized;
}

function mutationToKnowledgeChunkPatch(
  values: WorkflowKnowledgeChunkMutationInput,
  knowledgeBase: WorkflowKnowledgeBaseReference | undefined,
): Partial<Updateable<WorkflowKnowledgeChunksTable>> {
  return {
    ...(values.knowledgeBaseId === undefined || knowledgeBase === undefined ? {} : {
      knowledge_base_id: knowledgeBase.id,
      knowledge_base_source_sqlite_id: knowledgeBase.sourceSqliteId,
    }),
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.content === undefined ? {} : { content: values.content }),
    ...(values.sourcePath === undefined ? {} : { source_path: values.sourcePath }),
    ...(values.content === undefined ? {} : { embedding_json: null }),
  };
}

function normalizeWorkflowDelayedJobMutation(
  values: WorkflowDelayedJobMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireWorkflowId: boolean;
    requireExecuteAt: boolean;
    requireStatus: boolean;
  },
): WorkflowDelayedJobMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('Workflow delayed job mutation must include at least one field');
  }
  if (options.requireWorkflowId && normalized.workflowId === undefined) {
    throw new Error('Workflow delayed job workflowId is required');
  }
  if (options.requireExecuteAt && normalized.executeAt === undefined) {
    throw new Error('Workflow delayed job executeAt is required');
  }
  if (options.requireStatus && normalized.status === undefined) {
    throw new Error('Workflow delayed job status is required');
  }
  if (normalized.workflowId !== undefined && (!Number.isSafeInteger(normalized.workflowId) || normalized.workflowId <= 0)) {
    throw new Error('Workflow delayed job workflowId must be a positive integer');
  }
  if (normalized.messageId !== undefined && normalized.messageId !== null && (!Number.isSafeInteger(normalized.messageId) || normalized.messageId <= 0)) {
    throw new Error('Workflow delayed job messageId must be a positive integer or null');
  }
  if (normalized.resumeNodeId !== undefined && normalized.resumeNodeId !== null) {
    const resumeNodeId = normalized.resumeNodeId.trim();
    if (!resumeNodeId) throw new Error('Workflow delayed job resumeNodeId must not be empty');
    normalized.resumeNodeId = resumeNodeId;
  }
  if (normalized.executeAt !== undefined) {
    const date = new Date(normalized.executeAt);
    if (Number.isNaN(date.getTime())) throw new Error('Workflow delayed job executeAt must be a valid date');
    normalized.executeAt = date.toISOString();
  }
  if (normalized.context !== undefined && normalized.context !== null) {
    assertJsonObjectLike(normalized.context, 'Workflow delayed job context');
  }
  if (normalized.status !== undefined) {
    const status = normalized.status.trim();
    if (!status) throw new Error('Workflow delayed job status must not be empty');
    normalized.status = status;
  }
  return normalized;
}

function mutationToWorkflowDelayedJobPatch(
  values: WorkflowDelayedJobMutationInput,
  workflow: WorkflowReference | undefined,
  message: EmailMessageReference | null | undefined,
): Partial<Updateable<WorkflowDelayedJobsTable>> {
  return {
    ...(values.workflowId === undefined || workflow === undefined ? {} : {
      workflow_id: workflow.id,
      workflow_source_sqlite_id: workflow.sourceSqliteId,
    }),
    ...(values.messageId === undefined ? {} : {
      message_id: message?.id ?? null,
      message_source_sqlite_id: message?.sourceSqliteId ?? null,
    }),
    ...(values.resumeNodeId === undefined ? {} : { resume_node_id: values.resumeNodeId }),
    ...(values.executeAt === undefined ? {} : { execute_at: values.executeAt }),
    ...(values.context === undefined ? {} : { context_json: values.context }),
    ...(values.status === undefined ? {} : { status: values.status }),
  };
}

function mutationToWorkflowVersionPatch(
  values: WorkflowVersionMutationInput,
  workflow: WorkflowReference | undefined,
): Partial<Updateable<EmailWorkflowVersionsTable>> {
  return {
    ...(values.workflowId === undefined || workflow === undefined ? {} : {
      workflow_id: workflow.id,
      workflow_source_sqlite_id: workflow.sourceSqliteId,
    }),
    ...(values.label === undefined ? {} : { label: values.label }),
    ...(values.graph === undefined ? {} : { graph_json: values.graph }),
    ...(values.definition === undefined ? {} : { definition_json: values.definition }),
  };
}

async function resolveWorkflowReference(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  workflowId: number,
): Promise<WorkflowReference | null> {
  const row = await trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', workflowId)
    .executeTakeFirst();
  if (!row) return null;
  const id = Number(row.id);
  return {
    id,
    sourceSqliteId: row.source_sqlite_id === null ? -id : Number(row.source_sqlite_id),
  };
}

async function resolveKnowledgeBaseReference(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  knowledgeBaseId: number,
): Promise<WorkflowKnowledgeBaseReference | null> {
  const row = await trx
    .selectFrom('workflow_knowledge_bases')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', knowledgeBaseId)
    .executeTakeFirst();
  if (!row) return null;
  const id = Number(row.id);
  return {
    id,
    sourceSqliteId: row.source_sqlite_id === null ? -id : Number(row.source_sqlite_id),
  };
}

async function resolveEmailMessageReference(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  messageId: number,
  mailScope?: MailSqlScope,
): Promise<EmailMessageReference | null> {
  let query = trx
    .selectFrom('email_messages')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId);
  const visibility = emailMessageVisibilityPredicate(mailScope);
  if (visibility) query = query.where(visibility);
  const row = await query.executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

function emailMessageVisibilityPredicate(scope: MailSqlScope | undefined): RawBuilder<boolean> | undefined {
  if (!scope || scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return kyselySql<boolean>`false`;
  const branches: RawBuilder<boolean>[] = [];
  if (scope.accountIds.length > 0) {
    branches.push(kyselySql<boolean>`email_messages.account_id in (${kyselySql.join(scope.accountIds)})`);
  }
  if (scope.folderIds.length > 0) {
    branches.push(kyselySql<boolean>`email_messages.folder_id in (${kyselySql.join(scope.folderIds)})`);
  }
  if (scope.messageIds.length > 0) {
    branches.push(kyselySql<boolean>`email_messages.id in (${kyselySql.join(scope.messageIds)})`);
  }
  return branches.length === 0
    ? kyselySql<boolean>`false`
    : kyselySql<boolean>`(${kyselySql.join(branches, kyselySql` or `)})`;
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

function serverCreatedWorkflowVersionSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('email_workflow_versions', 'id'))`;
}

function serverCreatedKnowledgeBaseSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('workflow_knowledge_bases', 'id'))`;
}

function serverCreatedKnowledgeChunkSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('workflow_knowledge_chunks', 'id'))`;
}

function serverCreatedWorkflowDelayedJobSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('workflow_delayed_jobs', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function mapWorkflowVersionRow(
  row: Pick<WorkflowVersionRow, typeof workflowVersionSelectColumns[number]>,
): WorkflowVersionRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    workflowId: nullableNumber(row.workflow_id),
    label: row.label,
    graph: row.graph_json,
    definition: row.definition_json,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowRunRow(row: WorkflowRunApiRow, includeLog: boolean): WorkflowRunRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    messageSourceSqliteId: nullableNumber(row.message_source_sqlite_id),
    workflowId: nullableNumber(row.workflow_id),
    messageId: nullableNumber(row.message_id),
    direction: row.direction,
    status: row.status,
    ...(includeLog ? { log: row.log_json } : {}),
    startedAt: timestampToIsoOrNull(row.started_at),
    finishedAt: timestampToIsoOrNull(row.finished_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowRunStepRow(row: WorkflowRunStepApiRow, includeDetail: boolean): WorkflowRunStepRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    runSourceSqliteId: Number(row.run_source_sqlite_id),
    runId: nullableNumber(row.run_id),
    nodeId: row.node_id,
    nodeType: row.node_type,
    status: row.status,
    port: row.port,
    durationMs: row.duration_ms,
    message: row.message,
    ...(includeDetail ? { detail: row.detail_json } : {}),
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowMessageAppliedRow(
  row: Pick<WorkflowMessageAppliedRow, typeof workflowMessageAppliedSelectColumns[number]>,
): WorkflowMessageAppliedRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    messageId: nullableNumber(row.message_id),
    workflowId: nullableNumber(row.workflow_id),
    appliedAt: timestampToIsoOrNull(row.applied_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowForwardDedupRow(
  row: Pick<WorkflowForwardDedupRow, typeof workflowForwardDedupSelectColumns[number]>,
): WorkflowForwardDedupRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    messageSourceSqliteId: Number(row.message_source_sqlite_id),
    workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    messageId: nullableNumber(row.message_id),
    workflowId: nullableNumber(row.workflow_id),
    dest: row.dest,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowKnowledgeBaseRow(
  row: Pick<WorkflowKnowledgeBaseRow, typeof workflowKnowledgeBaseSelectColumns[number]>,
): WorkflowKnowledgeBaseRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    name: row.name,
    description: row.description,
    accountSourceSqliteId: nullableNumber(row.account_source_sqlite_id),
    accountId: nullableNumber(row.account_id),
    overrideKey: row.override_key,
    knowledgeContext: row.knowledge_context,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowKnowledgeChunkRow(
  row: WorkflowKnowledgeChunkApiRow,
  includeContent: boolean,
): WorkflowKnowledgeChunkRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    knowledgeBaseSourceSqliteId: Number(row.knowledge_base_source_sqlite_id),
    knowledgeBaseId: nullableNumber(row.knowledge_base_id),
    title: row.title,
    ...(includeContent ? { content: row.content ?? '' } : {}),
    sourcePath: row.source_path,
    embeddingConfigured: row.embedding_json !== null && row.embedding_json !== undefined,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapWorkflowDelayedJobRow(
  row: WorkflowDelayedJobApiRow,
  includeContext: boolean,
): WorkflowDelayedJobRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: nullableNumber(row.source_sqlite_id),
    workflowSourceSqliteId: Number(row.workflow_source_sqlite_id),
    messageSourceSqliteId: nullableNumber(row.message_source_sqlite_id),
    workflowId: nullableNumber(row.workflow_id),
    messageId: nullableNumber(row.message_id),
    resumeNodeId: row.resume_node_id,
    executeAt: timestampToIso(row.execute_at),
    ...(includeContext ? { context: row.context_json } : {}),
    status: row.status,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
