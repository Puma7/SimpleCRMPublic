import { sql as kyselySql, type Kysely } from 'kysely';

import type {
  FollowUpApiPort,
  FollowUpItemRecord,
  FollowUpQueueCountsRecord,
} from '../api/types';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresFollowUpPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

const CLOSED_DEAL_STAGES = ['Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost'] as const;

export function createPostgresFollowUpPort(options: PostgresFollowUpPortOptions): FollowUpApiPort {
  return {
    async getQueueCounts(input): Promise<FollowUpQueueCountsRecord> {
      const dates = followUpDates(input.now ?? new Date());
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const [
            heute,
            ueberfaellig,
            dieseWoche,
            zurueckgestellt,
            stagnierend,
            highValueRisk,
          ] = await Promise.all([
            trx.selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .where('due_date', '>=', dates.todayStart)
              .where('due_date', '<', dates.tomorrowStart)
              .where((eb) => eb.or([
                eb('snoozed_until', 'is', null),
                eb('snoozed_until', '<=', dates.now),
              ]))
              .executeTakeFirstOrThrow(),
            trx.selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .where('due_date', '<', dates.todayStart)
              .where((eb) => eb.or([
                eb('snoozed_until', 'is', null),
                eb('snoozed_until', '<=', dates.now),
              ]))
              .executeTakeFirstOrThrow(),
            trx.selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .where('due_date', '>=', dates.todayStart)
              .where('due_date', '<', dates.weekExclusiveEnd)
              .where((eb) => eb.or([
                eb('snoozed_until', 'is', null),
                eb('snoozed_until', '<=', dates.now),
              ]))
              .executeTakeFirstOrThrow(),
            trx.selectFrom('tasks')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('completed', '=', false)
              .where('snoozed_until', '>', dates.now)
              .executeTakeFirstOrThrow(),
            trx.selectFrom('deals')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('stage', 'not in', CLOSED_DEAL_STAGES)
              .where('last_modified', '<', dates.fourteenDaysAgo)
              .executeTakeFirstOrThrow(),
            trx.selectFrom('deals')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('workspace_id', '=', input.workspaceId)
              .where('stage', 'not in', CLOSED_DEAL_STAGES)
              .where('value', '>', '1000')
              .where((eb) => eb.or([
                eb('expected_close_date', '<', dates.weekExclusiveEnd),
                eb('last_modified', '<', dates.sevenDaysAgo),
              ]))
              .executeTakeFirstOrThrow(),
          ]);

          return {
            heute: numberValue(heute.count),
            ueberfaellig: numberValue(ueberfaellig.count),
            dieseWoche: numberValue(dieseWoche.count),
            zurueckgestellt: numberValue(zurueckgestellt.count),
            stagnierend: numberValue(stagnierend.count),
            highValueRisk: numberValue(highValueRisk.count),
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getItems(input): Promise<readonly FollowUpItemRecord[]> {
      const dates = followUpDates(input.now ?? new Date());
      const limit = normalizeLimit(input.limit);
      const offset = normalizeOffset(input.offset);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          if (input.queue === 'stagnierende_deals' || input.queue === 'high_value_risk') {
            let query = trx.selectFrom('deals')
              .leftJoin('customers', (join) => join
                .onRef('customers.id', '=', 'deals.customer_id')
                .onRef('customers.workspace_id', '=', 'deals.workspace_id'))
              .select([
                'deals.id as id',
                'deals.customer_id as customerId',
                kyselySql<string | null>`coalesce(nullif(btrim(customers.name), ''), nullif(btrim(customers.first_name), ''), nullif(btrim(customers.company), ''))`.as('customerName'),
                kyselySql<string | null>`nullif(btrim(customers.company), '')`.as('customerCompany'),
                'deals.name as name',
                'deals.value as value',
                'deals.stage as stage',
                'deals.expected_close_date as expectedCloseDate',
                'deals.last_modified as lastModified',
              ])
              .where('deals.workspace_id', '=', input.workspaceId)
              .where('deals.stage', 'not in', CLOSED_DEAL_STAGES);

            if (input.queue === 'stagnierende_deals') {
              query = query.where('deals.last_modified', '<', dates.fourteenDaysAgo);
            } else {
              query = query
                .where('deals.value', '>', '1000')
                .where((eb) => eb.or([
                  eb('deals.expected_close_date', '<', dates.weekExclusiveEnd),
                  eb('deals.last_modified', '<', dates.sevenDaysAgo),
                ]));
            }

            const search = input.filters?.query?.trim();
            if (search) {
              const pattern = `%${search}%`;
              query = query.where((eb) => eb.or([
                eb('deals.name', 'ilike', pattern),
                eb('customers.name', 'ilike', pattern),
                eb('customers.first_name', 'ilike', pattern),
                eb('customers.company', 'ilike', pattern),
              ]));
            }

            const rows = await query.execute();
            return rows
              .map((row) => mapDealFollowUpItem(row, input.queue, dates.now))
              .sort((a, b) => b.priorityScore - a.priorityScore)
              .slice(offset, offset + limit);
          }

          let query = trx.selectFrom('tasks')
            .leftJoin('customers', (join) => join
              .onRef('customers.id', '=', 'tasks.customer_id')
              .onRef('customers.workspace_id', '=', 'tasks.workspace_id'))
            .select([
              'tasks.id as id',
              'tasks.customer_id as customerId',
              kyselySql<string | null>`coalesce(nullif(btrim(customers.name), ''), nullif(btrim(customers.first_name), ''), nullif(btrim(customers.company), ''))`.as('customerName'),
              kyselySql<string | null>`nullif(btrim(customers.company), '')`.as('customerCompany'),
              'tasks.title as title',
              'tasks.description as description',
              'tasks.due_date as dueDate',
              'tasks.priority as priority',
              'tasks.snoozed_until as snoozedUntil',
              'tasks.completed as completed',
            ])
            .where('tasks.workspace_id', '=', input.workspaceId)
            .where('tasks.completed', '=', false);

          if (input.queue === 'heute') {
            query = query
              .where('tasks.due_date', '>=', dates.todayStart)
              .where('tasks.due_date', '<', dates.tomorrowStart)
              .where((eb) => eb.or([
                eb('tasks.snoozed_until', 'is', null),
                eb('tasks.snoozed_until', '<=', dates.now),
              ]));
          } else if (input.queue === 'ueberfaellig') {
            query = query
              .where('tasks.due_date', '<', dates.todayStart)
              .where((eb) => eb.or([
                eb('tasks.snoozed_until', 'is', null),
                eb('tasks.snoozed_until', '<=', dates.now),
              ]));
          } else if (input.queue === 'diese_woche') {
            query = query
              .where('tasks.due_date', '>=', dates.todayStart)
              .where('tasks.due_date', '<', dates.weekExclusiveEnd)
              .where((eb) => eb.or([
                eb('tasks.snoozed_until', 'is', null),
                eb('tasks.snoozed_until', '<=', dates.now),
              ]));
          } else if (input.queue === 'zurueckgestellt') {
            query = query.where('tasks.snoozed_until', '>', dates.now);
          }

          if (input.filters?.priority) {
            query = query.where('tasks.priority', '=', input.filters.priority);
          }

          const search = input.filters?.query?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('tasks.title', 'ilike', pattern),
              eb('tasks.description', 'ilike', pattern),
              eb('customers.name', 'ilike', pattern),
              eb('customers.first_name', 'ilike', pattern),
              eb('customers.company', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          return rows
            .map((row) => mapTaskFollowUpItem(row, input.queue, dates.now))
            .sort((a, b) => {
              if (input.queue === 'zurueckgestellt') {
                return compareNullableIso(a.snoozedUntil, b.snoozedUntil);
              }
              return b.priorityScore - a.priorityScore;
            })
            .slice(offset, offset + limit);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },

    async snoozeTask(input): Promise<{ success: boolean; error?: string }> {
      const snoozedUntil = new Date(input.snoozedUntil);
      if (Number.isNaN(snoozedUntil.getTime())) {
        return { success: false, error: 'snoozedUntil must be a valid ISO timestamp' };
      }
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx.updateTable('tasks')
            .set({
              snoozed_until: snoozedUntil,
              last_modified: new Date(),
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.taskId)
            .returning('id')
            .executeTakeFirst();
          return row ? { success: true } : { success: false, error: 'Task not found' };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

type FollowUpDates = ReturnType<typeof followUpDates>;

function followUpDates(now: Date) {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekExclusiveEnd = new Date(todayStart);
  weekExclusiveEnd.setDate(weekExclusiveEnd.getDate() + 8);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { now, todayStart, tomorrowStart, weekExclusiveEnd, fourteenDaysAgo, sevenDaysAgo };
}

function mapTaskFollowUpItem(row: {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerCompany: string | null;
  title: string;
  dueDate: Date | string | null;
  priority: string;
  snoozedUntil: Date | string | null;
  completed: boolean;
}, queue: string, now: Date): FollowUpItemRecord {
  const dueDate = row.dueDate === null ? null : timestampToIso(row.dueDate);
  const priorityScore = priorityBase(row.priority) + overdueDays(dueDate, now) * 5;
  return {
    itemId: Number(row.id),
    sourceType: 'task',
    customerId: row.customerId === null ? null : Number(row.customerId),
    customerName: row.customerName,
    customerCompany: row.customerCompany,
    title: row.title,
    reason: queueReason(queue, { dueDate, snoozedUntil: row.snoozedUntil, now }),
    dueDate,
    priority: row.priority,
    priorityScore,
    snoozedUntil: row.snoozedUntil === null ? null : timestampToIso(row.snoozedUntil),
    completed: row.completed,
  };
}

function mapDealFollowUpItem(row: {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerCompany: string | null;
  name: string;
  value: string;
  stage: string;
  lastModified: Date | string | null;
}, queue: string, now: Date): FollowUpItemRecord {
  const lastModified = row.lastModified === null ? null : timestampToIso(row.lastModified);
  const daysSince = lastModified ? Math.max(0, daysBetween(lastModified, now)) : 0;
  const value = Number(row.value);
  return {
    itemId: Number(row.id),
    sourceType: 'deal',
    customerId: row.customerId === null ? null : Number(row.customerId),
    customerName: row.customerName,
    customerCompany: row.customerCompany,
    dealId: Number(row.id),
    dealName: row.name,
    dealValue: Number.isFinite(value) ? value : 0,
    dealStage: row.stage,
    title: row.name,
    reason: queueReason(queue, { lastModified, now }),
    priority: 'Medium',
    priorityScore: (Number.isFinite(value) ? value : 0) / 1000 + daysSince * 2,
    snoozedUntil: lastModified,
    completed: false,
  };
}

function queueReason(
  queue: string,
  input: { dueDate?: string | null; snoozedUntil?: Date | string | null; lastModified?: string | null; now: Date },
): string {
  if (queue === 'heute') return 'Heute faellig';
  if (queue === 'ueberfaellig') {
    const days = input.dueDate ? Math.max(1, daysBetween(input.dueDate, input.now)) : 1;
    return days > 1 ? `${days} Tage ueberfaellig` : '1 Tag ueberfaellig';
  }
  if (queue === 'diese_woche') return 'Diese Woche faellig';
  if (queue === 'zurueckgestellt') {
    const value = input.snoozedUntil === null || input.snoozedUntil === undefined
      ? null
      : timestampToIso(input.snoozedUntil);
    return value ? `Zurueckgestellt bis ${value}` : 'Zurueckgestellt';
  }
  if (queue === 'stagnierende_deals') {
    const days = input.lastModified ? Math.max(0, daysBetween(input.lastModified, input.now)) : 0;
    return `Deal stagniert (${days} Tage)`;
  }
  if (queue === 'high_value_risk') return 'Hoher Wert, Abschluss gefaehrdet';
  return '';
}

function priorityBase(priority: string): number {
  if (priority === 'High') return 30;
  if (priority === 'Medium') return 15;
  return 5;
}

function overdueDays(dueDate: string | null, now: Date): number {
  if (!dueDate) return 0;
  return Math.max(0, daysBetween(dueDate, now));
}

function daysBetween(value: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
}

function compareNullableIso(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('follow-up limit must be between 1 and 100');
  }
  return limit;
}

function normalizeOffset(offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('follow-up offset must be a non-negative integer');
  }
  return offset;
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
