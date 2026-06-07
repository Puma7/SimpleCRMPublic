import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';

import type {
  ActivityLogApiPort,
  ActivityLogListResult,
  ActivityLogMutationInput,
  ActivityLogMutationPortResult,
  ActivityLogRecord,
  CalendarEventApiPort,
  CalendarEventListResult,
  CalendarEventMutationInput,
  CalendarEventMutationPortResult,
  CalendarEventRecord,
  CustomerCustomFieldApiPort,
  CustomerCustomFieldListResult,
  CustomerCustomFieldMutationInput,
  CustomerCustomFieldMutationPortResult,
  CustomerCustomFieldRecord,
  CustomerCustomFieldValueApiPort,
  CustomerCustomFieldValueListResult,
  CustomerCustomFieldValueMutationInput,
  CustomerCustomFieldValueMutationPortResult,
  CustomerCustomFieldValueRecord,
  JtlReferenceApiPort,
  JtlReferenceListResult,
  JtlReferenceMutationInput,
  JtlReferenceRecord,
  SavedViewApiPort,
  SavedViewListResult,
  SavedViewMutationInput,
  SavedViewRecord,
} from '../api/types';
import type {
  ActivityLogTable,
  CalendarEventsTable,
  CustomerCustomFieldsTable,
  CustomerCustomFieldValuesTable,
  JtlReferenceTable,
  SavedViewsTable,
  ServerDatabase,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresExtendedCrmReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type ActivityLogRow = Selectable<ActivityLogTable>;
type CalendarEventRow = Selectable<CalendarEventsTable>;
type CustomerCustomFieldRow = Selectable<CustomerCustomFieldsTable>;
type CustomerCustomFieldValueRow = Selectable<CustomerCustomFieldValuesTable>;
type SavedViewRow = Selectable<SavedViewsTable>;
type JtlReferenceRow = Selectable<JtlReferenceTable>;
type JtlReferenceTableName = 'jtl_firmen' | 'jtl_warenlager' | 'jtl_zahlungsarten' | 'jtl_versandarten';
type TaskReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type CustomerReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type DealReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type CustomFieldReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;

const activityLogSummaryColumns = [
  'id',
  'source_sqlite_id',
  'customer_source_sqlite_id',
  'deal_source_sqlite_id',
  'task_source_sqlite_id',
  'customer_id',
  'deal_id',
  'task_id',
  'activity_type',
  'title',
  'description',
  'created_at',
  'updated_at',
] as const;

const activityLogDetailColumns = [
  ...activityLogSummaryColumns,
  'metadata',
] as const;

const calendarEventSelectColumns = [
  'id',
  'source_sqlite_id',
  'title',
  'description',
  'start_date',
  'end_date',
  'all_day',
  'color_code',
  'event_type',
  'recurrence_rule',
  'task_source_sqlite_id',
  'task_id',
  'created_at',
  'updated_at',
] as const;

const customFieldSelectColumns = [
  'id',
  'source_sqlite_id',
  'name',
  'label',
  'type',
  'required',
  'options',
  'default_value',
  'placeholder',
  'description',
  'display_order',
  'active',
  'created_at',
  'updated_at',
] as const;

const customFieldValueSelectColumns = [
  'id',
  'source_sqlite_id',
  'customer_source_sqlite_id',
  'field_source_sqlite_id',
  'customer_id',
  'field_id',
  'value',
  'created_at',
  'updated_at',
] as const;

const savedViewSelectColumns = [
  'id',
  'source_sqlite_id',
  'name',
  'filters',
  'display_order',
  'created_at',
  'updated_at',
] as const;

const jtlReferenceSelectColumns = [
  'source_sqlite_id',
  'name',
  'updated_at',
] as const;

type ActivityLogApiRow =
  & Pick<ActivityLogRow, typeof activityLogSummaryColumns[number]>
  & Partial<Pick<ActivityLogRow, 'metadata'>>;

export function createPostgresActivityLogReadPort(options: PostgresExtendedCrmReadPortOptions): ActivityLogApiPort {
  return {
    async list(input): Promise<ActivityLogListResult> {
      const limit = normalizeLimit(input.limit, 'activity log');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('activity_log')
            .select(input.includeMetadata ? activityLogDetailColumns : activityLogSummaryColumns)
            .where('workspace_id', '=', input.workspaceId);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.activityType !== undefined) query = query.where('activity_type', '=', input.activityType);
          if (input.activityTypes?.length) query = query.where('activity_type', 'in', input.activityTypes);
          if (input.customerId !== undefined) query = query.where('customer_id', '=', input.customerId);
          if (input.dealId !== undefined) query = query.where('deal_id', '=', input.dealId);
          if (input.taskId !== undefined) query = query.where('task_id', '=', input.taskId);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('title', 'ilike', pattern),
              eb('description', 'ilike', pattern),
              eb('activity_type', 'ilike', pattern),
            ]));
          }
          if (input.sort === 'createdAtDesc') {
            query = query.orderBy('created_at', 'desc').orderBy('id', 'desc');
          } else {
            query = query.orderBy('id', 'asc');
          }

          const rows = await query.limit(limit + 1).execute();
          return pageNumeric(
            rows,
            limit,
            (row) => Number(row.id),
            (row) => mapActivityLogRow(row, input.includeMetadata),
          );
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<ActivityLogRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('activity_log')
            .select(input.includeMetadata ? activityLogDetailColumns : activityLogSummaryColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapActivityLogRow(row, input.includeMetadata) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<ActivityLogMutationPortResult> {
      const values = normalizeActivityLogMutation(input.values, {
        requireAtLeastOneField: true,
        requireActivityType: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const customer = values.customerId === undefined || values.customerId === null
            ? null
            : await resolveCustomerReference(trx, input.workspaceId, values.customerId);
          if (customer === null && values.customerId !== undefined && values.customerId !== null) {
            return { ok: false, code: 'customer_not_found' };
          }

          const deal = values.dealId === undefined || values.dealId === null
            ? null
            : await resolveDealReference(trx, input.workspaceId, values.dealId);
          if (deal === null && values.dealId !== undefined && values.dealId !== null) {
            return { ok: false, code: 'deal_not_found' };
          }

          const task = values.taskId === undefined || values.taskId === null
            ? null
            : await resolveTaskReference(trx, input.workspaceId, values.taskId);
          if (task === null && values.taskId !== undefined && values.taskId !== null) {
            return { ok: false, code: 'task_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('activity_log')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedActivityLogSourceSqliteId(),
              customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
              deal_source_sqlite_id: deal?.sourceSqliteId ?? null,
              task_source_sqlite_id: task?.sourceSqliteId ?? null,
              customer_id: customer?.id ?? null,
              deal_id: deal?.id ?? null,
              task_id: task?.id ?? null,
              activity_type: values.activityType ?? 'note',
              title: values.title ?? null,
              description: values.description ?? null,
              metadata: values.metadata ?? null,
              source_row: serverApiSourceRow(),
              created_at: values.createdAt ?? now,
              updated_at: now,
            })
            .returning(activityLogDetailColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, activityLog: mapActivityLogRow(row, true) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresCalendarEventReadPort(options: PostgresExtendedCrmReadPortOptions): CalendarEventApiPort {
  return {
    async list(input): Promise<CalendarEventListResult> {
      const limit = normalizeLimit(input.limit, 'calendar event');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('calendar_events')
            .select(calendarEventSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.taskId !== undefined) query = query.where('task_id', '=', input.taskId);
          if (input.eventType !== undefined) query = query.where('event_type', '=', input.eventType);
          if (input.startFrom !== undefined) query = query.where('start_date', '>=', new Date(input.startFrom));
          if (input.startTo !== undefined) query = query.where('start_date', '<=', new Date(input.startTo));
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('title', 'ilike', pattern),
              eb('description', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapCalendarEventRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<CalendarEventRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('calendar_events')
            .select(calendarEventSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapCalendarEventRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<CalendarEventMutationPortResult> {
      const values = normalizeCalendarEventMutation(input.values, {
        requireAtLeastOneField: true,
        requireTitle: true,
        requireStartAndEnd: true,
      });
      if (hasCalendarEventDateRangeError(values)) return { ok: false, code: 'invalid_date_range' };

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          let task: TaskReference | null = null;
          if (values.taskId !== undefined && values.taskId !== null) {
            task = await resolveTaskReference(trx, input.workspaceId, values.taskId);
            if (!task) return { ok: false, code: 'task_not_found' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('calendar_events')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedCalendarEventSourceSqliteId(),
              title: values.title ?? '',
              description: values.description ?? null,
              start_date: values.startDate ?? now,
              end_date: values.endDate ?? now,
              all_day: values.allDay ?? false,
              color_code: values.colorCode ?? null,
              event_type: values.eventType ?? null,
              recurrence_rule: values.recurrenceRule ?? null,
              task_source_sqlite_id: task?.sourceSqliteId ?? null,
              task_id: task?.id ?? null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(calendarEventSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, event: mapCalendarEventRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<CalendarEventMutationPortResult | null> {
      const values = normalizeCalendarEventMutation(input.values, {
        requireAtLeastOneField: true,
        requireTitle: false,
        requireStartAndEnd: false,
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
            .selectFrom('calendar_events')
            .select(['start_date', 'end_date'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;
          if (hasEffectiveCalendarEventDateRangeError(values, current)) {
            return { ok: false, code: 'invalid_date_range' };
          }

          let task: TaskReference | null | undefined;
          if (values.taskId !== undefined) {
            if (values.taskId === null) {
              task = null;
            } else {
              task = await resolveTaskReference(trx, input.workspaceId, values.taskId);
              if (!task) return { ok: false, code: 'task_not_found' };
            }
          }

          const now = new Date();
          const row = await trx
            .updateTable('calendar_events')
            .set({
              ...mutationToCalendarEventPatch(values, task),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(calendarEventSelectColumns)
            .executeTakeFirst();
          return row ? { ok: true, event: mapCalendarEventRow(row) } : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<CalendarEventRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('calendar_events')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(calendarEventSelectColumns)
            .executeTakeFirst();
          return row ? mapCalendarEventRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresCustomerCustomFieldReadPort(
  options: PostgresExtendedCrmReadPortOptions,
): CustomerCustomFieldApiPort {
  return {
    async list(input): Promise<CustomerCustomFieldListResult> {
      const limit = normalizeLimit(input.limit, 'customer custom field');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('customer_custom_fields')
            .select(customFieldSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.type !== undefined) query = query.where('type', '=', input.type);
          if (input.active !== undefined) query = query.where('active', '=', input.active);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('name', 'ilike', pattern),
              eb('label', 'ilike', pattern),
              eb('description', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapCustomFieldRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<CustomerCustomFieldRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('customer_custom_fields')
            .select(customFieldSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapCustomFieldRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<CustomerCustomFieldMutationPortResult> {
      const values = normalizeCustomFieldMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: true,
        requireLabel: true,
        requireType: true,
      });

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          if (await hasCustomFieldNameConflict(trx, input.workspaceId, values.name as string)) {
            return { ok: false, code: 'duplicate_name' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('customer_custom_fields')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedCustomFieldSourceSqliteId(),
              name: values.name ?? '',
              label: values.label ?? '',
              type: values.type ?? 'text',
              required: values.required ?? false,
              // jsonb column: stringify so a select field's array of options is
              // sent as valid JSON, not a Postgres array literal ({...}) -> 22P02.
              options: values.options === undefined || values.options === null
                ? null
                : JSON.stringify(values.options),
              default_value: values.defaultValue ?? null,
              placeholder: values.placeholder ?? null,
              description: values.description ?? null,
              display_order: values.displayOrder ?? 0,
              active: values.active ?? true,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(customFieldSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, field: mapCustomFieldRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<CustomerCustomFieldMutationPortResult | null> {
      const values = normalizeCustomFieldMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: false,
        requireLabel: false,
        requireType: false,
      });

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          if (values.name !== undefined && await hasCustomFieldNameConflict(trx, input.workspaceId, values.name, input.id)) {
            return { ok: false, code: 'duplicate_name' };
          }

          const now = new Date();
          const row = await trx
            .updateTable('customer_custom_fields')
            .set({
              ...mutationToCustomFieldPatch(values),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customFieldSelectColumns)
            .executeTakeFirst();
          return row ? { ok: true, field: mapCustomFieldRow(row) } : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<CustomerCustomFieldRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('customer_custom_fields')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customFieldSelectColumns)
            .executeTakeFirst();
          return row ? mapCustomFieldRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresCustomerCustomFieldValueReadPort(
  options: PostgresExtendedCrmReadPortOptions,
): CustomerCustomFieldValueApiPort {
  return {
    async list(input): Promise<CustomerCustomFieldValueListResult> {
      const limit = normalizeLimit(input.limit, 'customer custom field value');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('customer_custom_field_values')
            .select(customFieldValueSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.customerId !== undefined) query = query.where('customer_id', '=', input.customerId);
          if (input.fieldId !== undefined) query = query.where('field_id', '=', input.fieldId);
          const search = input.search?.trim();
          if (search) query = query.where('value', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapCustomFieldValueRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<CustomerCustomFieldValueRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('customer_custom_field_values')
            .select(customFieldValueSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapCustomFieldValueRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<CustomerCustomFieldValueMutationPortResult> {
      const values = normalizeCustomFieldValueMutation(input.values, {
        requireAtLeastOneField: true,
        requireCustomerAndField: true,
      });

      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const customer = await resolveCustomerReference(trx, input.workspaceId, values.customerId as number);
          if (!customer) return { ok: false, code: 'customer_not_found' };
          const field = await resolveCustomFieldReference(trx, input.workspaceId, values.fieldId as number);
          if (!field) return { ok: false, code: 'custom_field_not_found' };
          if (await hasCustomFieldValueConflict(trx, input.workspaceId, customer.sourceSqliteId, field.sourceSqliteId)) {
            return { ok: false, code: 'value_conflict' };
          }

          const now = new Date();
          const row = await trx
            .insertInto('customer_custom_field_values')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedCustomFieldValueSourceSqliteId(),
              customer_source_sqlite_id: customer.sourceSqliteId,
              field_source_sqlite_id: field.sourceSqliteId,
              customer_id: customer.id,
              field_id: field.id,
              value: values.value ?? null,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(customFieldValueSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, value: mapCustomFieldValueRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<CustomerCustomFieldValueMutationPortResult | null> {
      const values = normalizeCustomFieldValueMutation(input.values, {
        requireAtLeastOneField: true,
        requireCustomerAndField: false,
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
            .selectFrom('customer_custom_field_values')
            .select(['customer_source_sqlite_id', 'field_source_sqlite_id'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          if (!current) return null;

          let customer: CustomerReference | undefined;
          if (values.customerId !== undefined) {
            const resolvedCustomer = await resolveCustomerReference(trx, input.workspaceId, values.customerId);
            if (!resolvedCustomer) return { ok: false, code: 'customer_not_found' };
            customer = resolvedCustomer;
          }

          let field: CustomFieldReference | undefined;
          if (values.fieldId !== undefined) {
            const resolvedField = await resolveCustomFieldReference(trx, input.workspaceId, values.fieldId);
            if (!resolvedField) return { ok: false, code: 'custom_field_not_found' };
            field = resolvedField;
          }

          const customerSourceSqliteId = customer?.sourceSqliteId ?? Number(current.customer_source_sqlite_id);
          const fieldSourceSqliteId = field?.sourceSqliteId ?? Number(current.field_source_sqlite_id);
          if (
            await hasCustomFieldValueConflict(
              trx,
              input.workspaceId,
              customerSourceSqliteId,
              fieldSourceSqliteId,
              input.id,
            )
          ) {
            return { ok: false, code: 'value_conflict' };
          }

          const now = new Date();
          const row = await trx
            .updateTable('customer_custom_field_values')
            .set({
              ...mutationToCustomFieldValuePatch(values, customer, field),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customFieldValueSelectColumns)
            .executeTakeFirst();
          return row ? { ok: true, value: mapCustomFieldValueRow(row) } : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<CustomerCustomFieldValueRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('customer_custom_field_values')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customFieldValueSelectColumns)
            .executeTakeFirst();
          return row ? mapCustomFieldValueRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresSavedViewReadPort(options: PostgresExtendedCrmReadPortOptions): SavedViewApiPort {
  return {
    async list(input): Promise<SavedViewListResult> {
      const limit = normalizeLimit(input.limit, 'saved view');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('saved_views')
            .select(savedViewSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          const search = input.search?.trim();
          if (search) query = query.where('name', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.id), mapSavedViewRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<SavedViewRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('saved_views')
            .select(savedViewSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapSavedViewRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<SavedViewRecord> {
      const values = normalizeSavedViewMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: true,
        requireFilters: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .insertInto('saved_views')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedSavedViewSourceSqliteId(),
              name: values.name ?? '',
              filters: values.filters ?? {},
              display_order: values.displayOrder ?? 0,
              source_row: serverApiSourceRow(),
              created_at: now,
              updated_at: now,
            })
            .returning(savedViewSelectColumns)
            .executeTakeFirstOrThrow();
          return mapSavedViewRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<SavedViewRecord | null> {
      const values = normalizeSavedViewMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: false,
        requireFilters: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const now = new Date();
          const row = await trx
            .updateTable('saved_views')
            .set({
              ...mutationToSavedViewPatch(values),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(savedViewSelectColumns)
            .executeTakeFirst();
          return row ? mapSavedViewRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<SavedViewRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('saved_views')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(savedViewSelectColumns)
            .executeTakeFirst();
          return row ? mapSavedViewRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresJtlReferenceReadPort(
  options: PostgresExtendedCrmReadPortOptions & { tableName: JtlReferenceTableName },
): JtlReferenceApiPort {
  return {
    async list(input): Promise<JtlReferenceListResult> {
      const limit = normalizeLimit(input.limit, options.tableName);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom(options.tableName)
            .select(jtlReferenceSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('source_sqlite_id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('source_sqlite_id', '>', input.cursor);
          const search = input.search?.trim();
          if (search) query = query.where('name', 'ilike', `%${search}%`);

          const rows = await query.execute();
          return pageNumeric(rows, limit, (row) => Number(row.source_sqlite_id), mapJtlReferenceRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<JtlReferenceRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom(options.tableName)
            .select(jtlReferenceSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.sourceSqliteId)
            .executeTakeFirst();
          return row ? mapJtlReferenceRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<JtlReferenceRecord> {
      const values = normalizeJtlReferenceMutation(input.values, {
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
          const now = new Date();
          const row = await trx
            .insertInto(options.tableName)
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedJtlReferenceSourceSqliteId(),
              name: values.name ?? null,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning(jtlReferenceSelectColumns)
            .executeTakeFirstOrThrow();
          return mapJtlReferenceRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<JtlReferenceRecord | null> {
      const values = normalizeJtlReferenceMutation(input.values, {
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
          const now = new Date();
          const row = await trx
            .updateTable(options.tableName)
            .set({
              ...mutationToJtlReferencePatch(values),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.sourceSqliteId)
            .returning(jtlReferenceSelectColumns)
            .executeTakeFirst();
          return row ? mapJtlReferenceRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<JtlReferenceRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom(options.tableName)
            .where('workspace_id', '=', input.workspaceId)
            .where('source_sqlite_id', '=', input.sourceSqliteId)
            .returning(jtlReferenceSelectColumns)
            .executeTakeFirst();
          return row ? mapJtlReferenceRow(row) : null;
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

function normalizeLimit(limit: number, label: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${label} list limit must be between 1 and 100`);
  }
  return limit;
}

function normalizeActivityLogMutation(
  values: ActivityLogMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireActivityType: boolean;
  },
): ActivityLogMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('activity log mutation must include at least one field');
  }
  if (options.requireActivityType && !normalized.activityType) {
    throw new Error('activity log activityType is required');
  }
  if (normalized.activityType !== undefined && normalized.activityType.trim() === '') {
    throw new Error('activity log activityType must not be empty');
  }
  for (const [key, value] of [
    ['customerId', normalized.customerId],
    ['dealId', normalized.dealId],
    ['taskId', normalized.taskId],
  ] as const) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`activity log ${key} must be a positive integer`);
    }
  }
  if (normalized.createdAt !== undefined && normalized.createdAt !== null && Number.isNaN(new Date(normalized.createdAt).getTime())) {
    throw new Error('activity log createdAt must be a valid timestamp');
  }
  return normalized;
}

function normalizeCalendarEventMutation(
  values: CalendarEventMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireTitle: boolean;
    requireStartAndEnd: boolean;
  },
): CalendarEventMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('calendar event mutation must include at least one field');
  }
  if (options.requireTitle && !normalized.title) {
    throw new Error('calendar event title is required');
  }
  if (options.requireStartAndEnd && (normalized.startDate === undefined || normalized.endDate === undefined)) {
    throw new Error('calendar event startDate and endDate are required');
  }
  if (normalized.title !== undefined && normalized.title.trim() === '') {
    throw new Error('calendar event title must not be empty');
  }
  if (normalized.startDate !== undefined && Number.isNaN(new Date(normalized.startDate).getTime())) {
    throw new Error('calendar event startDate must be a valid timestamp');
  }
  if (normalized.endDate !== undefined && Number.isNaN(new Date(normalized.endDate).getTime())) {
    throw new Error('calendar event endDate must be a valid timestamp');
  }
  if (
    normalized.taskId !== undefined
    && normalized.taskId !== null
    && (!Number.isSafeInteger(normalized.taskId) || normalized.taskId <= 0)
  ) {
    throw new Error('calendar event taskId must be a positive integer');
  }
  return normalized;
}

function hasCalendarEventDateRangeError(values: CalendarEventMutationInput): boolean {
  if (values.startDate === undefined || values.endDate === undefined) return false;
  return isCalendarEventDateRangeError(values.startDate, values.endDate);
}

function hasEffectiveCalendarEventDateRangeError(
  values: CalendarEventMutationInput,
  current: Pick<CalendarEventRow, 'start_date' | 'end_date'>,
): boolean {
  const startDate = values.startDate ?? timestampToIso(current.start_date);
  const endDate = values.endDate ?? timestampToIso(current.end_date);
  return isCalendarEventDateRangeError(startDate, endDate);
}

function isCalendarEventDateRangeError(startDate: string, endDate: string): boolean {
  return new Date(endDate).getTime() < new Date(startDate).getTime();
}

function mutationToCalendarEventPatch(
  values: CalendarEventMutationInput,
  task: TaskReference | null | undefined,
): Partial<Updateable<CalendarEventsTable>> {
  return {
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.startDate === undefined ? {} : { start_date: values.startDate }),
    ...(values.endDate === undefined ? {} : { end_date: values.endDate }),
    ...(values.allDay === undefined ? {} : { all_day: values.allDay }),
    ...(values.colorCode === undefined ? {} : { color_code: values.colorCode }),
    ...(values.eventType === undefined ? {} : { event_type: values.eventType }),
    ...(values.recurrenceRule === undefined ? {} : { recurrence_rule: values.recurrenceRule }),
    ...(task === undefined ? {} : {
      task_source_sqlite_id: task?.sourceSqliteId ?? null,
      task_id: task?.id ?? null,
    }),
  };
}

async function resolveTaskReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  taskId: number,
): Promise<TaskReference | null> {
  const row = await trx
    .selectFrom('tasks')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', taskId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

function serverCreatedCalendarEventSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('calendar_events', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function normalizeCustomFieldMutation(
  values: CustomerCustomFieldMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireLabel: boolean;
    requireType: boolean;
  },
): CustomerCustomFieldMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('customer custom field mutation must include at least one field');
  }
  if (options.requireName && !normalized.name) {
    throw new Error('customer custom field name is required');
  }
  if (options.requireLabel && !normalized.label) {
    throw new Error('customer custom field label is required');
  }
  if (options.requireType && !normalized.type) {
    throw new Error('customer custom field type is required');
  }
  if (normalized.name !== undefined && normalized.name.trim() === '') {
    throw new Error('customer custom field name must not be empty');
  }
  if (normalized.label !== undefined && normalized.label.trim() === '') {
    throw new Error('customer custom field label must not be empty');
  }
  if (normalized.type !== undefined && normalized.type.trim() === '') {
    throw new Error('customer custom field type must not be empty');
  }
  if (normalized.displayOrder !== undefined && (!Number.isSafeInteger(normalized.displayOrder) || normalized.displayOrder < 0)) {
    throw new Error('customer custom field displayOrder must be a non-negative integer');
  }
  return normalized;
}

function normalizeCustomFieldValueMutation(
  values: CustomerCustomFieldValueMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireCustomerAndField: boolean;
  },
): CustomerCustomFieldValueMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('customer custom field value mutation must include at least one field');
  }
  if (options.requireCustomerAndField && normalized.customerId === undefined) {
    throw new Error('customer custom field value customerId is required');
  }
  if (options.requireCustomerAndField && normalized.fieldId === undefined) {
    throw new Error('customer custom field value fieldId is required');
  }
  if (normalized.customerId !== undefined && (!Number.isSafeInteger(normalized.customerId) || normalized.customerId <= 0)) {
    throw new Error('customer custom field value customerId must be a positive integer');
  }
  if (normalized.fieldId !== undefined && (!Number.isSafeInteger(normalized.fieldId) || normalized.fieldId <= 0)) {
    throw new Error('customer custom field value fieldId must be a positive integer');
  }
  return normalized;
}

function mutationToCustomFieldPatch(values: CustomerCustomFieldMutationInput): Partial<Updateable<CustomerCustomFieldsTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.label === undefined ? {} : { label: values.label }),
    ...(values.type === undefined ? {} : { type: values.type }),
    ...(values.required === undefined ? {} : { required: values.required }),
    ...(values.options === undefined
      ? {}
      : { options: values.options === null ? null : JSON.stringify(values.options) }),
    ...(values.defaultValue === undefined ? {} : { default_value: values.defaultValue }),
    ...(values.placeholder === undefined ? {} : { placeholder: values.placeholder }),
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.displayOrder === undefined ? {} : { display_order: values.displayOrder }),
    ...(values.active === undefined ? {} : { active: values.active }),
  };
}

function mutationToCustomFieldValuePatch(
  values: CustomerCustomFieldValueMutationInput,
  customer: CustomerReference | undefined,
  field: CustomFieldReference | undefined,
): Partial<Updateable<CustomerCustomFieldValuesTable>> {
  return {
    ...(customer === undefined ? {} : {
      customer_source_sqlite_id: customer.sourceSqliteId,
      customer_id: customer.id,
    }),
    ...(field === undefined ? {} : {
      field_source_sqlite_id: field.sourceSqliteId,
      field_id: field.id,
    }),
    ...(values.value === undefined ? {} : { value: values.value }),
  };
}

async function hasCustomFieldNameConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  name: string,
  excludingId?: number,
): Promise<boolean> {
  let query = trx
    .selectFrom('customer_custom_fields')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('name', '=', name);
  if (excludingId !== undefined) query = query.where('id', '!=', excludingId);
  return Boolean(await query.executeTakeFirst());
}

async function hasCustomFieldValueConflict(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerSourceSqliteId: number,
  fieldSourceSqliteId: number,
  excludingId?: number,
): Promise<boolean> {
  let query = trx
    .selectFrom('customer_custom_field_values')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('customer_source_sqlite_id', '=', customerSourceSqliteId)
    .where('field_source_sqlite_id', '=', fieldSourceSqliteId);
  if (excludingId !== undefined) query = query.where('id', '!=', excludingId);
  return Boolean(await query.executeTakeFirst());
}

async function resolveCustomerReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerId: number,
): Promise<CustomerReference | null> {
  const row = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', customerId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

async function resolveDealReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  dealId: number,
): Promise<DealReference | null> {
  const row = await trx
    .selectFrom('deals')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', dealId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

async function resolveCustomFieldReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  fieldId: number,
): Promise<CustomFieldReference | null> {
  const row = await trx
    .selectFrom('customer_custom_fields')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', fieldId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

function serverCreatedCustomFieldSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('customer_custom_fields', 'id'))`;
}

function serverCreatedCustomFieldValueSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('customer_custom_field_values', 'id'))`;
}

function normalizeSavedViewMutation(
  values: SavedViewMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireFilters: boolean;
  },
): SavedViewMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('saved view mutation must include at least one field');
  }
  if (options.requireName && !normalized.name) {
    throw new Error('saved view name is required');
  }
  if (options.requireFilters && normalized.filters === undefined) {
    throw new Error('saved view filters are required');
  }
  if (normalized.name !== undefined && normalized.name.trim() === '') {
    throw new Error('saved view name must not be empty');
  }
  if (normalized.displayOrder !== undefined && (!Number.isSafeInteger(normalized.displayOrder) || normalized.displayOrder < 0)) {
    throw new Error('saved view displayOrder must be a non-negative integer');
  }
  return normalized;
}

function mutationToSavedViewPatch(values: SavedViewMutationInput): Partial<Updateable<SavedViewsTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.filters === undefined ? {} : { filters: values.filters }),
    ...(values.displayOrder === undefined ? {} : { display_order: values.displayOrder }),
  };
}

function serverCreatedSavedViewSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('saved_views', 'id'))`;
}

function serverCreatedActivityLogSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('activity_log', 'id'))`;
}

function normalizeJtlReferenceMutation(
  values: JtlReferenceMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
  },
): JtlReferenceMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('JTL reference mutation must include at least one field');
  }
  if (options.requireName && !Object.prototype.hasOwnProperty.call(normalized, 'name')) {
    throw new Error('JTL reference name is required');
  }
  if (typeof normalized.name === 'string') {
    const name = normalized.name.trim();
    normalized.name = name === '' ? null : name;
  }
  return normalized;
}

function mutationToJtlReferencePatch(values: JtlReferenceMutationInput): Partial<Updateable<JtlReferenceTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
  };
}

function serverCreatedJtlReferenceSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval('jtl_references_server_source_sqlite_id_seq')`;
}

function mapActivityLogRow(row: ActivityLogApiRow, includeMetadata: boolean): ActivityLogRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerSourceSqliteId: nullableNumber(row.customer_source_sqlite_id),
    dealSourceSqliteId: nullableNumber(row.deal_source_sqlite_id),
    taskSourceSqliteId: nullableNumber(row.task_source_sqlite_id),
    customerId: nullableNumber(row.customer_id),
    dealId: nullableNumber(row.deal_id),
    taskId: nullableNumber(row.task_id),
    activityType: row.activity_type,
    title: row.title,
    description: row.description,
    ...(includeMetadata ? { metadata: row.metadata } : {}),
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapCalendarEventRow(row: Pick<CalendarEventRow, typeof calendarEventSelectColumns[number]>): CalendarEventRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    title: row.title,
    description: row.description,
    startDate: timestampToIso(row.start_date),
    endDate: timestampToIso(row.end_date),
    allDay: row.all_day,
    colorCode: row.color_code,
    eventType: row.event_type,
    recurrenceRule: row.recurrence_rule,
    taskSourceSqliteId: nullableNumber(row.task_source_sqlite_id),
    taskId: nullableNumber(row.task_id),
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapCustomFieldRow(row: Pick<CustomerCustomFieldRow, typeof customFieldSelectColumns[number]>): CustomerCustomFieldRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    name: row.name,
    label: row.label,
    type: row.type,
    required: row.required,
    options: row.options,
    defaultValue: row.default_value,
    placeholder: row.placeholder,
    description: row.description,
    displayOrder: row.display_order,
    active: row.active,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapCustomFieldValueRow(
  row: Pick<CustomerCustomFieldValueRow, typeof customFieldValueSelectColumns[number]>,
): CustomerCustomFieldValueRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerSourceSqliteId: Number(row.customer_source_sqlite_id),
    fieldSourceSqliteId: Number(row.field_source_sqlite_id),
    customerId: nullableNumber(row.customer_id),
    fieldId: nullableNumber(row.field_id),
    value: row.value,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapSavedViewRow(row: Pick<SavedViewRow, typeof savedViewSelectColumns[number]>): SavedViewRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    name: row.name,
    filters: row.filters,
    displayOrder: row.display_order,
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapJtlReferenceRow(row: Pick<JtlReferenceRow, typeof jtlReferenceSelectColumns[number]>): JtlReferenceRecord {
  return {
    sourceSqliteId: Number(row.source_sqlite_id),
    name: row.name,
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
