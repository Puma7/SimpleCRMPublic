import { getSyncInfo } from '../../sqlite-service';
import { isHttpMethodAllowed } from '../../../shared/workflow-http-allowlist';
import { assertWorkflowHttpUrlAllowed } from '../http-request-guard';
import type { RegisteredWorkflowNode } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

const HTTP_ALLOWLIST_KEY = 'workflow_http_allowlist';
const MAX_MSSQL_QUERY_CHARS = 8_000;

export function registerIntegrationNodes(register: Reg): void {
  register({
    type: 'sync.run',
    label: 'E-Mail-Konto syncen',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: {},
    execute: async (ctx) => {
      const accountId = Number(ctx.message?.account_id ?? 0);
      if (!accountId) return { status: 'skipped', message: 'Kein Konto' };
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run sync' };
      const { getEmailAccountById } = await import('../../email/email-store');
      const acc = getEmailAccountById(accountId);
      if (!acc) return { status: 'error', message: 'Konto nicht gefunden' };
      if ((acc.protocol || 'imap') === 'pop3') {
        const { syncInboxPop3 } = await import('../../email/email-pop3-sync');
        const r = await syncInboxPop3(accountId);
        return { status: 'ok', variables: { 'sync.fetched': r.fetched } };
      }
      const { syncInboxImap } = await import('../../email/email-imap-sync');
      const r = await syncInboxImap(accountId);
      return { status: 'ok', variables: { 'sync.fetched': r.fetched } };
    },
  });

  register({
    type: 'http.request',
    label: 'HTTP-Anfrage',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: { method: 'GET', url: '', body: '' },
    execute: async (ctx, config) => {
      const url = String(config.url ?? '');
      if (!url) return { status: 'skipped' };
      const allowlistRaw = getSyncInfo(HTTP_ALLOWLIST_KEY) || '';
      const urlCheck = await assertWorkflowHttpUrlAllowed(url, allowlistRaw);
      if (!urlCheck.ok) {
        return { status: 'error', message: urlCheck.message };
      }
      if (ctx.dryRun) return { status: 'ok', message: `dry-run ${url}` };
      const method = String(config.method ?? 'GET').toUpperCase();
      if (!isHttpMethodAllowed(method)) {
        return {
          status: 'error',
          message: `HTTP-Methode ${method} nicht erlaubt (nur GET, POST)`,
        };
      }
      const res = await fetch(url, {
        method,
        body: method === 'GET' ? undefined : String(config.body ?? ''),
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await res.text();
      return {
        status: res.ok ? 'ok' : 'error',
        variables: { 'http.status': res.status, 'http.body': text.slice(0, 8000) },
      };
    },
  });

  register({
    type: 'mssql.query',
    label: 'MSSQL (Read-only)',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: { sql: 'SELECT TOP 10 1 AS ok' },
    execute: async (ctx, config) => {
      const sqlText = String(config.sql ?? '').trim();
      if (!sqlText) return { status: 'skipped' };
      if (sqlText.length > MAX_MSSQL_QUERY_CHARS) {
        return {
          status: 'error',
          message: `SQL zu lang (max ${MAX_MSSQL_QUERY_CHARS} Zeichen)`,
        };
      }
      const upper = sqlText.toUpperCase();
      if (
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|MERGE)\b/.test(upper)
      ) {
        return { status: 'error', message: 'Nur SELECT erlaubt' };
      }
      if (!upper.startsWith('SELECT')) {
        return { status: 'error', message: 'Query muss mit SELECT beginnen' };
      }
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run mssql' };
      const { executeReadOnlyMssqlQuery } = await import('../../mssql-keytar-service');
      const r = await executeReadOnlyMssqlQuery(sqlText);
      if (!r.success) return { status: 'error', message: r.error ?? 'MSSQL-Fehler' };
      return {
        status: 'ok',
        variables: {
          'mssql.rows': JSON.stringify(r.rows ?? []).slice(0, 8000),
          'mssql.row_count': r.rowCount ?? 0,
        },
      };
    },
  });

  register({
    type: 'jtl.lookup',
    label: 'JTL Stammdaten',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: { entity: 'firmen' },
    execute: async (ctx, config) => {
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run jtl' };
      const entity = String(config.entity ?? 'firmen');
      const {
        fetchJtlFirmen,
        fetchJtlWarenlager,
        fetchJtlZahlungsarten,
        fetchJtlVersandarten,
      } = await import('../../mssql-keytar-service');
      let rows: unknown[] = [];
      if (entity === 'warenlager') rows = await fetchJtlWarenlager();
      else if (entity === 'zahlungsarten') rows = await fetchJtlZahlungsarten();
      else if (entity === 'versandarten') rows = await fetchJtlVersandarten();
      else rows = await fetchJtlFirmen();
      return {
        status: 'ok',
        variables: { 'jtl.data': JSON.stringify(rows).slice(0, 8000) },
      };
    },
  });
}
