import { sql as kyselySql, type Kysely } from 'kysely';

import type { DmarcReportingApiPort, DmarcReportingSnapshot } from '../api/types';
import {
  summarizeDmarcRecords,
  type DmarcReportSummary,
  type ParsedDmarcReport,
} from '../dmarc/parse-aggregate-report';
import type { ServerDatabase } from './schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './workspace-context';

export type PostgresDmarcPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type PersistDmarcReportInput = Readonly<{
  workspaceId: string;
  report: ParsedDmarcReport;
  sourceMessageId?: number | null;
  receivedAt?: Date;
}>;

export type PersistDmarcReportResult = Readonly<{
  /** Row id of the stored (or pre-existing) dmarc_reports row. */
  reportRowId: string;
  /** false when this exact (org_name, report_id) was already ingested. */
  isNew: boolean;
  summary: DmarcReportSummary;
}>;

export type DmarcStorePort = Readonly<{
  persistReport(input: PersistDmarcReportInput): Promise<PersistDmarcReportResult>;
}>;

/** Max dmarc_records rows per INSERT (each row binds 11 params; 2000×11 = 22000,
 *  comfortably below Postgres' 65535 bind-parameter limit). */
const RECORD_INSERT_CHUNK = 2000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const TOP_LIMIT = 15;
const UNAUTHORIZED_LIMIT = 25;

type CountValue = number | string | bigint | null;

/** Persists parsed DMARC reports. Idempotent on `(workspace_id, org_name,
 *  report_id)`: re-ingesting the same report is a no-op that still returns the
 *  computed summary so the workflow node can emit its `dmarc.*` variables. */
