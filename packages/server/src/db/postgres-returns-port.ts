import { randomBytes } from 'crypto';
import type { Kysely } from 'kysely';

import type {
  ReturnCreateInput,
  ReturnItemCondition,
  ReturnItemMutationInput,
  ReturnItemRecord,
  ReturnListInput,
  ReturnListResult,
  ReturnOutcome,
  ReturnReasonRecord,
  ReturnReasonsApiPort,
  ReturnRecord,
  ReturnStatus,
  ReturnUpdateInput,
  ReturnsAnalyticsInput,
  ReturnsAnalyticsResult,
  ReturnsApiPort,
  PortalReturnCreateInput,
  PortalReturnItem,
  PortalReturnRecord,
} from '../api/types';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

/**
 * Default return-reason vocabulary lazily seeded the first time a workspace
 * loads its reasons. The codes are stable identifiers (workflow nodes may
 * eventually key off them); the labels are German because the rest of the UI
 * is. Sort orders leave room (10/20/30/...) for inserting custom reasons.
 */
export const DEFAULT_RETURN_REASONS: ReadonlyArray<{
  code: string;
  label: string;
  sortOrder: number;
}> = [
  { code: 'size_wrong', label: 'Falsche Größe', sortOrder: 10 },
  { code: 'not_liked', label: 'Gefällt nicht', sortOrder: 20 },
  { code: 'defective', label: 'Defekt / Beschädigt', sortOrder: 30 },
  { code: 'wrong_item', label: 'Falscher Artikel', sortOrder: 40 },
  { code: 'late_delivery', label: 'Zu spät geliefert', sortOrder: 50 },
  { code: 'other', label: 'Anders / Sonstiges', sortOrder: 60 },
];

const RETURN_NUMBER_PREFIX = 'R-';
/** 4 random bytes ⇒ 8 hex chars ⇒ ~4·10⁹ combos per workspace. */
const RETURN_NUMBER_RANDOM_BYTES = 4;
/** How many times we retry on the (very unlikely) duplicate return_number. */
const RETURN_NUMBER_MAX_ATTEMPTS = 6;

export type PostgresReturnsPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /** Inject for tests; production uses crypto.randomBytes. */
  generateReturnNumber?: () => string;
}>;

