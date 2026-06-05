import type { Kysely } from 'kysely';

import type {
  DashboardApiPort,
  DashboardRecentCustomerRecord,
  DashboardStatsRecord,
  DashboardUpcomingTaskRecord,
} from '../api/types';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresDashboardPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresDashboardPort(options: PostgresDashboardPortOptions): DashboardApiPort {
  return {
    async getStats(input): Promise<DashboardStatsRecord> {
      const now = input.now ?? new Date();
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);

      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const [
            totalCustomers,
            newCustomersLastMonth,
            activeDeals,
            pendingTasks,
            dueTodayTasks,
            conversion,
          ] = await Promise.all([
            trx
              .selectFrom('customers')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .executeTakeFirstOrThrow(),
            trx
              .selectFrom('customers')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('updated_at', '>=', oneMonthAgo)
              .executeTakeFirstOrThrow(),
            trx
              .selectFrom('deals')
              .select((eb) => [
                eb.fn.countAll<number>().as('count'),
                eb.fn.sum<string>('value').as('totalValue'),
              ])
              .where('workspace_id', '=', input.workspaceId)
              .where('stage', 'not in', CLOSED_DEAL_STAGES)
              .executeTakeFirstOrThrow(),
            trx
              .selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .executeTakeFirstOrThrow(),
            trx
              .selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .where('due_date', '>=', todayStart)
              .where('due_date', '<', tomorrowStart)
              .executeTakeFirstOrThrow(),
            trx
              .selectFrom('deals')
              .select((eb) => [
                eb.fn.count<number>('id').filterWhere('stage', '=', 'Closed Won').as('won'),
                eb.fn.count<number>('id').filterWhere('stage', 'in', ['Closed Won', 'Closed Lost']).as('total'),
              ])
              .where('workspace_id', '=', input.workspaceId)
              .executeTakeFirstOrThrow(),
          ]);

          const conversionTotal = numberValue(conversion.total);
          return {
            totalCustomers: numberValue(totalCustomers.count),
            newCustomersLastMonth: numberValue(newCustomersLastMonth.count),
            activeDealsCount: numberValue(activeDeals.count),
            activeDealsValue: numberValue(activeDeals.totalValue),
            pendingTasksCount: numberValue(pendingTasks.count),
            dueTodayTasksCount: numberValue(dueTodayTasks.count),
            conversionRate: conversionTotal > 0
              ? (numberValue(conversion.won) / conversionTotal) * 100
              : 0,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getRecentCustomers(input): Promise<readonly DashboardRecentCustomerRecord[]> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('customers')
            .select(['id', 'name', 'email', 'updated_at'])
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('updated_at', 'desc')
            .orderBy('id', 'desc')
            .limit(limit)
            .execute();
          return rows.map((row) => ({
            id: Number(row.id),
            name: row.name,
            email: row.email,
            dateAdded: timestampToIso(row.updated_at),
          }));
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getUpcomingTasks(input): Promise<readonly DashboardUpcomingTaskRecord[]> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('tasks')
            .leftJoin('customers', (join) => join
              .onRef('customers.id', '=', 'tasks.customer_id')
              .onRef('customers.workspace_id', '=', 'tasks.workspace_id'))
            .select([
              'tasks.id as id',
              'tasks.title as title',
              'tasks.priority as priority',
              'tasks.customer_id as customerId',
              'tasks.due_date as dueDate',
              'customers.name as customerName',
            ])
            .where('tasks.workspace_id', '=', input.workspaceId)
            .where('tasks.completed', '=', false)
            .orderBy('tasks.due_date', 'asc')
            .orderBy('tasks.id', 'asc')
            .limit(limit)
            .execute();
          return rows.map((row) => ({
            id: Number(row.id),
            title: row.title,
            priority: row.priority,
            customerId: row.customerId === null ? null : Number(row.customerId),
            dueDate: row.dueDate === null ? null : timestampToIso(row.dueDate),
            customerName: row.customerName,
          }));
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

const CLOSED_DEAL_STAGES = ['Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost'] as const;

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 25) {
    throw new Error('dashboard limit must be between 1 and 25');
  }
  return limit;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return 0;
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
