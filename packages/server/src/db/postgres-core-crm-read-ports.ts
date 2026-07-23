import { sql as kyselySql, type Expression, type ExpressionBuilder, type Kysely, type RawBuilder, type Selectable, type SqlBool, type Updateable } from 'kysely';
import type { TaskScheduleInput } from '@simplecrm/core';

import type {
  DealApiPort,
  DealProductApiPort,
  DealProductDeletePortResult,
  DealProductMutationInput,
  DealProductMutationPortResult,
  DealProductRecord,
  DealListResult,
  DealMutationInput,
  DealMutationPortResult,
  DealRecord,
  ProductApiPort,
  ProductListResult,
  ProductMutationInput,
  ProductRecord,
  CalendarEntryApiPort,
  CalendarEntryMutationPortResult,
  CalendarEventRecord,
  TaskApiPort,
  TaskListResult,
  TaskMutationInput,
  TaskMutationPortResult,
  TaskRecord,
  TaskViewer,
} from '../api/types';
import type {
  DealProductsTable,
  DealsTable,
  CalendarEventsTable,
  ProductsTable,
  ServerDatabase,
  TasksTable,
} from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresCoreCrmReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type ProductRow = Selectable<ProductsTable>;
type DealRow = Selectable<DealsTable>;
type DealProductRow = Selectable<DealProductsTable>;
type TaskRow = Selectable<TasksTable>;
type CalendarEventRow = Selectable<CalendarEventsTable>;
type CustomerReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;
type DealReference = Readonly<{
  id: number;
  sourceSqliteId: number;
  valueCalculationMethod: 'static' | 'dynamic';
}>;
type ProductReference = Readonly<{
  id: number;
  sourceSqliteId: number;
}>;

type DealProductJoinedRow = Readonly<{
  deal_product_id: number;
  deal_product_source_sqlite_id: number;
  deal_source_sqlite_id: number;
  product_source_sqlite_id: number;
  deal_id: number | null;
  linked_product_id: number | null;
  quantity: number;
  price_at_time_of_adding: string;
  date_added: Date | string | null;
  product_id: number;
  product_row_source_sqlite_id: number;
  jtl_kartikel: number | null;
  product_name: string;
  sku: string | null;
  description: string | null;
  product_price: string;
  is_active: boolean;
  product_updated_at: Date | string;
}>;

const productSelectColumns = [
  'id',
  'source_sqlite_id',
  'jtl_kartikel',
  'name',
  'sku',
  'description',
  'price',
  'is_active',
  'updated_at',
] as const;

const dealSelectColumns = [
  'id',
  'source_sqlite_id',
  'customer_source_sqlite_id',
  'customer_id',
  'name',
  'value',
  'value_calculation_method',
  'stage',
  'notes',
  'created_date',
  'expected_close_date',
  'updated_at',
] as const;

const taskSelectColumns = [
  'id',
  'source_sqlite_id',
  'customer_source_sqlite_id',
  'customer_id',
  'title',
  'description',
  'due_date',
  'priority',
  'completed',
  'snoozed_until',
  'assignment_scope',
  'assigned_user_id',
  'assigned_group_id',
  'updated_at',
] as const;

const taskJoinedSelectColumns = [
  'tasks.id as id',
  'tasks.source_sqlite_id as source_sqlite_id',
  'tasks.customer_source_sqlite_id as customer_source_sqlite_id',
  'tasks.customer_id as customer_id',
  'tasks.title as title',
  'tasks.description as description',
  'tasks.due_date as due_date',
  'tasks.priority as priority',
  'tasks.completed as completed',
  'tasks.snoozed_until as snoozed_until',
  'tasks.assignment_scope as assignment_scope',
  'tasks.assigned_user_id as assigned_user_id',
  'tasks.assigned_group_id as assigned_group_id',
  'tasks.updated_at as updated_at',
  'calendar_events.id as calendarEventId',
  kyselySql<string | null>`coalesce(nullif(btrim(customers.name), ''), nullif(btrim(customers.first_name), ''), nullif(btrim(customers.company), ''))`.as('customerName'),
  kyselySql<string | null>`nullif(btrim(customers.company), '')`.as('customerCompany'),
] as const;

type TaskJoinedRow = Pick<TaskRow, typeof taskSelectColumns[number]> & Readonly<{
  customerName: string | null;
  customerCompany: string | null;
  calendarEventId: number | null;
}>;

