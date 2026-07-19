import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  CanonicalApiRoute,
  ServerApiPorts,
  SyncInfoRecord,
} from './types';
import {
  data,
  error,
  requirePrincipal,
} from './http';

type LoadedSyncInfoRows =
  | { principal: { userId: string; workspaceId: string }; rows: readonly SyncInfoRecord[] }
  | ApiResponse<ApiErrorBody>;

type UidValidityResetNotice = {
  id: string;
  accountId: number;
  folderPath: string;
  oldValidity: string | null;
  newValidity: string | null;
  messageCount: number;
  backedUpCount: number;
  at: string;
};

type ImapAuthNotice = {
  accountId: number;
  message: string;
  at: string;
};

const UID_VALIDITY_NOTICE_PREFIX = 'uidvalidity_notice:';
const IMAP_AUTH_NOTICE_PREFIX = 'imap_auth_notice:';

export const MAIL_NOTICE_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze([
  ...noticeRoute('/api/v1/email/notices/uid-validity'),
  ...noticeRoute('/api/v1/email/notices/imap-auth'),
]);

function noticeRoute(path: string): CanonicalApiRoute[] {
  const pattern = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return (['GET', 'DELETE'] as const).map((method) => ({
    source: 'notice-routes',
    method,
    path,
    pattern,
  }));
}

export async function handleNoticeRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/email/notices/uid-validity') {
    return handleUidValidityNotices(req, ports);
  }

  if (req.path === '/api/v1/email/notices/imap-auth') {
    return handleImapAuthNotices(req, ports);
  }

  return null;
}

async function handleUidValidityNotices(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const loaded = await loadSyncInfoByPrefix(req, ports, UID_VALIDITY_NOTICE_PREFIX, 500);
    if ('status' in loaded) return loaded;
    return data(200, {
      items: uidValidityNoticesFromRows(loaded.rows),
    });
  }

  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const noticeId = optionalQueryText(req.query?.noticeId, 200);
  if (!noticeId) return error(400, 'invalid_notice_id', 'noticeId muss gesetzt sein');

  const loaded = await loadSyncInfoByPrefix(req, ports, UID_VALIDITY_NOTICE_PREFIX, 500);
  if ('status' in loaded) return loaded;
  const syncInfo = ports.syncInfo;
  if (!syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');

  const updates: Record<string, string | null> = {};
  const deletes: string[] = [];
  for (const row of loaded.rows) {
    const notices = parseUidValidityNoticeList(row.value, row.key);
    if (notices.length === 0) continue;
    const next = notices.filter((notice) => notice.id !== noticeId);
    if (next.length === notices.length) continue;
    if (next.length === 0) deletes.push(row.key);
    else updates[row.key] = JSON.stringify(next);
  }

  if (deletes.length > 0) {
    await syncInfo.deleteMany({ workspaceId: loaded.principal.workspaceId, keys: deletes });
  }
  if (Object.keys(updates).length > 0) {
    await syncInfo.setMany({ workspaceId: loaded.principal.workspaceId, values: updates });
  }
  if (deletes.length > 0 || Object.keys(updates).length > 0) {
    await ports.audit?.record({
      workspaceId: loaded.principal.workspaceId,
      actorUserId: loaded.principal.userId,
      action: 'email_notice.uid_validity.dismissed',
      entityType: 'sync_info',
      entityId: noticeId,
      metadata: { keys: [...deletes, ...Object.keys(updates)] },
    });
  }

  return data(200, { success: true });
}

async function handleImapAuthNotices(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const loaded = await loadSyncInfoByPrefix(req, ports, IMAP_AUTH_NOTICE_PREFIX, 500);
    if ('status' in loaded) return loaded;
    return data(200, {
      items: imapAuthNoticesFromRows(loaded.rows),
    });
  }

  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const accountId = optionalQueryPositiveInt(req.query?.accountId);
  if (!accountId) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');

  const key = `${IMAP_AUTH_NOTICE_PREFIX}${accountId}`;
  await ports.syncInfo.deleteMany({ workspaceId: principal.workspaceId, keys: [key] });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'email_notice.imap_auth.dismissed',
    entityType: 'sync_info',
    entityId: key,
    metadata: { accountId },
  });

  return data(200, { success: true });
}

async function loadSyncInfoByPrefix(
  req: ApiRequest,
  ports: ServerApiPorts,
  prefix: string,
  limit: number,
): Promise<LoadedSyncInfoRows> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  const rows = await ports.syncInfo.getByPrefix({
    workspaceId: principal.workspaceId,
    prefix,
    limit,
  });
  return { principal, rows };
}

function uidValidityNoticesFromRows(rows: readonly SyncInfoRecord[]): UidValidityResetNotice[] {
  const notices: UidValidityResetNotice[] = [];
  for (const row of rows) {
    notices.push(...parseUidValidityNoticeList(row.value, row.key));
  }
  return notices.sort((a, b) => b.at.localeCompare(a.at));
}

function parseUidValidityNoticeList(
  raw: string | null | undefined,
  key: string,
): UidValidityResetNotice[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const accountIdFromKey = Number(key.slice(UID_VALIDITY_NOTICE_PREFIX.length));
  return parsed
    .map((item) => normalizeUidValidityNotice(item, accountIdFromKey))
    .filter((item): item is UidValidityResetNotice => item !== null);
}

function normalizeUidValidityNotice(
  item: unknown,
  accountIdFromKey: number,
): UidValidityResetNotice | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const accountId = positiveIntOrFallback(record.accountId, accountIdFromKey);
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const folderPath = typeof record.folderPath === 'string' ? record.folderPath : '';
  if (!id || !accountId || !folderPath) return null;
  return {
    id: id.slice(0, 200),
    accountId,
    folderPath: folderPath.slice(0, 1000),
    oldValidity: nullableText(record.oldValidity, 200),
    newValidity: nullableText(record.newValidity, 200),
    messageCount: nonNegativeInt(record.messageCount),
    backedUpCount: nonNegativeInt(record.backedUpCount),
    at: typeof record.at === 'string' ? record.at : '',
  };
}

function imapAuthNoticesFromRows(rows: readonly SyncInfoRecord[]): ImapAuthNotice[] {
  const notices: ImapAuthNotice[] = [];
  for (const row of rows) {
    const accountIdFromKey = Number(row.key.slice(IMAP_AUTH_NOTICE_PREFIX.length));
    const parsed = parseImapAuthNotice(row.value, accountIdFromKey);
    if (parsed) notices.push(parsed);
  }
  return notices.sort((a, b) => b.at.localeCompare(a.at));
}

function parseImapAuthNotice(
  raw: string | null | undefined,
  accountIdFromKey: number,
): ImapAuthNotice | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const accountId = positiveIntOrFallback(parsed.accountId, accountIdFromKey);
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!accountId || !message) return null;
    return {
      accountId,
      message: message.slice(0, 500),
      at: typeof parsed.at === 'string' ? parsed.at : '',
    };
  } catch {
    if (!Number.isSafeInteger(accountIdFromKey) || accountIdFromKey <= 0) return null;
    return {
      accountId: accountIdFromKey,
      message: raw.slice(0, 500),
      at: '',
    };
  }
}

function optionalQueryText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function optionalQueryPositiveInt(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function positiveIntOrFallback(value: unknown, fallback: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  if (Number.isSafeInteger(fallback) && fallback > 0) return fallback;
  return null;
}

function nullableText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value.slice(0, maxLength);
}

function nonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}