export function createPostgresDmarcStorePort(
  options: PostgresDmarcPortOptions,
): DmarcStorePort {
  return {
    async persistReport(input): Promise<PersistDmarcReportResult> {
      const summary = summarizeDmarcRecords(input.report.records);
      const receivedAt = input.receivedAt ?? new Date();
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => persistReportInTransaction(trx, input, summary, receivedAt),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function persistReportInTransaction(
  trx: WorkspaceTransaction,
  input: PersistDmarcReportInput,
  summary: DmarcReportSummary,
  receivedAt: Date,
): Promise<PersistDmarcReportResult> {
  const { workspaceId, report } = input;
  const inserted = await trx
    .insertInto('dmarc_reports')
    .values({
      workspace_id: workspaceId,
      org_name: report.orgName,
      report_id: report.reportId,
      email: report.email,
      date_begin: report.dateBegin,
      date_end: report.dateEnd,
      domain: report.domain,
      policy_p: report.policy.p,
      policy_sp: report.policy.sp,
      policy_pct: report.policy.pct,
      policy_adkim: report.policy.adkim,
      policy_aspf: report.policy.aspf,
      source_message_id: input.sourceMessageId ?? null,
      received_at: receivedAt,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'org_name', 'report_id']).doNothing())
    .returning('id')
    .executeTakeFirst();

  if (!inserted) {
    // Idempotent duplicate: the report already exists. Do NOT insert records
    // again (they are attached to the existing report row).
    const existing = await trx
      .selectFrom('dmarc_reports')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('org_name', '=', report.orgName)
      .where('report_id', '=', report.reportId)
      .executeTakeFirstOrThrow();
    return { reportRowId: String(existing.id), isNew: false, summary };
  }

  const reportRowId = String(inserted.id);
  const rows = report.records.map((row) => ({
    workspace_id: workspaceId,
    dmarc_report_id: reportRowId,
    source_ip: row.sourceIp,
    message_count: row.count,
    disposition: row.disposition,
    dkim_eval: row.dkimEval,
    spf_eval: row.spfEval,
    header_from: row.headerFrom,
    envelope_from: row.envelopeFrom,
    dkim_domains: row.dkimDomains.length > 0 ? row.dkimDomains.join(', ') : null,
    spf_domains: row.spfDomains.length > 0 ? row.spfDomains.join(', ') : null,
  }));
  // Chunk the insert: each row binds 11 params, and a large provider report can
  // carry thousands of records — a single INSERT would blow Postgres' 65535
  // bind-parameter ceiling. RECORD_INSERT_CHUNK * 11 stays well under it.
  for (let i = 0; i < rows.length; i += RECORD_INSERT_CHUNK) {
    await trx
      .insertInto('dmarc_records')
      .values(rows.slice(i, i + RECORD_INSERT_CHUNK))
      .execute();
  }

  return { reportRowId, isNew: true, summary };
}

/** Aggregate-on-read reporting for the DMARC statistics page. Every query is
 *  scoped by `date_begin >= now - windowDays` and runs inside the workspace
 *  transaction, so RLS confines it to the caller's workspace. */
export function createPostgresDmarcReportingPort(
  options: PostgresDmarcPortOptions,
): DmarcReportingApiPort {
  return {
    async collect(input): Promise<DmarcReportingSnapshot> {
      const now = input.now ?? new Date();
      const windowDays = clampWindowDays(input.windowDays);
      const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const domain = input.domain?.trim() || undefined;
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => collectDmarcReporting(trx, input.workspaceId, since, windowDays, domain),
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

async function collectDmarcReporting(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  windowDays: number,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot> {
  const [totals, timeSeries, topSourceIps, topFromDomains, dispositions, unauthorizedSources] =
    await Promise.all([
      selectDmarcTotals(trx, workspaceId, since, domain),
      selectDmarcTimeSeries(trx, workspaceId, since, domain),
      selectDmarcTopSourceIps(trx, workspaceId, since, domain),
      selectDmarcTopFromDomains(trx, workspaceId, since, domain),
      selectDmarcDispositions(trx, workspaceId, since, domain),
      selectDmarcUnauthorizedSources(trx, workspaceId, since, domain),
    ]);

  return { windowDays, totals, timeSeries, topSourceIps, topFromDomains, dispositions, unauthorizedSources };
}

// SQL fragments shared across the aggregation queries.
const passExpr = kyselySql<CountValue>`coalesce(sum(case when rec.dkim_eval = 'pass' or rec.spf_eval = 'pass' then rec.message_count else 0 end), 0)`;
const failExpr = kyselySql<CountValue>`coalesce(sum(case when rec.dkim_eval <> 'pass' and rec.spf_eval <> 'pass' then rec.message_count else 0 end), 0)`;
const rejectExpr = kyselySql<CountValue>`coalesce(sum(case when rec.disposition = 'reject' then rec.message_count else 0 end), 0)`;
const quarantineExpr = kyselySql<CountValue>`coalesce(sum(case when rec.disposition = 'quarantine' then rec.message_count else 0 end), 0)`;

/** Applies the shared workspace + time-window (+ optional domain) filters to a
 *  `dmarc_reports as r` query BEFORE `.select()`, so Kysely keeps a stable
 *  builder type across every aggregation query. */
function withReportWindow<QB extends ReportWindowFilterable>(
  builder: QB,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): QB {
  let q = builder
    .where('r.workspace_id', '=', workspaceId)
    .where('r.date_begin', '>=', since) as QB;
  if (domain !== undefined) q = q.where('r.domain', '=', domain) as QB;
  return q;
}

interface ReportWindowFilterable {
  where(column: 'r.workspace_id', op: '=', value: string): this;
  where(column: 'r.date_begin', op: '>=', value: Date): this;
  where(column: 'r.domain', op: '=', value: string): this;
}

function reportsWindowQuery(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
) {
  return withReportWindow(
    trx.selectFrom('dmarc_reports as r'),
    workspaceId,
    since,
    domain,
  );
}

async function selectDmarcTotals(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['totals']> {
  const row = await reportsWindowQuery(trx, workspaceId, since, domain)
    .leftJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      kyselySql<CountValue>`count(distinct r.id)`.as('reports'),
      kyselySql<CountValue>`count(rec.id)`.as('records'),
      kyselySql<CountValue>`coalesce(sum(rec.message_count), 0)`.as('messages'),
      passExpr.as('passMessages'),
      failExpr.as('failMessages'),
      rejectExpr.as('rejectMessages'),
      quarantineExpr.as('quarantineMessages'),
      kyselySql<CountValue>`count(distinct rec.source_ip) filter (where rec.dkim_eval <> 'pass' and rec.spf_eval <> 'pass' and rec.source_ip <> '')`.as('unauthorizedSources'),
      kyselySql<CountValue>`count(distinct r.domain)`.as('domains'),
    ])
    .executeTakeFirst() as Record<string, CountValue> | undefined;
  return {
    reports: countValue(row?.reports),
    records: countValue(row?.records),
    messages: countValue(row?.messages),
    passMessages: countValue(row?.passMessages),
    failMessages: countValue(row?.failMessages),
    rejectMessages: countValue(row?.rejectMessages),
    quarantineMessages: countValue(row?.quarantineMessages),
    unauthorizedSources: countValue(row?.unauthorizedSources),
    domains: countValue(row?.domains),
  };
}

async function selectDmarcTimeSeries(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['timeSeries']> {
  const bucket = kyselySql<string>`to_char(date_trunc('day', r.date_begin at time zone 'UTC'), 'YYYY-MM-DD')`;
  const rows = await reportsWindowQuery(trx, workspaceId, since, domain)
    .leftJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      bucket.as('date'),
      passExpr.as('pass'),
      failExpr.as('fail'),
      rejectExpr.as('reject'),
      quarantineExpr.as('quarantine'),
    ])
    .groupBy(bucket)
    .orderBy(bucket, 'asc')
    .execute() as Array<Record<string, CountValue>>;
  return rows.map((row) => ({
    date: String(row.date ?? ''),
    pass: countValue(row.pass),
    fail: countValue(row.fail),
    reject: countValue(row.reject),
    quarantine: countValue(row.quarantine),
  }));
}

async function selectDmarcTopSourceIps(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['topSourceIps']> {
  const messages = kyselySql<CountValue>`coalesce(sum(rec.message_count), 0)`;
  const rows = await reportsWindowQuery(trx, workspaceId, since, domain)
    .innerJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      kyselySql<string>`rec.source_ip`.as('sourceIp'),
      messages.as('messages'),
      passExpr.as('passMessages'),
      failExpr.as('failMessages'),
    ])
    .where('rec.source_ip', '<>', '')
    .groupBy('rec.source_ip')
    .orderBy(messages, 'desc')
    .limit(TOP_LIMIT)
    .execute() as Array<Record<string, CountValue>>;
  return rows.map((row) => ({
    sourceIp: String(row.sourceIp ?? ''),
    messages: countValue(row.messages),
    passMessages: countValue(row.passMessages),
    failMessages: countValue(row.failMessages),
  }));
}

async function selectDmarcTopFromDomains(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['topFromDomains']> {
  const messages = kyselySql<CountValue>`coalesce(sum(rec.message_count), 0)`;
  const rows = await reportsWindowQuery(trx, workspaceId, since, domain)
    .innerJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      kyselySql<string>`rec.header_from`.as('headerFrom'),
      messages.as('messages'),
      failExpr.as('failMessages'),
    ])
    .where('rec.header_from', 'is not', null)
    .where('rec.header_from', '<>', '')
    .groupBy('rec.header_from')
    .orderBy(messages, 'desc')
    .limit(TOP_LIMIT)
    .execute() as Array<Record<string, CountValue>>;
  return rows.map((row) => ({
    headerFrom: String(row.headerFrom ?? ''),
    messages: countValue(row.messages),
    failMessages: countValue(row.failMessages),
  }));
}

async function selectDmarcDispositions(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['dispositions']> {
  const messages = kyselySql<CountValue>`coalesce(sum(rec.message_count), 0)`;
  const rows = await reportsWindowQuery(trx, workspaceId, since, domain)
    .innerJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      kyselySql<string>`rec.disposition`.as('disposition'),
      messages.as('messages'),
    ])
    .groupBy('rec.disposition')
    .orderBy(messages, 'desc')
    .execute() as Array<Record<string, CountValue>>;
  return rows.map((row) => ({
    disposition: String(row.disposition ?? 'none'),
    messages: countValue(row.messages),
  }));
}

async function selectDmarcUnauthorizedSources(
  trx: WorkspaceTransaction,
  workspaceId: string,
  since: Date,
  domain: string | undefined,
): Promise<DmarcReportingSnapshot['unauthorizedSources']> {
  const messages = kyselySql<CountValue>`coalesce(sum(rec.message_count), 0)`;
  const lastSeen = kyselySql<string>`to_char(max(r.date_begin) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const rows = await reportsWindowQuery(trx, workspaceId, since, domain)
    .innerJoin('dmarc_records as rec', (join) => join
      .onRef('rec.dmarc_report_id', '=', 'r.id')
      .onRef('rec.workspace_id', '=', 'r.workspace_id'))
    .select([
      kyselySql<string>`rec.source_ip`.as('sourceIp'),
      kyselySql<string | null>`rec.header_from`.as('headerFrom'),
      kyselySql<string>`r.domain`.as('domain'),
      kyselySql<string>`r.org_name`.as('orgName'),
      messages.as('messages'),
      lastSeen.as('lastSeen'),
    ])
    .where('rec.dkim_eval', '<>', 'pass')
    .where('rec.spf_eval', '<>', 'pass')
    .where('rec.source_ip', '<>', '')
    .groupBy(['rec.source_ip', 'rec.header_from', 'r.domain', 'r.org_name'])
    .orderBy(messages, 'desc')
    .limit(UNAUTHORIZED_LIMIT)
    .execute() as Array<Record<string, CountValue>>;
  return rows.map((row) => ({
    sourceIp: String(row.sourceIp ?? ''),
    headerFrom: row.headerFrom === null || row.headerFrom === undefined ? null : String(row.headerFrom),
    domain: String(row.domain ?? ''),
    orgName: String(row.orgName ?? ''),
    messages: countValue(row.messages),
    lastSeen: String(row.lastSeen ?? ''),
  }));
}

function clampWindowDays(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_WINDOW_DAYS;
  const rounded = Math.floor(value);
  if (rounded < 1) return 1;
  if (rounded > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return rounded;
}

function countValue(value: CountValue | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