const taskCalendarEventSelectColumns = [
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

const TASK_EVENT_DEFAULT_COLOR = '#3174ad';
const TASK_EVENT_COMPLETED_COLOR = '#94a3b8';

export function createPostgresProductReadPort(options: PostgresCoreCrmReadPortOptions): ProductApiPort {
  return {
    async list(input): Promise<ProductListResult> {
      const limit = normalizeLimit(input.limit, 'product');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('products')
            .select(productSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('name', 'ilike', pattern),
              eb('sku', 'ilike', pattern),
              eb('description', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapProductRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<ProductRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('products')
            .select(productSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapProductRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<ProductRecord> {
      const values = normalizeProductMutation(input.values, {
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
            .insertInto('products')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedProductSourceSqliteId(),
              name: values.name ?? '',
              sku: values.sku ?? null,
              description: values.description ?? null,
              price: values.price ?? '0.00',
              is_active: values.isActive ?? true,
              date_created: now,
              last_modified: now,
              last_modified_locally: now,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning(productSelectColumns)
            .executeTakeFirstOrThrow();
          return mapProductRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<ProductRecord | null> {
      const values = normalizeProductMutation(input.values, {
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
            .updateTable('products')
            .set({
              ...mutationToProductPatch(values),
              last_modified: now,
              last_modified_locally: now,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(productSelectColumns)
            .executeTakeFirst();
          return row ? mapProductRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<ProductRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('products')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(productSelectColumns)
            .executeTakeFirst();
          return row ? mapProductRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresDealReadPort(options: PostgresCoreCrmReadPortOptions): DealApiPort {
  return {
    async list(input): Promise<DealListResult> {
      const limit = normalizeLimit(input.limit, 'deal');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('deals')
            .select(dealSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('id', '>', input.cursor);
          if (input.customerId !== undefined) query = query.where('customer_id', '=', input.customerId);
          const stage = input.stage?.trim();
          if (stage) query = query.where('stage', '=', stage);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('name', 'ilike', pattern),
              eb('stage', 'ilike', pattern),
              eb('notes', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapDealRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<DealRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('deals')
            .select(dealSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapDealRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<DealMutationPortResult> {
      const values = normalizeDealMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: true,
        requireCustomer: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const customer = await resolveCustomerReference(trx, input.workspaceId, values.customerId);
          if (!customer) return { ok: false, code: 'customer_not_found' };

          const now = new Date();
          const row = await trx
            .insertInto('deals')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedDealSourceSqliteId(),
              customer_source_sqlite_id: customer.sourceSqliteId,
              customer_id: customer.id,
              name: values.name ?? '',
              value: values.value ?? '0.00',
              value_calculation_method: values.valueCalculationMethod ?? 'static',
              stage: values.stage ?? 'New',
              notes: values.notes ?? null,
              created_date: values.createdDate ?? now,
              expected_close_date: values.expectedCloseDate ?? null,
              last_modified: now,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning(dealSelectColumns)
            .executeTakeFirstOrThrow();
          return { ok: true, deal: mapDealRow(row) };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<DealMutationPortResult | null> {
      const values = normalizeDealMutation(input.values, {
        requireAtLeastOneField: true,
        requireName: false,
        requireCustomer: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const customer = values.customerId === undefined
            ? undefined
            : await resolveCustomerReference(trx, input.workspaceId, values.customerId);
          if (customer === null) return { ok: false, code: 'customer_not_found' };

          const now = new Date();
          const row = await trx
            .updateTable('deals')
            .set({
              ...mutationToDealPatch(values, customer),
              last_modified: now,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(dealSelectColumns)
            .executeTakeFirst();
          return row ? { ok: true, deal: mapDealRow(row) } : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<DealRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('deals')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(dealSelectColumns)
            .executeTakeFirst();
          return row ? mapDealRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresDealProductPort(options: PostgresCoreCrmReadPortOptions): DealProductApiPort {
  return {
    async list(input): Promise<readonly DealProductRecord[] | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const deal = await resolveDealReference(trx, input.workspaceId, input.dealId);
          if (!deal) return null;
          return listDealProductsForDeal(trx, input.workspaceId, deal.id);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async add(input): Promise<DealProductMutationPortResult> {
      const values = normalizeDealProductMutation(input.values, {
        requireDeal: true,
        requireProduct: true,
        requireQuantity: true,
        requirePrice: true,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const deal = await resolveDealReference(trx, input.workspaceId, values.dealId);
          if (!deal) return { ok: false, code: 'deal_not_found' };
          const product = await resolveProductReference(trx, input.workspaceId, values.productId);
          if (!product) return { ok: false, code: 'product_not_found' };

          const now = new Date();
          const existing = await trx
            .updateTable('deal_products')
            .set({
              quantity: kyselySql<number>`quantity + ${values.quantity}`,
              price_at_time_of_adding: values.price,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('deal_id', '=', deal.id)
            .where('product_id', '=', product.id)
            .returning(['id', 'deal_id'])
            .executeTakeFirst();

          const row = existing ?? await trx
            .insertInto('deal_products')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedDealProductSourceSqliteId(),
              deal_source_sqlite_id: deal.sourceSqliteId,
              product_source_sqlite_id: product.sourceSqliteId,
              deal_id: deal.id,
              product_id: product.id,
              quantity: values.quantity ?? 1,
              price_at_time_of_adding: values.price ?? '0.00',
              date_added: now,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning(['id', 'deal_id'])
            .executeTakeFirstOrThrow();

          await updateDealValueFromProductsIfDynamic(trx, input.workspaceId, row.deal_id);
          const dealProduct = await getDealProductById(trx, input.workspaceId, Number(row.id));
          return dealProduct
            ? { ok: true, dealProduct }
            : { ok: false, code: 'deal_product_not_found' };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<DealProductMutationPortResult> {
      const values = normalizeDealProductMutation(input.values, {
        requireDeal: false,
        requireProduct: false,
        requireQuantity: true,
        requirePrice: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const target = await findDealProductTarget(trx, input.workspaceId, values);
          if (!target) return { ok: false, code: 'deal_product_not_found' };

          const now = new Date();
          const row = await trx
            .updateTable('deal_products')
            .set({
              quantity: values.quantity,
              ...(values.price === undefined ? {} : { price_at_time_of_adding: values.price }),
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', target.id)
            .returning(['id', 'deal_id'])
            .executeTakeFirst();
          if (!row) return { ok: false, code: 'deal_product_not_found' };

          await updateDealValueFromProductsIfDynamic(trx, input.workspaceId, row.deal_id);
          const dealProduct = await getDealProductById(trx, input.workspaceId, Number(row.id));
          return dealProduct
            ? { ok: true, dealProduct }
            : { ok: false, code: 'deal_product_not_found' };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<DealProductDeletePortResult> {
      const values = normalizeDealProductMutation(input.values, {
        requireDeal: false,
        requireProduct: false,
        requireQuantity: false,
        requirePrice: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const target = await findDealProductTarget(trx, input.workspaceId, values);
          if (!target) return { ok: false, code: 'deal_product_not_found' };
          const dealProduct = await getDealProductById(trx, input.workspaceId, target.id);
          if (!dealProduct) return { ok: false, code: 'deal_product_not_found' };

          const deleted = await trx
            .deleteFrom('deal_products')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', target.id)
            .returning(['id', 'deal_id'])
            .executeTakeFirst();
          if (!deleted) return { ok: false, code: 'deal_product_not_found' };

          await updateDealValueFromProductsIfDynamic(trx, input.workspaceId, deleted.deal_id);
          return { ok: true, dealProduct };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresTaskReadPort(options: PostgresCoreCrmReadPortOptions): TaskApiPort {
  return {
    async list(input): Promise<TaskListResult> {
      const limit = normalizeLimit(input.limit, 'task');
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('tasks')
            .leftJoin('customers', (join) => join
              .onRef('customers.id', '=', 'tasks.customer_id')
              .onRef('customers.workspace_id', '=', 'tasks.workspace_id'))
            .leftJoin('calendar_events', (join) => join
              .onRef('calendar_events.task_id', '=', 'tasks.id')
              .onRef('calendar_events.workspace_id', '=', 'tasks.workspace_id'))
            .select(taskJoinedSelectColumns)
            .where('tasks.workspace_id', '=', input.workspaceId)
            .where((eb) => taskVisibilityExpression(eb, input.workspaceId, input.viewer))
            .orderBy('tasks.id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) query = query.where('tasks.id', '>', input.cursor);
          if (input.customerId !== undefined) query = query.where('tasks.customer_id', '=', input.customerId);
          if (input.completed !== undefined) query = query.where('tasks.completed', '=', input.completed);
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('tasks.title', 'ilike', pattern),
              eb('tasks.description', 'ilike', pattern),
              eb('tasks.priority', 'ilike', pattern),
              eb('customers.name', 'ilike', pattern),
              eb('customers.first_name', 'ilike', pattern),
              eb('customers.company', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapTaskRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<TaskRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('tasks')
            .leftJoin('customers', (join) => join
              .onRef('customers.id', '=', 'tasks.customer_id')
              .onRef('customers.workspace_id', '=', 'tasks.workspace_id'))
            .leftJoin('calendar_events', (join) => join
              .onRef('calendar_events.task_id', '=', 'tasks.id')
              .onRef('calendar_events.workspace_id', '=', 'tasks.workspace_id'))
            .select(taskJoinedSelectColumns)
            .where('tasks.workspace_id', '=', input.workspaceId)
            .where('tasks.id', '=', input.id)
            .where((eb) => taskVisibilityExpression(eb, input.workspaceId, input.viewer))
            .executeTakeFirst();
          return row ? mapTaskRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<TaskMutationPortResult> {
      const values = normalizeTaskMutation(input.values, {
        requireAtLeastOneField: true,
        requireTitle: true,
        requireCustomer: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          // Customer is optional. undefined => no customer; a provided id that
          // does not resolve => customer_not_found.
          const customer = values.customerId === undefined
            ? undefined
            : await resolveCustomerReference(trx, input.workspaceId, values.customerId);
          if (customer === null) return { ok: false, code: 'customer_not_found' };

          const assignment = await resolveTaskAssignmentColumns(trx, input.workspaceId, values);
          if (!assignment.ok) return { ok: false, code: assignment.code };

          const now = new Date();
          const row = await trx
            .insertInto('tasks')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedTaskSourceSqliteId(),
              customer_source_sqlite_id: customer ? customer.sourceSqliteId : null,
              customer_id: customer ? customer.id : null,
              ...assignment.columns,
              title: values.title ?? '',
              description: values.description ?? null,
              due_date: values.dueDate ?? null,
              priority: values.priority ?? 'Medium',
              completed: values.completed ?? false,
              snoozed_until: values.snoozedUntil ?? null,
              created_date: now,
              last_modified: now,
              source_row: serverApiSourceRow(),
              updated_at: now,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const task = await selectTaskById(trx, input.workspaceId, Number(row.id));
          if (!task) throw new Error('created task could not be reloaded');
          return { ok: true, task };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<TaskMutationPortResult | null> {
      const values = normalizeTaskMutation(input.values, {
        requireAtLeastOneField: true,
        requireTitle: false,
        requireCustomer: false,
      });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const current = await selectTaskById(trx, input.workspaceId, input.id, input.viewer);
          if (!current) return null;
          const previousCalendarEventId = current.calendarEventId;
          await lockTaskCalendarEvent(trx, input.workspaceId, current);

          const customer = values.customerId === undefined
            ? undefined
            : await resolveCustomerReference(trx, input.workspaceId, values.customerId);
          if (customer === null) return { ok: false, code: 'customer_not_found' };

          const assignment = await resolveTaskAssignmentColumns(trx, input.workspaceId, values);
          if (!assignment.ok) return { ok: false, code: assignment.code };

          const now = new Date();
          const row = await trx
            .updateTable('tasks')
            .set({
              ...mutationToTaskPatch(values, customer),
              ...assignment.columns,
              last_modified: now,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .where((eb) => taskVisibilityExpression(eb, input.workspaceId, input.viewer))
            .returning('id')
            .executeTakeFirst();
          if (!row) return null;
          let task = await selectTaskById(trx, input.workspaceId, Number(row.id));
          if (task) {
            await syncTaskCalendarEvent(
              trx,
              input.workspaceId,
              task,
              values.dueDate !== undefined,
              values.description !== undefined || values.customerId !== undefined,
            );
            task = await selectTaskById(trx, input.workspaceId, Number(row.id));
          }
          if (!task) return null;
          const calendarEventChange = previousCalendarEventId === null || previousCalendarEventId === undefined
            ? undefined
            : {
                type: task.calendarEventId === null || task.calendarEventId === undefined
                  ? 'deleted' as const
                  : 'updated' as const,
                eventId: previousCalendarEventId,
              };
          return {
            ok: true,
            task,
            ...(calendarEventChange ? { calendarEventChange } : {}),
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<TaskRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const task = await selectTaskById(trx, input.workspaceId, input.id, input.viewer);
          if (!task) return null;
          await lockTaskCalendarEvent(trx, input.workspaceId, task);
          const row = await trx
            .deleteFrom('tasks')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .where((eb) => taskVisibilityExpression(eb, input.workspaceId, input.viewer))
            .returning('id')
            .executeTakeFirst();
          return row ? task : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresCalendarEntryPort(options: PostgresCoreCrmReadPortOptions): CalendarEntryApiPort {
  return {
    async create(input): Promise<CalendarEntryMutationPortResult> {
      const start = parseCalendarDate(input.event.startDate);
      const end = parseCalendarDate(input.event.endDate);
      if (!start || !end || end.getTime() <= start.getTime()) {
        return { ok: false, code: 'invalid_date_range' };
      }

      try {
        return await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
          async (trx) => {
            const scheduled = await resolveCalendarSchedule(
              trx,
              input.workspaceId,
              input.schedule,
              calendarScheduleDueDate(input.schedule, start),
              input.viewer,
            );
            if (!scheduled.ok) return scheduled;

            const task = scheduled.task;
            const now = new Date();
            const row = await trx
              .insertInto('calendar_events')
              .values({
                workspace_id: input.workspaceId,
                source_sqlite_id: serverCreatedCalendarEventSourceSqliteId(),
                title: task?.title ?? input.event.title?.trim() ?? '',
                description: input.event.description ?? task?.description ?? null,
                start_date: start,
                end_date: end,
                all_day: input.event.allDay ?? false,
                color_code: task
                  ? (task.completed ? TASK_EVENT_COMPLETED_COLOR : TASK_EVENT_DEFAULT_COLOR)
                  : input.event.colorCode ?? null,
                event_type: task ? 'task' : input.event.eventType ?? null,
                recurrence_rule: task ? null : input.event.recurrenceRule ?? null,
                task_source_sqlite_id: task?.sourceSqliteId ?? null,
                task_id: task?.id ?? null,
                source_row: serverApiSourceRow(),
                created_at: now,
                updated_at: now,
              })
              .returning(taskCalendarEventSelectColumns)
              .executeTakeFirstOrThrow();
            return {
              ok: true,
              event: mapTaskCalendarEventRow(row),
              task: task ? await selectTaskById(trx, input.workspaceId, task.id) : null,
            };
          },
          { applySession: options.applyWorkspaceSession },
        );
      } catch (error) {
        if (isTaskCalendarUniqueViolation(error)) return { ok: false, code: 'task_already_scheduled' };
        throw error;
      }
    },

    async update(input): Promise<CalendarEntryMutationPortResult> {
      try {
        return await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
          async (trx) => {
            const current = await trx
              .selectFrom('calendar_events')
              .select(taskCalendarEventSelectColumns)
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.id)
              .forUpdate()
              .executeTakeFirst();
            if (!current) return { ok: false, code: 'calendar_event_not_found' };

            const currentTask = current.task_id === null
              ? null
              : await selectTaskById(trx, input.workspaceId, Number(current.task_id), input.viewer);
            if (current.task_id !== null && !currentTask) return { ok: false, code: 'forbidden' };

            const start = input.event.startDate === undefined
              ? new Date(current.start_date)
              : parseCalendarDate(input.event.startDate);
            const end = input.event.endDate === undefined
              ? new Date(current.end_date)
              : parseCalendarDate(input.event.endDate);
            if (!start || !end || end.getTime() <= start.getTime()) {
              return { ok: false, code: 'invalid_date_range' };
            }

            let task = currentTask;
            if (input.schedule !== undefined) {
              if (input.schedule.mode === 'none') {
                task = null;
              } else {
                const scheduled = await resolveCalendarSchedule(
                  trx,
                  input.workspaceId,
                  input.schedule,
                  calendarScheduleDueDate(input.schedule, start),
                  input.viewer,
                  input.id,
                );
                if (!scheduled.ok) return scheduled;
                task = scheduled.task;
              }
            }

            let detachedTaskId: number | null = null;
            if (currentTask && currentTask.id !== task?.id) {
              await clearTaskDueDate(trx, input.workspaceId, currentTask.id);
              detachedTaskId = currentTask.id;
            }

            if (task) {
              const shouldUpdateTaskDueDate = input.event.startDate !== undefined || input.schedule !== undefined;
              const taskPatch: Partial<Updateable<TasksTable>> = {
                ...(shouldUpdateTaskDueDate
                  ? { due_date: calendarScheduleDueDate(input.schedule, start) }
                  : {}),
                last_modified: new Date(),
                updated_at: new Date(),
              };
              if (input.event.title !== undefined) taskPatch.title = input.event.title.trim();
              if (input.event.description !== undefined) taskPatch.description = input.event.description;
              await trx
                .updateTable('tasks')
                .set(taskPatch)
                .where('workspace_id', '=', input.workspaceId)
                .where('id', '=', task.id)
                .execute();
              task = await selectTaskById(trx, input.workspaceId, task.id);
              if (!task) throw new Error('updated task could not be reloaded');
            }

            const row = await trx
              .updateTable('calendar_events')
              .set({
                ...(input.event.title === undefined ? {} : { title: input.event.title.trim() }),
                ...(input.event.description === undefined ? {} : { description: input.event.description }),
                ...(input.event.startDate === undefined ? {} : { start_date: start }),
                ...(input.event.endDate === undefined ? {} : { end_date: end }),
                ...(input.event.allDay === undefined ? {} : { all_day: input.event.allDay }),
                ...(input.event.colorCode === undefined ? {} : { color_code: input.event.colorCode }),
                ...(input.event.eventType === undefined ? {} : { event_type: input.event.eventType }),
                ...(input.event.recurrenceRule === undefined ? {} : { recurrence_rule: input.event.recurrenceRule }),
                ...(input.schedule?.mode === 'none' && current.task_id !== null ? {
                  event_type: input.event.eventType ?? null,
                  recurrence_rule: input.event.recurrenceRule ?? null,
                } : {}),
                ...(input.schedule === undefined ? {} : {
                  task_source_sqlite_id: task?.sourceSqliteId ?? null,
                  task_id: task?.id ?? null,
                }),
                ...(task ? {
                  title: task.title,
                  ...(Number(current.task_id) === task.id || input.event.description !== undefined
                    ? {}
                    : { description: task.description }),
                  color_code: task.completed ? TASK_EVENT_COMPLETED_COLOR : TASK_EVENT_DEFAULT_COLOR,
                  event_type: 'task',
                  recurrence_rule: null,
                } : {}),
                updated_at: new Date(),
              })
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.id)
              .returning(taskCalendarEventSelectColumns)
              .executeTakeFirstOrThrow();
            const linkedTask = task
              ? await selectTaskById(trx, input.workspaceId, task.id)
              : null;
            if (task && !linkedTask) throw new Error('linked task could not be reloaded');
            const detachedTask = detachedTaskId === null
              ? null
              : await selectTaskById(trx, input.workspaceId, detachedTaskId);

            return {
              ok: true,
              event: mapTaskCalendarEventRow(row),
              task: linkedTask,
              ...(detachedTask ? { detachedTask } : {}),
            };
          },
          { applySession: options.applyWorkspaceSession },
        );
      } catch (error) {
        if (isTaskCalendarUniqueViolation(error)) return { ok: false, code: 'task_already_scheduled' };
        throw error;
      }
    },

    async delete(input): Promise<CalendarEntryMutationPortResult> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
        async (trx) => {
          const current = await trx
            .selectFrom('calendar_events')
            .select(taskCalendarEventSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .forUpdate()
            .executeTakeFirst();
          if (!current) return { ok: false, code: 'calendar_event_not_found' };

          const task = current.task_id === null
            ? null
            : await selectTaskById(trx, input.workspaceId, Number(current.task_id), input.viewer);
          if (current.task_id !== null && !task) return { ok: false, code: 'forbidden' };

          await trx
            .deleteFrom('calendar_events')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .execute();
          if (task) await clearTaskDueDate(trx, input.workspaceId, task.id);

          return {
            ok: true,
            event: mapTaskCalendarEventRow(current),
            task: task ? await selectTaskById(trx, input.workspaceId, task.id) : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function selectTaskById(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
  viewer?: TaskViewer,
): Promise<TaskRecord | null> {
  const row = await trx
    .selectFrom('tasks')
    .leftJoin('customers', (join) => join
      .onRef('customers.id', '=', 'tasks.customer_id')
      .onRef('customers.workspace_id', '=', 'tasks.workspace_id'))
    .leftJoin('calendar_events', (join) => join
      .onRef('calendar_events.task_id', '=', 'tasks.id')
      .onRef('calendar_events.workspace_id', '=', 'tasks.workspace_id'))
    .select(taskJoinedSelectColumns)
    .where('tasks.workspace_id', '=', workspaceId)
    .where('tasks.id', '=', id)
    .where((eb) => taskVisibilityExpression(eb, workspaceId, viewer))
    .executeTakeFirst();
  return row ? mapTaskRow(row) : null;
}

async function syncTaskCalendarEvent(
  trx: WorkspaceTransaction,
  workspaceId: string,
  task: TaskRecord,
  reschedule = false,
  syncDescription = false,
): Promise<void> {
  if (task.calendarEventId === null || task.calendarEventId === undefined) return;
  if (task.dueDate === null) {
    await trx
      .deleteFrom('calendar_events')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', task.calendarEventId)
      .execute();
    return;
  }

  const start = reschedule ? taskCalendarStart(task.dueDate) : null;
  const end = start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : null;
  await trx
    .updateTable('calendar_events')
    .set({
      title: task.title,
      ...(syncDescription ? {
        description: [
          task.description?.trim() || null,
          task.customerName?.trim() ? `Kunde: ${task.customerName.trim()}` : null,
        ].filter(Boolean).join('\n') || null,
      } : {}),
      ...(start && end ? { start_date: start, end_date: end, all_day: true } : {}),
      color_code: task.completed ? TASK_EVENT_COMPLETED_COLOR : TASK_EVENT_DEFAULT_COLOR,
      event_type: 'task',
      recurrence_rule: null,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', task.calendarEventId)
    .where('task_id', '=', task.id)
    .execute();
}

async function lockTaskCalendarEvent(
  trx: WorkspaceTransaction,
  workspaceId: string,
  task: TaskRecord,
): Promise<void> {
  if (task.calendarEventId === null || task.calendarEventId === undefined) return;
  await trx
    .selectFrom('calendar_events')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', task.calendarEventId)
    .where('task_id', '=', task.id)
    .forUpdate()
    .executeTakeFirst();
}

function taskCalendarStart(dueDate: string): Date {
  const day = dueDate.slice(0, 10);
  if (!hasValidCalendarDate(day)) {
    throw new Error('task dueDate must be a valid timestamp');
  }
  return new Date(`${day}T00:00:00.000Z`);
}

function calendarScheduleDueDate(schedule: TaskScheduleInput | undefined, fallback: Date): Date {
  return schedule && schedule.mode !== 'none' && schedule.dueDate
    ? taskCalendarStart(schedule.dueDate)
    : fallback;
}

type CalendarScheduleResolution =
  | { ok: true; task: TaskRecord | null }
  | Extract<CalendarEntryMutationPortResult, { ok: false }>;

async function resolveCalendarSchedule(
  trx: WorkspaceTransaction,
  workspaceId: string,
  schedule: TaskScheduleInput | undefined,
  dueDate: Date,
  viewer: TaskViewer,
  currentEventId?: number,
): Promise<CalendarScheduleResolution> {
  if (!schedule || schedule.mode === 'none') return { ok: true, task: null };

  if (schedule.mode === 'existing') {
    const task = await selectTaskById(trx, workspaceId, schedule.taskId, viewer);
    if (!task) return { ok: false, code: 'task_not_found' };
    if (task.calendarEventId !== null && task.calendarEventId !== undefined && task.calendarEventId !== currentEventId) {
      return { ok: false, code: 'task_already_scheduled' };
    }
    const now = new Date();
    await trx
      .updateTable('tasks')
      .set({
        due_date: dueDate,
        ...(schedule.task?.priority === undefined ? {} : { priority: schedule.task.priority }),
        ...(schedule.task?.completed === undefined ? {} : { completed: schedule.task.completed }),
        last_modified: now,
        updated_at: now,
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', task.id)
      .execute();
    return { ok: true, task: await selectTaskById(trx, workspaceId, task.id) };
  }

  const customer = schedule.task.customerId === undefined
    ? undefined
    : await resolveCustomerReference(trx, workspaceId, schedule.task.customerId);
  if (customer === null) return { ok: false, code: 'customer_not_found' };

  const assignment = await resolveTaskAssignmentColumns(trx, workspaceId, schedule.task);
  if (!assignment.ok) return { ok: false, code: assignment.code };

  const now = new Date();
  const row = await trx
    .insertInto('tasks')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedTaskSourceSqliteId(),
      customer_source_sqlite_id: customer?.sourceSqliteId ?? null,
      customer_id: customer?.id ?? null,
      ...assignment.columns,
      title: schedule.task.title.trim(),
      description: schedule.task.description ?? null,
      due_date: dueDate,
      priority: schedule.task.priority ?? 'Medium',
      completed: schedule.task.completed ?? false,
      snoozed_until: null,
      created_date: now,
      last_modified: now,
      source_row: serverApiSourceRow(),
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const task = await selectTaskById(trx, workspaceId, Number(row.id));
  if (!task) throw new Error('created task could not be reloaded');
  return { ok: true, task };
}

async function clearTaskDueDate(
  trx: WorkspaceTransaction,
  workspaceId: string,
  taskId: number,
): Promise<void> {
  const now = new Date();
  await trx
    .updateTable('tasks')
    .set({ due_date: null, last_modified: now, updated_at: now })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', taskId)
    .execute();
}

function parseCalendarDate(value: string | undefined): Date | null {
  if (value === undefined || !hasValidCalendarDate(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function mapTaskCalendarEventRow(
  row: Pick<CalendarEventRow, typeof taskCalendarEventSelectColumns[number]>,
): CalendarEventRecord {
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
    taskSourceSqliteId: row.task_source_sqlite_id === null ? null : Number(row.task_source_sqlite_id),
    taskId: row.task_id === null ? null : Number(row.task_id),
    createdAt: timestampToIsoOrNull(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function isTaskCalendarUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === '23505' && record.constraint === 'calendar_events_workspace_task_unique_idx';
}

function serverCreatedCalendarEventSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('calendar_events', 'id'))`;
}

async function listDealProductsForDeal(
  trx: WorkspaceTransaction,
  workspaceId: string,
  dealId: number,
): Promise<readonly DealProductRecord[]> {
  const rows = await trx
    .selectFrom('deal_products')
    .innerJoin('products', 'products.id', 'deal_products.product_id')
    .select([
      'deal_products.id as deal_product_id',
      'deal_products.source_sqlite_id as deal_product_source_sqlite_id',
      'deal_products.deal_source_sqlite_id',
      'deal_products.product_source_sqlite_id',
      'deal_products.deal_id',
      'deal_products.product_id as linked_product_id',
      'deal_products.quantity',
      'deal_products.price_at_time_of_adding',
      'deal_products.date_added',
      'products.id as product_id',
      'products.source_sqlite_id as product_row_source_sqlite_id',
      'products.jtl_kartikel',
      'products.name as product_name',
      'products.sku',
      'products.description',
      'products.price as product_price',
      'products.is_active',
      'products.updated_at as product_updated_at',
    ])
    .where('deal_products.workspace_id', '=', workspaceId)
    .where('deal_products.deal_id', '=', dealId)
    .orderBy('products.name', 'asc')
    .execute() as readonly DealProductJoinedRow[];

  return rows.map(mapDealProductJoinedRow);
}

async function getDealProductById(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
): Promise<DealProductRecord | null> {
  const row = await trx
    .selectFrom('deal_products')
    .innerJoin('products', 'products.id', 'deal_products.product_id')
    .select([
      'deal_products.id as deal_product_id',
      'deal_products.source_sqlite_id as deal_product_source_sqlite_id',
      'deal_products.deal_source_sqlite_id',
      'deal_products.product_source_sqlite_id',
      'deal_products.deal_id',
      'deal_products.product_id as linked_product_id',
      'deal_products.quantity',
      'deal_products.price_at_time_of_adding',
      'deal_products.date_added',
      'products.id as product_id',
      'products.source_sqlite_id as product_row_source_sqlite_id',
      'products.jtl_kartikel',
      'products.name as product_name',
      'products.sku',
      'products.description',
      'products.price as product_price',
      'products.is_active',
      'products.updated_at as product_updated_at',
    ])
    .where('deal_products.workspace_id', '=', workspaceId)
    .where('deal_products.id', '=', id)
    .executeTakeFirst() as DealProductJoinedRow | undefined;

  return row ? mapDealProductJoinedRow(row) : null;
}

async function findDealProductTarget(
  trx: WorkspaceTransaction,
  workspaceId: string,
  values: DealProductMutationInput,
): Promise<Pick<DealProductRow, 'id' | 'deal_id'> | null> {
  let query = trx
    .selectFrom('deal_products')
    .select(['id', 'deal_id'])
    .where('workspace_id', '=', workspaceId);

  if (values.dealProductId !== undefined) {
    query = query.where('id', '=', values.dealProductId);
    if (values.dealId !== undefined) query = query.where('deal_id', '=', values.dealId);
    if (values.productId !== undefined) query = query.where('product_id', '=', values.productId);
  } else if (values.dealId !== undefined && values.productId !== undefined) {
    query = query
      .where('deal_id', '=', values.dealId)
      .where('product_id', '=', values.productId);
  } else {
    return null;
  }

  return await query.executeTakeFirst() ?? null;
}

function mapDealProductJoinedRow(row: DealProductJoinedRow): DealProductRecord {
  return {
    id: Number(row.deal_product_id),
    sourceSqliteId: Number(row.deal_product_source_sqlite_id),
    dealSourceSqliteId: Number(row.deal_source_sqlite_id),
    productSourceSqliteId: Number(row.product_source_sqlite_id),
    dealId: row.deal_id === null ? null : Number(row.deal_id),
    productId: row.linked_product_id === null ? null : Number(row.linked_product_id),
    quantity: Number(row.quantity),
    priceAtTimeOfAdding: row.price_at_time_of_adding,
    dateAdded: timestampToIsoOrNull(row.date_added),
    product: {
      id: Number(row.product_id),
      sourceSqliteId: Number(row.product_row_source_sqlite_id),
      jtlKartikel: row.jtl_kartikel === null ? null : Number(row.jtl_kartikel),
      name: row.product_name,
      sku: row.sku,
      description: row.description,
      price: row.product_price,
      isActive: row.is_active,
      updatedAt: timestampToIso(row.product_updated_at),
    },
  };
}

function normalizeLimit(limit: number, resource: string): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error(`${resource} list limit must be between 1 and 100`);
  }
  return limit;
}

function mapProductRow(row: Pick<ProductRow, typeof productSelectColumns[number]>): ProductRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    jtlKartikel: row.jtl_kartikel === null ? null : Number(row.jtl_kartikel),
    name: row.name,
    sku: row.sku,
    description: row.description,
    price: row.price,
    isActive: row.is_active,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function normalizeProductMutation(
  values: ProductMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
  },
): ProductMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('product mutation must include at least one field');
  }
  if (options.requireName && !normalized.name) {
    throw new Error('product name is required');
  }
  if (normalized.name !== undefined && normalized.name.trim() === '') {
    throw new Error('product name must not be empty');
  }
  if (normalized.price !== undefined && !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized.price)) {
    throw new Error('product price must be a decimal with at most two fraction digits');
  }
  return normalized;
}

function mutationToProductPatch(values: ProductMutationInput): Partial<Updateable<ProductsTable>> {
  return {
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.sku === undefined ? {} : { sku: values.sku }),
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.price === undefined ? {} : { price: values.price }),
    ...(values.isActive === undefined ? {} : { is_active: values.isActive }),
  };
}

function serverCreatedProductSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('products', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function normalizeDealMutation(
  values: DealMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireName: boolean;
    requireCustomer: boolean;
  },
): DealMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('deal mutation must include at least one field');
  }
  if (options.requireName && !normalized.name) {
    throw new Error('deal name is required');
  }
  if (options.requireCustomer && normalized.customerId === undefined) {
    throw new Error('deal customerId is required');
  }
  if (normalized.customerId !== undefined && (!Number.isSafeInteger(normalized.customerId) || normalized.customerId <= 0)) {
    throw new Error('deal customerId must be a positive integer');
  }
  if (normalized.name !== undefined && normalized.name.trim() === '') {
    throw new Error('deal name must not be empty');
  }
  if (normalized.value !== undefined && !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized.value)) {
    throw new Error('deal value must be a decimal with at most two fraction digits');
  }
  if (
    normalized.valueCalculationMethod !== undefined
    && normalized.valueCalculationMethod !== 'static'
    && normalized.valueCalculationMethod !== 'dynamic'
  ) {
    throw new Error('deal valueCalculationMethod must be static or dynamic');
  }
  return normalized;
}

function normalizeDealProductMutation(
  values: DealProductMutationInput,
  options: {
    requireDeal: boolean;
    requireProduct: boolean;
    requireQuantity: boolean;
    requirePrice: boolean;
  },
): DealProductMutationInput {
  const normalized = { ...values };
  if (normalized.dealProductId !== undefined && !isPositiveSafeInteger(normalized.dealProductId)) {
    throw new Error('dealProductId must be a positive integer');
  }
  if (normalized.dealId !== undefined && !isPositiveSafeInteger(normalized.dealId)) {
    throw new Error('dealId must be a positive integer');
  }
  if (normalized.productId !== undefined && !isPositiveSafeInteger(normalized.productId)) {
    throw new Error('productId must be a positive integer');
  }
  if (options.requireDeal && normalized.dealId === undefined) {
    throw new Error('dealId is required');
  }
  if (options.requireProduct && normalized.productId === undefined) {
    throw new Error('productId is required');
  }
  if (options.requireQuantity && !isPositiveSafeInteger(normalized.quantity)) {
    throw new Error('quantity must be a positive integer');
  }
  if (normalized.quantity !== undefined && !isPositiveSafeInteger(normalized.quantity)) {
    throw new Error('quantity must be a positive integer');
  }
  if (options.requirePrice && normalized.price === undefined) {
    throw new Error('price is required');
  }
  if (normalized.price !== undefined && !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized.price)) {
    throw new Error('price must be a decimal with at most two fraction digits');
  }
  if (
    normalized.dealProductId === undefined
    && (normalized.dealId === undefined || normalized.productId === undefined)
  ) {
    throw new Error('dealProductId or dealId/productId is required');
  }
  return normalized;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function normalizeTaskMutation(
  values: TaskMutationInput,
  options: {
    requireAtLeastOneField: boolean;
    requireTitle: boolean;
    requireCustomer: boolean;
  },
): TaskMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('task mutation must include at least one field');
  }
  if (options.requireTitle && !normalized.title) {
    throw new Error('task title is required');
  }
  if (options.requireCustomer && normalized.customerId === undefined) {
    throw new Error('task customerId is required');
  }
  if (normalized.customerId !== undefined && (!Number.isSafeInteger(normalized.customerId) || normalized.customerId <= 0)) {
    throw new Error('task customerId must be a positive integer');
  }
  if (normalized.title !== undefined && normalized.title.trim() === '') {
    throw new Error('task title must not be empty');
  }
  return normalized;
}

function mutationToDealPatch(
  values: DealMutationInput,
  customer: CustomerReference | undefined,
): Partial<Updateable<DealsTable>> {
  return {
    ...(customer === undefined ? {} : {
      customer_source_sqlite_id: customer.sourceSqliteId,
      customer_id: customer.id,
    }),
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.value === undefined ? {} : { value: values.value }),
    ...(values.valueCalculationMethod === undefined ? {} : { value_calculation_method: values.valueCalculationMethod }),
    ...(values.stage === undefined ? {} : { stage: values.stage }),
    ...(values.notes === undefined ? {} : { notes: values.notes }),
    ...(values.createdDate === undefined ? {} : { created_date: values.createdDate }),
    ...(values.expectedCloseDate === undefined ? {} : { expected_close_date: values.expectedCloseDate }),
  };
}

function mutationToTaskPatch(
  values: TaskMutationInput,
  customer: CustomerReference | undefined,
): Partial<Updateable<TasksTable>> {
  return {
    ...(customer === undefined ? {} : {
      customer_source_sqlite_id: customer.sourceSqliteId,
      customer_id: customer.id,
    }),
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.dueDate === undefined ? {} : { due_date: values.dueDate }),
    ...(values.priority === undefined ? {} : { priority: values.priority }),
    ...(values.completed === undefined ? {} : { completed: values.completed }),
    ...(values.snoozedUntil === undefined ? {} : { snoozed_until: values.snoozedUntil }),
  };
}

/**
 * Visibility filter for non-admin viewers: a user only sees tasks that are
 * global, assigned to them, or assigned to a group they belong to. Owners,
 * admins, and the system (no viewer) see everything.
 */
function taskVisibilityExpression(
  eb: ExpressionBuilder<ServerDatabase, 'tasks'>,
  workspaceId: string,
  viewer: TaskViewer | undefined,
): Expression<SqlBool> {
  if (!viewer || viewer.role === 'owner' || viewer.role === 'admin') {
    return eb.lit(true);
  }
  return eb.or([
    eb('assignment_scope', '=', 'global'),
    eb.and([eb('assignment_scope', '=', 'user'), eb('assigned_user_id', '=', viewer.userId)]),
    eb.and([
      eb('assignment_scope', '=', 'group'),
      eb('assigned_group_id', 'in',
        eb.selectFrom('user_group_members')
          .select('group_id')
          .where('workspace_id', '=', workspaceId)
          .where('user_id', '=', viewer.userId)),
    ]),
  ]);
}

type TaskAssignmentResolution =
  | { ok: true; columns: Partial<Updateable<TasksTable>> }
  | { ok: false; code: 'assigned_user_not_found' | 'assigned_group_not_found' };

/**
 * Resolves the assignment columns for a mutation. When assignmentScope is
 * absent the assignment is left unchanged. A scope of user/group with a
 * non-resolvable id is rejected; with no id it falls back to global.
 */
async function resolveTaskAssignmentColumns(
  trx: WorkspaceTransaction,
  workspaceId: string,
  values: TaskMutationInput,
): Promise<TaskAssignmentResolution> {
  if (values.assignmentScope === undefined) return { ok: true, columns: {} };

  if (values.assignmentScope === 'user' && (values.assignedUserId ?? null) !== null) {
    const userId = values.assignedUserId as string;
    const exists = await trx
      .selectFrom('users')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!exists) return { ok: false, code: 'assigned_user_not_found' };
    return { ok: true, columns: { assignment_scope: 'user', assigned_user_id: userId, assigned_group_id: null } };
  }

  if (values.assignmentScope === 'group' && (values.assignedGroupId ?? null) !== null) {
    const groupId = values.assignedGroupId as number;
    const exists = await trx
      .selectFrom('user_groups')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', groupId)
      .executeTakeFirst();
    if (!exists) return { ok: false, code: 'assigned_group_not_found' };
    return { ok: true, columns: { assignment_scope: 'group', assigned_group_id: groupId, assigned_user_id: null } };
  }

  return { ok: true, columns: { assignment_scope: 'global', assigned_user_id: null, assigned_group_id: null } };
}

async function resolveCustomerReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerId: number | undefined,
): Promise<CustomerReference | null> {
  if (customerId === undefined) return null;
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
  dealId: number | undefined,
): Promise<DealReference | null> {
  if (dealId === undefined) return null;
  const row = await trx
    .selectFrom('deals')
    .select(['id', 'source_sqlite_id', 'value_calculation_method'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', dealId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    valueCalculationMethod: row.value_calculation_method,
  };
}

async function resolveProductReference(
  trx: WorkspaceTransaction,
  workspaceId: string,
  productId: number | undefined,
): Promise<ProductReference | null> {
  if (productId === undefined) return null;
  const row = await trx
    .selectFrom('products')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
  };
}

function serverCreatedDealSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('deals', 'id'))`;
}

function serverCreatedDealProductSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('deal_products', 'id'))`;
}

function serverCreatedTaskSourceSqliteId(): RawBuilder<number> {
  return kyselySql<number>`-nextval(pg_get_serial_sequence('tasks', 'id'))`;
}

async function updateDealValueFromProductsIfDynamic(
  trx: WorkspaceTransaction,
  workspaceId: string,
  dealId: number | string | null,
): Promise<void> {
  if (dealId === null) return;
  const resolvedDealId = Number(dealId);
  if (!Number.isSafeInteger(resolvedDealId) || resolvedDealId <= 0) return;

  const deal = await trx
    .selectFrom('deals')
    .select(['value_calculation_method'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', resolvedDealId)
    .executeTakeFirst();
  if (!deal || deal.value_calculation_method !== 'dynamic') return;

  const total = await trx
    .selectFrom('deal_products')
    .select(kyselySql<string>`coalesce(sum(quantity * price_at_time_of_adding), 0)::numeric(14,2)`.as('value'))
    .where('workspace_id', '=', workspaceId)
    .where('deal_id', '=', resolvedDealId)
    .executeTakeFirst();
  const now = new Date();
  await trx
    .updateTable('deals')
    .set({
      value: String(total?.value ?? '0.00'),
      last_modified: now,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', resolvedDealId)
    .execute();
}

function mapDealRow(row: Pick<DealRow, typeof dealSelectColumns[number]>): DealRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerSourceSqliteId: Number(row.customer_source_sqlite_id),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    name: row.name,
    value: row.value,
    valueCalculationMethod: row.value_calculation_method,
    stage: row.stage,
    notes: row.notes,
    createdDate: timestampToIsoOrNull(row.created_date),
    expectedCloseDate: timestampToIsoOrNull(row.expected_close_date),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapTaskRow(row: TaskJoinedRow): TaskRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerSourceSqliteId: Number(row.customer_source_sqlite_id),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerName: row.customerName,
    customerCompany: row.customerCompany,
    title: row.title,
    description: row.description,
    dueDate: timestampToIsoOrNull(row.due_date),
    priority: row.priority,
    completed: row.completed,
    snoozedUntil: timestampToIsoOrNull(row.snoozed_until),
    assignmentScope: row.assignment_scope,
    assignedUserId: row.assigned_user_id === null ? null : String(row.assigned_user_id),
    assignedGroupId: row.assigned_group_id === null ? null : Number(row.assigned_group_id),
    calendarEventId: row.calendarEventId === null ? null : Number(row.calendarEventId),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function timestampToIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : timestampToIso(value);
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