export function createPostgresReturnsPort(options: PostgresReturnsPortOptions): ReturnsApiPort {
  const generateReturnNumber = options.generateReturnNumber ?? defaultGenerateReturnNumber;

  return {
    async list(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => listReturns(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async get(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => getReturn(trx, input.workspaceId, input.id),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async create(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => createReturn(trx, input.workspaceId, input.input, generateReturnNumber),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async update(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => updateReturn(trx, input.workspaceId, input.id, input.update),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async analytics(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => analyticsReturns(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async getPublicByReturnNumber(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => getPublicReturn(trx, input.workspaceId, input.returnNumber),
        { applySession: options.applyWorkspaceSession },
      );
    },

    async createPublic(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => createPublicReturn(
          trx,
          input.workspaceId,
          input.input,
          generateReturnNumber,
        ),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresReturnReasonsPort(
  options: PostgresReturnsPortOptions,
): ReturnReasonsApiPort {
  return {
    async list(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => listReasons(trx, input.workspaceId),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

// ----------------------------------------------------------------------------
// Implementation
// ----------------------------------------------------------------------------

async function listReturns(
  trx: WorkspaceTransaction,
  input: ReturnListInput,
): Promise<ReturnListResult> {
  const limit = Math.min(Math.max(1, input.limit), 200);
  const offset = Math.max(0, input.offset ?? 0);

  let query = trx
    .selectFrom('returns')
    .where('workspace_id', '=', input.workspaceId);
  if (input.status) query = query.where('status', '=', input.status);
  if (typeof input.customerId === 'number') query = query.where('customer_id', '=', input.customerId);
  if (input.search) {
    const needle = `%${input.search.toLowerCase()}%`;
    query = query.where((eb) => eb.or([
      eb('return_number', 'ilike', needle),
      eb('jtl_order_number', 'ilike', needle),
      eb('customer_email', 'ilike', needle),
      eb('customer_name', 'ilike', needle),
    ]));
  }

  const totalCountRow = await query
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirst();
  const totalCount = Number(totalCountRow?.count ?? 0);

  const headerRows = await query
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  if (headerRows.length === 0) return { items: [], totalCount };

  const ids = headerRows.map((row) => Number(row.id));
  const itemRows = await trx
    .selectFrom('return_items')
    .where('workspace_id', '=', input.workspaceId)
    .where('return_id', 'in', ids)
    .selectAll()
    .orderBy('return_id', 'asc')
    .orderBy('id', 'asc')
    .execute();

  const itemsByReturn = new Map<number, ReturnItemRecord[]>();
  for (const row of itemRows) {
    const list = itemsByReturn.get(Number(row.return_id)) ?? [];
    list.push(mapItemRow(row));
    itemsByReturn.set(Number(row.return_id), list);
  }

  return {
    items: headerRows.map((row) => mapReturnRow(row, itemsByReturn.get(Number(row.id)) ?? [])),
    totalCount,
  };
}

async function getReturn(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
): Promise<ReturnRecord | null> {
  const headerRow = await trx
    .selectFrom('returns')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst();
  if (!headerRow) return null;

  const itemRows = await trx
    .selectFrom('return_items')
    .where('workspace_id', '=', workspaceId)
    .where('return_id', '=', id)
    .selectAll()
    .orderBy('id', 'asc')
    .execute();

  return mapReturnRow(headerRow, itemRows.map(mapItemRow));
}

async function createReturn(
  trx: WorkspaceTransaction,
  workspaceId: string,
  input: ReturnCreateInput,
  generateReturnNumber: () => string,
): Promise<{ ok: true; record: ReturnRecord } | { ok: false; error: string }> {
  const items = (input.items ?? []).filter((item) => item.quantity > 0);
  if (items.length === 0) {
    return { ok: false, error: 'Mindestens eine Position mit Menge > 0 ist erforderlich' };
  }

  // Retry-safe insert: if the random return_number collides (vanishingly
  // unlikely with 4 random bytes per workspace), try again with a fresh one.
  let insertedHeader: { id: number; return_number: string } | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < RETURN_NUMBER_MAX_ATTEMPTS; attempt++) {
    const returnNumber = generateReturnNumber();
    try {
      insertedHeader = await trx
        .insertInto('returns')
        .values({
          workspace_id: workspaceId,
          return_number: returnNumber,
          customer_id: input.customerId ?? null,
          email_message_id: input.emailMessageId ?? null,
          jtl_order_number: input.jtlOrderNumber ?? null,
          jtl_kauftrag: input.jtlKauftrag ?? null,
          status: 'pending',
          outcome: null,
          customer_email: input.customerEmail ?? null,
          customer_name: input.customerName ?? null,
          notes: input.notes ?? null,
        })
        .returning(['id', 'return_number'])
        .executeTakeFirstOrThrow();
      break;
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (!insertedHeader) {
    return {
      ok: false,
      error: `Konnte keine eindeutige return_number erzeugen (${RETURN_NUMBER_MAX_ATTEMPTS} Versuche): ${describeError(lastError)}`,
    };
  }

  const returnId = Number(insertedHeader.id);
  await trx
    .insertInto('return_items')
    .values(items.map((item) => ({
      workspace_id: workspaceId,
      return_id: returnId,
      product_id: item.productId ?? null,
      reason_id: item.reasonId ?? null,
      sku: nullableString(item.sku),
      product_name: nullableString(item.productName),
      quantity: Math.max(1, Math.floor(item.quantity)),
      condition: normalizeCondition(item.condition),
      notes: nullableString(item.notes),
    })))
    .execute();

  const record = await getReturn(trx, workspaceId, returnId);
  if (!record) return { ok: false, error: 'Retoure wurde angelegt, konnte aber nicht gelesen werden' };
  return { ok: true, record };
}

async function updateReturn(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
  update: ReturnUpdateInput,
): Promise<{ ok: true; record: ReturnRecord } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {};
  if (update.status !== undefined) patch.status = update.status;
  if (update.outcome !== undefined) patch.outcome = update.outcome;
  if (update.notes !== undefined) patch.notes = update.notes;
  if (Object.keys(patch).length === 0) {
    const existing = await getReturn(trx, workspaceId, id);
    if (!existing) return { ok: false, error: 'Retoure nicht gefunden' };
    return { ok: true, record: existing };
  }
  patch.updated_at = new Date();

  const affected = await trx
    .updateTable('returns')
    .set(patch)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (Number(affected.numUpdatedRows ?? 0) === 0) {
    return { ok: false, error: 'Retoure nicht gefunden' };
  }

  const record = await getReturn(trx, workspaceId, id);
  if (!record) return { ok: false, error: 'Retoure nicht gefunden' };
  return { ok: true, record };
}

async function analyticsReturns(
  trx: WorkspaceTransaction,
  input: ReturnsAnalyticsInput,
): Promise<ReturnsAnalyticsResult> {
  const sinceDate = sinceDaysToDate(input.sinceDays);

  // Header aggregations over the returns table, scoped to the workspace and the
  // optional rolling window. Each builder is constructed fresh (Kysely builders
  // are immutable and typed per-step, so a shared helper would fight the types).
  const baseReturns = () => {
    let query = trx.selectFrom('returns').where('workspace_id', '=', input.workspaceId);
    if (sinceDate) query = query.where('created_at', '>=', sinceDate);
    return query;
  };

  const [statusRows, outcomeRows, totalRow] = await Promise.all([
    baseReturns()
      .select((eb) => ['status', eb.fn.countAll<string>().as('count')])
      .groupBy('status')
      .execute(),
    baseReturns()
      .select((eb) => ['outcome', eb.fn.countAll<string>().as('count')])
      .groupBy('outcome')
      .execute(),
    baseReturns()
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirst(),
  ]);

  // Top reasons: count return_items grouped by reason, joined to the (current)
  // reason vocabulary for code/label. Restricted to the same return window via
  // a join on the parent return. Left join keeps items whose reason was deleted.
  let reasonQuery = trx
    .selectFrom('return_items as ri')
    .innerJoin('returns as r', (join) =>
      join.onRef('r.id', '=', 'ri.return_id').on('r.workspace_id', '=', input.workspaceId))
    .leftJoin('return_reasons as rr', (join) =>
      join.onRef('rr.id', '=', 'ri.reason_id').on('rr.workspace_id', '=', input.workspaceId))
    .where('ri.workspace_id', '=', input.workspaceId);
  if (sinceDate) reasonQuery = reasonQuery.where('r.created_at', '>=', sinceDate);
  const reasonRows = await reasonQuery
    .select((eb) => [
      'ri.reason_id as reason_id',
      'rr.code as code',
      'rr.label as label',
      eb.fn.countAll<string>().as('count'),
    ])
    .groupBy(['ri.reason_id', 'rr.code', 'rr.label'])
    .execute();

  return {
    totalCount: Number(totalRow?.count ?? 0),
    byStatus: statusRows
      .map((row) => ({ status: row.status as ReturnStatus, count: Number(row.count) }))
      .sort((a, b) => b.count - a.count),
    byOutcome: outcomeRows
      .map((row) => ({
        outcome: (row.outcome as ReturnOutcome | null | undefined) ?? null,
        count: Number(row.count),
      }))
      .sort((a, b) => b.count - a.count),
    topReasons: reasonRows
      .map((row) => ({
        reasonId: nullableNumber(row.reason_id),
        code: typeof row.code === 'string' ? row.code : null,
        label: typeof row.label === 'string' ? row.label : null,
        count: Number(row.count),
      }))
      .sort((a, b) => b.count - a.count),
    generatedAt: new Date().toISOString(),
  };
}

function sinceDaysToDate(sinceDays: number | undefined): Date | null {
  if (sinceDays === undefined || !Number.isFinite(sinceDays) || sinceDays <= 0) return null;
  const days = Math.min(Math.floor(sinceDays), 3650);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Public-shaped helpers (Phase 5/6 — customer portal)
// ---------------------------------------------------------------------------

async function getPublicReturn(
  trx: WorkspaceTransaction,
  workspaceId: string,
  returnNumber: string,
): Promise<PortalReturnRecord | null> {
  const trimmed = returnNumber.trim();
  if (!trimmed) return null;
  // Exact match on the normalized form (R-HEX8). We normalize to uppercase
  // so mistyped casing in portal URLs still resolves, but avoid ilike — its %
  // and _ wildcards would let an attacker enumerate return numbers.
  const headerRow = await trx
    .selectFrom('returns')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('return_number', '=', trimmed.toUpperCase())
    .executeTakeFirst();
  if (!headerRow) return null;

  const returnId = Number(headerRow.id);
  const itemRows = await trx
    .selectFrom('return_items as ri')
    .leftJoin('return_reasons as rr', (join) =>
      join.onRef('rr.id', '=', 'ri.reason_id').on('rr.workspace_id', '=', workspaceId))
    .select([
      'ri.sku as sku',
      'ri.product_name as product_name',
      'ri.quantity as quantity',
      'ri.condition as condition',
      'rr.code as reason_code',
      'rr.label as reason_label',
    ])
    .where('ri.workspace_id', '=', workspaceId)
    .where('ri.return_id', '=', returnId)
    .orderBy('ri.id', 'asc')
    .execute();

  return {
    returnNumber: String(headerRow.return_number),
    status: headerRow.status as ReturnStatus,
    outcome: (headerRow.outcome as ReturnOutcome | null | undefined) ?? null,
    jtlOrderNumber: typeof headerRow.jtl_order_number === 'string' ? headerRow.jtl_order_number : null,
    createdAt: toIsoString(headerRow.created_at),
    updatedAt: toIsoString(headerRow.updated_at),
    items: itemRows.map(mapPublicItemRow),
  };
}

async function createPublicReturn(
  trx: WorkspaceTransaction,
  workspaceId: string,
  input: PortalReturnCreateInput,
  generateReturnNumber: () => string,
): Promise<{ ok: true; record: PortalReturnRecord } | { ok: false; error: string }> {
  // The public input never sets customerId / emailMessageId / jtlKauftrag.
  // Reusing createReturn keeps the retry-on-unique-token + item insertion in
  // one place; we just project the result down to the public-shape afterwards.
  const created = await createReturn(
    trx,
    workspaceId,
    {
      jtlOrderNumber: input.jtlOrderNumber ?? null,
      customerEmail: input.customerEmail ?? null,
      customerName: input.customerName ?? null,
      notes: input.notes ?? null,
      items: input.items,
    },
    generateReturnNumber,
  );
  if (!created.ok) return created;

  const publicRecord = await getPublicReturn(trx, workspaceId, created.record.returnNumber);
  if (!publicRecord) {
    return { ok: false, error: 'Retoure wurde angelegt, konnte aber nicht gelesen werden' };
  }
  return { ok: true, record: publicRecord };
}

function mapPublicItemRow(row: Record<string, unknown>): PortalReturnItem {
  return {
    sku: typeof row.sku === 'string' ? row.sku : null,
    productName: typeof row.product_name === 'string' ? row.product_name : null,
    quantity: Number(row.quantity ?? 0),
    condition: (row.condition as ReturnItemRecord['condition']) ?? null,
    reasonCode: typeof row.reason_code === 'string' ? row.reason_code : null,
    reasonLabel: typeof row.reason_label === 'string' ? row.reason_label : null,
  };
}

async function listReasons(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<readonly ReturnReasonRecord[]> {
  const existing = await trx
    .selectFrom('return_reasons')
    .where('workspace_id', '=', workspaceId)
    .where('is_active', '=', true)
    .selectAll()
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  if (existing.length > 0) {
    return existing.map(mapReasonRow);
  }

  // Empty workspace — seed the default vocabulary. ON CONFLICT DO NOTHING
  // makes this idempotent even under a race between two list() calls.
  await trx
    .insertInto('return_reasons')
    .values(DEFAULT_RETURN_REASONS.map((reason) => ({
      workspace_id: workspaceId,
      code: reason.code,
      label: reason.label,
      is_active: true,
      sort_order: reason.sortOrder,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'code']).doNothing())
    .execute();

  const seeded = await trx
    .selectFrom('return_reasons')
    .where('workspace_id', '=', workspaceId)
    .where('is_active', '=', true)
    .selectAll()
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return seeded.map(mapReasonRow);
}

// ----------------------------------------------------------------------------
// Mappers + helpers
// ----------------------------------------------------------------------------

function mapReturnRow(row: Record<string, unknown>, items: ReturnItemRecord[]): ReturnRecord {
  return {
    id: Number(row.id),
    returnNumber: String(row.return_number),
    customerId: nullableNumber(row.customer_id),
    emailMessageId: nullableNumber(row.email_message_id),
    jtlOrderNumber: typeof row.jtl_order_number === 'string' ? row.jtl_order_number : null,
    jtlKauftrag: nullableNumber(row.jtl_kauftrag),
    status: row.status as ReturnStatus,
    outcome: (row.outcome as ReturnOutcome | null | undefined) ?? null,
    customerEmail: typeof row.customer_email === 'string' ? row.customer_email : null,
    customerName: typeof row.customer_name === 'string' ? row.customer_name : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    items,
  };
}

function mapItemRow(row: Record<string, unknown>): ReturnItemRecord {
  return {
    id: Number(row.id),
    returnId: Number(row.return_id),
    productId: nullableNumber(row.product_id),
    reasonId: nullableNumber(row.reason_id),
    sku: typeof row.sku === 'string' ? row.sku : null,
    productName: typeof row.product_name === 'string' ? row.product_name : null,
    quantity: Number(row.quantity ?? 0),
    condition: (row.condition as ReturnItemCondition | null | undefined) ?? null,
    notes: typeof row.notes === 'string' ? row.notes : null,
  };
}

function mapReasonRow(row: Record<string, unknown>): ReturnReasonRecord {
  return {
    id: Number(row.id),
    code: String(row.code),
    label: String(row.label),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCondition(value: unknown): ReturnItemCondition | null {
  if (value !== 'new' && value !== 'opened' && value !== 'used' && value !== 'damaged') return null;
  return value;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function defaultGenerateReturnNumber(): string {
  return RETURN_NUMBER_PREFIX + randomBytes(RETURN_NUMBER_RANDOM_BYTES).toString('hex').toUpperCase();
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  // Postgres `unique_violation` SQLSTATE.
  return code === '23505';
}

function describeError(error: unknown): string {
  if (!error) return 'unknown';
  if (error instanceof Error) return error.message;
  return String(error);
}
