import type { Kysely, RawBuilder, Selectable, Updateable } from 'kysely';

import type {
  CustomerApiPort,
  CustomerListResult,
  CustomerMutationInput,
  CustomerRecord,
} from '../api/types';
import type { CustomersTable, ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './workspace-context';

export type PostgresCustomerReadPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type CustomerRow = Selectable<CustomersTable>;

const customerSelectColumns = [
  'id',
  'source_sqlite_id',
  'customer_number',
  'name',
  'first_name',
  'company',
  'email',
  'phone',
  'mobile',
  'street',
  'zip_code',
  'city',
  'country',
  'notes',
  'status',
  'updated_at',
] as const;

export function createPostgresCustomerReadPort(options: PostgresCustomerReadPortOptions): CustomerApiPort {
  return {
    async list(input): Promise<CustomerListResult> {
      const limit = normalizeLimit(input.limit);
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('customers')
            .select(customerSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .orderBy('id', 'asc')
            .limit(limit + 1);

          if (input.cursor !== undefined) {
            query = query.where('id', '>', input.cursor);
          }
          const search = input.search?.trim();
          if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb.or([
              eb('name', 'ilike', pattern),
              eb('first_name', 'ilike', pattern),
              eb('company', 'ilike', pattern),
              eb('email', 'ilike', pattern),
            ]));
          }

          const rows = await query.execute();
          const pageRows = rows.slice(0, limit);
          return {
            items: pageRows.map(mapCustomerRow),
            nextCursor: rows.length > limit ? pageRows[pageRows.length - 1]?.id ?? null : null,
          };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async get(input): Promise<CustomerRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const row = await trx
            .selectFrom('customers')
            .select(customerSelectColumns)
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .executeTakeFirst();
          return row ? mapCustomerRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async create(input): Promise<CustomerRecord> {
      const values = normalizeCustomerMutation(input.values, { requireAtLeastOneField: true });
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
            .insertInto('customers')
            .values({
              workspace_id: input.workspaceId,
              source_sqlite_id: serverCreatedSourceSqliteId(),
              customer_number: values.customerNumber ?? null,
              name: values.name ?? null,
              first_name: values.firstName ?? null,
              company: values.company ?? null,
              email: values.email ?? null,
              phone: values.phone ?? null,
              mobile: values.mobile ?? null,
              street: values.street ?? null,
              zip_code: values.zipCode ?? null,
              city: values.city ?? null,
              country: values.country ?? null,
              notes: values.notes ?? null,
              status: values.status ?? 'Active',
              source_row: serverApiSourceRow(),
              last_modified_locally: now,
              updated_at: now,
            })
            .returning(customerSelectColumns)
            .executeTakeFirstOrThrow();
          return mapCustomerRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async update(input): Promise<CustomerRecord | null> {
      const values = normalizeCustomerMutation(input.values, { requireAtLeastOneField: true });
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const patch = mutationToCustomerPatch(values);
          const now = new Date();
          const row = await trx
            .updateTable('customers')
            .set({
              ...patch,
              last_modified_locally: now,
              updated_at: now,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customerSelectColumns)
            .executeTakeFirst();
          return row ? mapCustomerRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
    async delete(input): Promise<CustomerRecord | null> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          role: 'user',
        },
        async (trx) => {
          const row = await trx
            .deleteFrom('customers')
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.id)
            .returning(customerSelectColumns)
            .executeTakeFirst();
          return row ? mapCustomerRow(row) : null;
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('customer list limit must be between 1 and 100');
  }
  return limit;
}

function mapCustomerRow(row: Pick<CustomerRow, typeof customerSelectColumns[number]>): CustomerRecord {
  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    customerNumber: row.customer_number,
    name: row.name,
    firstName: row.first_name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    street: row.street,
    zipCode: row.zip_code,
    city: row.city,
    country: row.country,
    notes: row.notes,
    status: row.status,
    updatedAt: timestampToIso(row.updated_at),
  };
}

function normalizeCustomerMutation(
  values: CustomerMutationInput,
  options: { requireAtLeastOneField: boolean },
): CustomerMutationInput {
  const normalized = { ...values };
  if (options.requireAtLeastOneField && Object.keys(normalized).length === 0) {
    throw new Error('customer mutation must include at least one field');
  }
  if (normalized.status !== undefined && normalized.status.trim() === '') {
    throw new Error('customer status must not be empty');
  }
  return normalized;
}

function mutationToCustomerPatch(values: CustomerMutationInput): Partial<Updateable<CustomersTable>> {
  return {
    ...(values.customerNumber === undefined ? {} : { customer_number: values.customerNumber }),
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.firstName === undefined ? {} : { first_name: values.firstName }),
    ...(values.company === undefined ? {} : { company: values.company }),
    ...(values.email === undefined ? {} : { email: values.email }),
    ...(values.phone === undefined ? {} : { phone: values.phone }),
    ...(values.mobile === undefined ? {} : { mobile: values.mobile }),
    ...(values.street === undefined ? {} : { street: values.street }),
    ...(values.zipCode === undefined ? {} : { zip_code: values.zipCode }),
    ...(values.city === undefined ? {} : { city: values.city }),
    ...(values.country === undefined ? {} : { country: values.country }),
    ...(values.notes === undefined ? {} : { notes: values.notes }),
    ...(values.status === undefined ? {} : { status: values.status }),
  };
}

function serverCreatedSourceSqliteId(): RawBuilder<number> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql<number>`-nextval(pg_get_serial_sequence('customers', 'id'))`;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`jsonb_build_object('origin', 'server_api')`;
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
