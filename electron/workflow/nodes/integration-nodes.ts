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
        signal: AbortSignal.timeout(30_000),
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

  // --- SPIKE (plan 023): desktop port of jtl.order_context ---
  // Read-only resolver: sender-email/order-no -> erste JTL-Zeile -> jtl.*-Variablen.
  // Portiert von packages/server/src/workflow-execution.ts (executeWorkflowJtlOrderContext).
  const JTL_CTX_EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/;
  const JTL_CTX_ORDER_NO_RE = /^[A-Za-z0-9._\-/]{1,64}$/;
  const sqlLiteral = (v: string) => `'${v.replace(/'/g, "''")}'`;

  const scalar = (value: unknown): string | number | boolean | null => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    return String(value).slice(0, 2_000);
  };

  const parseMapping = (value: unknown): Record<string, string> => {
    const mapping: Record<string, string> = {};
    if (typeof value !== 'string' || !value.trim()) return mapping;
    for (const pair of value.split(',')) {
      const [col, target] = pair.split(':').map((p) => p.trim());
      if (col && target) mapping[col.toLowerCase()] = target;
    }
    return mapping;
  };

  register({
    type: 'jtl.order_context',
    label: 'JTL Bestell-Kontext',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: {
      query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}',
      mapping: '',
    },
    execute: async (ctx, config) => {
      // Safe-by-default: this node runs operator SQL against production JTL/MSSQL
      // and is registered unconditionally (reachable from any inbound-triggered
      // workflow), so it stays OFF unless explicitly opted in via env flag. The
      // gate runs before dry-run and before any SQL so nothing executes when off.
      const flag = process.env.SIMPLECRM_JTL_CONTEXT_NODE;
      if (flag !== '1' && flag !== 'true') {
        return {
          status: 'error',
          port: 'error',
          message: 'jtl.order_context ist deaktiviert (SIMPLECRM_JTL_CONTEXT_NODE nicht gesetzt)',
        };
      }

      const template = String(config.query ?? '').trim();
      if (!template) return { status: 'skipped', message: 'Keine Query' };

      // Absender-E-Mail aus dem Nachrichtenkontext (erste Adresse).
      const email = (ctx.strings.from_address ?? '').split(',')[0]?.trim() ?? '';
      const orderNo = String(ctx.variables['jtl.order_no'] ?? config.orderNo ?? '').trim();

      // Platzhalter binden + SQL-escapen (skip -> no_match, wenn Pflichtwert ungültig).
      let query = template;
      if (query.includes('{{email}}')) {
        if (!email || !JTL_CTX_EMAIL_RE.test(email)) {
          return {
            status: 'skipped',
            port: 'no_match',
            message: 'Ungültige Absender-E-Mail',
            variables: { 'jtl.context_found': false },
          };
        }
        query = query.replace(/\{\{email\}\}/g, sqlLiteral(email));
      }
      if (query.includes('{{orderNo}}')) {
        if (!orderNo || !JTL_CTX_ORDER_NO_RE.test(orderNo)) {
          return {
            status: 'skipped',
            port: 'no_match',
            message: 'Ungültige Bestellnummer',
            variables: { 'jtl.context_found': false },
          };
        }
        query = query.replace(/\{\{orderNo\}\}/g, sqlLiteral(orderNo));
      }

      // SELECT-only-Guard (executeReadOnlyMssqlQuery kappt nur die Länge; hier prüfen).
      // INTO is blocked too: `SELECT ... INTO newtable ...` begins with SELECT and
      // clears the blacklist yet writes a table.
      const upper = query.toUpperCase();
      if (
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|MERGE|INTO)\b/.test(upper)
      ) {
        return { status: 'error', port: 'error', message: 'Nur SELECT erlaubt' };
      }
      if (!upper.startsWith('SELECT')) {
        return { status: 'error', port: 'error', message: 'Query muss mit SELECT beginnen' };
      }

      if (ctx.dryRun) {
        return {
          status: 'ok',
          message: 'dry-run jtl.order_context',
          variables: { 'jtl.context_found': false },
        };
      }

      const { executeReadOnlyMssqlQuery } = await import('../../mssql-keytar-service');
      const r = await executeReadOnlyMssqlQuery(query);
      if (!r.success) return { status: 'error', port: 'error', message: r.error ?? 'MSSQL-Fehler' };

      const rows = r.rows ?? [];
      const first = rows[0];
      if (!first || typeof first !== 'object') {
        return {
          status: 'ok',
          port: 'no_match',
          message: 'Keine JTL-Daten gefunden',
          variables: { 'jtl.context_found': false },
        };
      }

      const mapping = parseMapping(config.mapping);
      const variables: Record<string, string | number | boolean | null> = {
        'jtl.context_found': true,
        'jtl.match_count': rows.length,
      };
      for (const [column, value] of Object.entries(first as Record<string, unknown>)) {
        const key = column.toLowerCase();
        variables[mapping[key] ?? `jtl.${key}`] = scalar(value);
      }
      return { status: 'ok', port: 'default', variables };
    },
  });
}
