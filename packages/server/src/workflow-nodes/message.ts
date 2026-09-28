/**
 * Plan 043: Nachrichten-Knoten (Tags, Kategorie, Priorität, Prüfungen, Zuweisung, …).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  emailEvidenceSummaryWorkflowVariables,
  emailEvidenceWorkflowVariables,
  evaluateSenderFilterFromLists,
  parseSenderList,
} from '@simplecrm/core';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { loadEmailEvidenceSummaryForTracking } from '../email-tracking';
import {
  addWorkflowMessageTag,
  booleanConfig,
  optionalPositiveIntegerConfig,
  resolveMessageSourceSqliteId,
  serverCreatedSourceSqliteId,
  serverWorkerSourceRow,
  updateWorkflowMessage,
} from './shared';
import type {
  NodeResult,
  ServerNodeHandler,
  ServerNodeHandlerArgs,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
  WorkflowVariableContext,
} from './types';

const MAX_EMAIL_CATEGORY_DEPTH = 3;

const WORKFLOW_SENDER_WHITELIST_KEY = 'workflow_sender_whitelist';

const WORKFLOW_SENDER_BLACKLIST_KEY = 'workflow_sender_blacklist';

/** Knoten email.tag, tag. */
async function handleEmailTag({ trx, context, node, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const tag = String(config.tag ?? node.data.tag ?? '').trim();
  if (!tag) return { status: 'skipped', port: 'default', message: 'leerer Tag' };
  const result = await addWorkflowMessageTag(trx, context, tag, now, ports);
  return result ?? { status: 'ok', port: 'default', variables: { 'email.last_tag': tag } };
}

/** Knoten email.set_category, set_category. */
async function handleEmailSetCategory({ trx, context, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  // Prefer a stable category reference (source_sqlite_id from the dropdown) so
  // the workflow survives category renames; fall back to the path otherwise
  // (and when the referenced category was deleted).
  const categorySourceSqliteId = optionalPositiveIntegerConfig(config.categorySourceSqliteId, 'categorySourceSqliteId');
  if (!categorySourceSqliteId.ok) return { status: 'error', port: 'error', message: categorySourceSqliteId.message };
  if (categorySourceSqliteId.value !== undefined) {
    const byId = await setWorkflowMessageCategoryById(trx, context, categorySourceSqliteId.value, now, ports);
    if (byId) return byId;
  }
  const path = String(config.path ?? '').trim();
  if (!path) return { status: 'skipped', port: 'default' };
  return await setWorkflowMessageCategoryPath(trx, context, path, now, ports);
}

/** Knoten email.tag_attachment_meta, tag_attachment_meta. */
async function handleEmailTagAttachmentMeta({ trx, context, node, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (context.strings.has_attachments !== 'true') {
    return { status: 'skipped', port: 'default', message: 'keine Anhaenge' };
  }
  const tag = String(config.tag ?? node.data.tag ?? 'attachment').trim() || 'attachment';
  const result = await addWorkflowMessageTag(trx, context, tag, now, ports);
  return result ?? { status: 'ok', port: 'default', variables: { 'email.last_tag': tag } };
}

/** Knoten email.set_priority. */
async function handleEmailSetPriority({ trx, context, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const level = String(config.level ?? 'normal').toLowerCase();
  const allowed = new Set(['hoch', 'high', 'normal', 'niedrig', 'low']);
  if (!allowed.has(level)) {
    return { status: 'error', port: 'error', message: 'level muss hoch, normal oder niedrig sein' };
  }
  const tag = level === 'hoch' || level === 'high'
    ? 'priority:hoch'
    : level === 'niedrig' || level === 'low'
      ? 'priority:niedrig'
      : 'priority:normal';
  const result = await addWorkflowMessageTag(trx, context, tag, now, ports);
  return result ?? {
    status: 'ok',
    port: 'default',
    variables: { 'email.priority': tag, 'email.last_tag': tag },
  };
}

/** Knoten email.auth_check. */
async function handleEmailAuthCheck({ context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const protocol = authProtocolConfig(config.protocol);
  const value = String(context.variables[`auth.${protocol}`] ?? 'none').toLowerCase();
  const softfailAsFail = booleanConfig(config.treatSoftfailAsFail, 'treatSoftfailAsFail', true);
  if (!softfailAsFail.ok) return { status: 'error', port: 'error', message: softfailAsFail.message };
  const failSet = new Set([
    'fail',
    'permerror',
    ...(softfailAsFail.value ? ['softfail', 'policy'] : []),
  ]);
  const port = value === 'pass'
    ? 'pass'
    : failSet.has(value)
      ? 'fail'
      : value === 'none' || value === 'neutral' || value === 'skipped'
        ? 'none'
        : 'default';
  return { status: 'ok', port, variables: { [`auth.check.${protocol}`]: value } };
}

/** Knoten email.read_tracking_evidence. */
async function handleEmailReadTrackingEvidence({ trx, context }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return readWorkflowTrackingEvidence(trx, context);
}

/** Knoten email.sender_filter. */
async function handleEmailSenderFilter({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await evaluateWorkflowSenderFilter(trx, context, config);
}

/** Knoten email.mark_seen, mark_seen. */
async function handleEmailMarkSeen({ trx, context, log, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await markWorkflowMessageSeen(trx, context, now, ports, log);
}

/** Knoten email.archive, archive. */
async function handleEmailArchive({ trx, context, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const result = await updateWorkflowMessage(trx, context, {
    archived: true,
    done_local: true,
    is_spam: false,
    spam_status: 'clean',
    updated_at: now,
  });
  return result ?? { status: 'ok', port: 'default', variables: { 'email.archived': true } };
}

/** Knoten email.assign. */
async function handleEmailAssign({ trx, context, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const raw = config.teamMemberId;
  const teamMemberId = raw === null || raw === undefined || raw === ''
    ? null
    : String(raw).trim();
  if (teamMemberId !== null && !teamMemberId) {
    return { status: 'error', port: 'error', message: 'teamMemberId leer' };
  }
  // Keep assigned_to_user_id in sync so assigned_to_me filters do not keep a
  // stale UUID after workflow reassignment (mirrors the mail assign API).
  // AUSSCHLIESSLICH email_team_members.linked_user_id: der frueher genutzte
  // Fallback ueber die Id-Namensgleichheit haette eine bewusst entfernte
  // Verknuepfung bei der naechsten Workflow-Zuweisung wiederhergestellt und
  // dem Nutzer (plus seinen Gruppen-Peers) erneut assigned_to_me-Sicht
  // gegeben — entgegen der gespeicherten Einstellung.
  let assignedToUserId: string | null = null;
  if (teamMemberId !== null) {
    // Zeilensperre wie im API-Assign-Pfad: eine parallele Link-Aenderung des
    // Admins darf hier keinen veralteten Nutzer in assigned_to_user_id
    // schreiben.
    const member = await trx
      .selectFrom('email_team_members')
      .select(['id', 'linked_user_id'])
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', teamMemberId)
      .forUpdate()
      .executeTakeFirst();
    // Fehlt die Zeile (geloeschtes Mitglied im gespeicherten Knoten, oder das
    // Loeschen hat die Sperre zuerst bekommen), darf hier NICHT geschrieben
    // werden: assigned_to truege eine tote Id und assigned_to_user_id waere
    // null. Die Nachricht passte danach auf keinen Zuweisungsfilter mehr —
    // weder assigned_to_me/assigned_to_my_groups (brauchen die User-Id) noch
    // unassigned (verlangt zusaetzlich ein leeres assigned_to) — und bliebe
    // fuer eingeschraenkte Betrachter dauerhaft verwaist. Der API-Assign-Pfad
    // antwortet in derselben Lage mit team_member_not_found.
    if (!member) {
      return { status: 'error', port: 'error', message: 'Teammitglied nicht gefunden' };
    }
    if (member.linked_user_id) assignedToUserId = String(member.linked_user_id);
  }
  const result = await updateWorkflowMessage(trx, context, {
    assigned_to: teamMemberId,
    assigned_to_user_id: assignedToUserId,
    updated_at: now,
  });
  // Die Zuweisung kippt assigned_to_me, assigned_to_my_groups und
  // unassigned — fuer den bisherigen Zustaendigen ebenso wie fuer den neuen.
  // Ohne diese Meldung sieht ein eingeschraenkter Betrachter eine gerade
  // gesperrte, bereits geladene Nachricht bis zum naechsten Reload weiter.
  if (ports?.visibilityInvalidation) ports.visibilityInvalidation.assignmentChanged = true;
  return result ?? { status: 'ok', port: 'default', variables: { 'email.assigned_to': teamMemberId } };
}

async function readWorkflowTrackingEvidence(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht fuer Versandstatus vorhanden' };
  }
  const tracking = await trx
    .selectFrom('email_tracking_messages')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_id', '=', context.messageId)
    .executeTakeFirst();
  if (!tracking) {
    return {
      status: 'ok',
      port: 'default',
      message: 'tracking_not_configured_for_message',
      variables: { ...emailEvidenceWorkflowVariables({ tracked: false, events: [] }) },
    };
  }
  const summary = await loadEmailEvidenceSummaryForTracking(trx, context.workspaceId, tracking.id);
  return {
    status: 'ok',
    port: 'default',
    variables: {
      ...emailEvidenceSummaryWorkflowVariables({
        tracked: true,
        summary,
      }),
    },
  };
}

async function markWorkflowMessageSeen(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  const localResult = await updateWorkflowMessage(trx, context, { seen_local: true, updated_at: now });
  if (localResult) return localResult;

  const variables: WorkflowVariableContext = { 'email.seen': true };
  if (ports.workflowImapActions && context.messageId !== null) {
    if (ports.deferredImapEffects) {
      ports.deferredImapEffects.push({
        kind: 'set_seen',
        workspaceId: context.workspaceId,
        messageId: context.messageId,
      });
    } else {
      const remoteResult = await ports.workflowImapActions.setSeen({
        workspaceId: context.workspaceId,
        messageId: context.messageId,
        seen: true,
      });
      if (remoteResult.ok) {
        variables['imap.seen_synced'] = true;
        variables['imap.source_folder'] = remoteResult.sourceFolderPath;
      } else {
        variables['imap.seen_synced'] = false;
        log.push(`imap_seen_sync_failed:${remoteResult.error}`);
      }
    }
  }

  return { status: 'ok', port: 'default', variables };
}

async function evaluateWorkflowSenderFilter(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const useGlobalLists = booleanConfig(config.useGlobalLists, 'useGlobalLists', true);
  if (!useGlobalLists.ok) return { status: 'error', port: 'error', message: useGlobalLists.message };
  const useBuiltinTrusted = booleanConfig(config.useBuiltinTrusted, 'useBuiltinTrusted', true);
  if (!useBuiltinTrusted.ok) return { status: 'error', port: 'error', message: useBuiltinTrusted.message };

  const lists = useGlobalLists.value
    ? await loadWorkflowSenderLists(trx, context.workspaceId)
    : { whitelist: [], blacklist: [] };
  const result = evaluateSenderFilterFromLists(context.strings.from_address ?? '', {
    whitelist: lists.whitelist,
    blacklist: lists.blacklist,
    extraWhitelist: String(config.extraWhitelist ?? ''),
    extraBlacklist: String(config.extraBlacklist ?? ''),
    useBuiltinTrusted: useBuiltinTrusted.value,
  });

  return {
    status: 'ok',
    port: result,
    variables: { 'sender.filter': result },
  };
}

async function loadWorkflowSenderLists(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<{ whitelist: string[]; blacklist: string[] }> {
  const [whitelistRow, blacklistRow, spamListRows] = await Promise.all([
    trx
      .selectFrom('sync_info')
      .select('value')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', WORKFLOW_SENDER_WHITELIST_KEY)
      .executeTakeFirst(),
    trx
      .selectFrom('sync_info')
      .select('value')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', WORKFLOW_SENDER_BLACKLIST_KEY)
      .executeTakeFirst(),
    trx
      .selectFrom('email_spam_list_entries')
      .select(['list_type', 'pattern'])
      .where('workspace_id', '=', workspaceId)
      .where('account_id', 'is', null)
      .execute(),
  ]);

  const whitelist = [
    ...parseSenderList(whitelistRow?.value),
    ...senderPatternsFromSpamList(spamListRows, 'allow'),
  ];
  const blacklist = [
    ...parseSenderList(blacklistRow?.value),
    ...senderPatternsFromSpamList(spamListRows, 'block'),
  ];

  return { whitelist, blacklist };
}

function senderPatternsFromSpamList(
  rows: Array<{ list_type: string; pattern: string | null }>,
  listType: 'allow' | 'block',
): string[] {
  return rows
    .filter((row) => row.list_type === listType)
    .map((row) => String(row.pattern ?? '').trim().toLowerCase())
    .filter(Boolean);
}

type WorkflowEmailCategoryReference = {
  id: number;
  sourceSqliteId: number;
  parentId: number | null;
  parentSourceSqliteId: number | null;
  name: string;
};

/** Entfernte und neu gesetzte Kategorie in den Invalidierungs-Sammler legen. */
function recordCategoryInvalidation(
  ports: ServerWorkflowRuntimePorts | undefined,
  removed: ReadonlyArray<{ category_id: number | null }>,
  next: number | null,
): void {
  const target = ports?.visibilityInvalidation;
  if (!target) return;
  for (const row of removed) {
    if (row.category_id != null) target.categoryIds.add(Number(row.category_id));
  }
  if (next != null) target.categoryIds.add(Number(next));
}

async function setWorkflowMessageCategoryPath(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  path: string,
  now: Date,
  ports?: ServerWorkflowRuntimePorts,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { status: 'skipped', port: 'default' };
  if (parts.length > MAX_EMAIL_CATEGORY_DEPTH) {
    return {
      status: 'error',
      port: 'error',
      message: `Kategoriepfad zu tief (max. ${MAX_EMAIL_CATEGORY_DEPTH} Ebenen)`,
    };
  }

  let parent: WorkflowEmailCategoryReference | null = null;
  const fullPath: string[] = [];
  for (const part of parts) {
    fullPath.push(part);
    parent = await ensureWorkflowEmailCategory(trx, context.workspaceId, parent, part, fullPath, now);
  }
  if (!parent) return { status: 'skipped', port: 'default' };

  // Die Zuordnung wird ERSETZT — invalidiert werden muessen daher die entfernten
  // Kategorien genauso wie die neue: ein Allow-Filter auf der alten verliert die
  // Nachricht, ein Ausschlussfilter auf der neuen gewinnt sie.
  const removed = await trx
    .deleteFrom('email_message_categories')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .returning('category_id')
    .execute();
  recordCategoryInvalidation(ports, removed, parent.id);

  await trx
    .insertInto('email_message_categories')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedWorkflowMessageCategorySourceSqliteId(
        context.workspaceId,
        messageSourceSqliteId,
        parent.sourceSqliteId,
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      category_source_sqlite_id: parent.sourceSqliteId,
      message_id: context.messageId,
      category_id: parent.id,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'email.category_id': parent.id,
      'email.category_path': parts.join('/'),
    },
  };
}

/**
 * Resolves a category by its stable source_sqlite_id and assigns the message to
 * it. Rename-safe: the workflow stores the id, so renaming the category keeps it
 * pointed at the same one. Returns null when the category no longer exists, so
 * the caller can fall back to the configured path.
 */
async function setWorkflowMessageCategoryById(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  categorySourceSqliteId: number,
  now: Date,
  ports?: ServerWorkflowRuntimePorts,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const category = await loadWorkflowCategoryBySourceSqliteId(trx, context.workspaceId, categorySourceSqliteId);
  if (!category) return null;

  const messageSourceSqliteId = context.messageSourceSqliteId
    ?? await resolveMessageSourceSqliteId(trx, context.workspaceId, context.messageId);
  if (messageSourceSqliteId === null) {
    return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  }

  const removed = await trx
    .deleteFrom('email_message_categories')
    .where('workspace_id', '=', context.workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .returning('category_id')
    .execute();
  recordCategoryInvalidation(ports, removed, category.id);

  await trx
    .insertInto('email_message_categories')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: serverCreatedWorkflowMessageCategorySourceSqliteId(
        context.workspaceId,
        messageSourceSqliteId,
        category.sourceSqliteId,
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      category_source_sqlite_id: category.sourceSqliteId,
      message_id: context.messageId,
      category_id: category.id,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })
    .execute();

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'email.category_id': category.id,
      'email.category_path': category.path,
    },
  };
}

type WorkflowCategoryLookupRow = {
  id: number;
  sourceSqliteId: number;
  parentSourceSqliteId: number | null;
  name: string;
};

/** Loads a category by its stable source id and reconstructs its current full path. */
async function loadWorkflowCategoryBySourceSqliteId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  categorySourceSqliteId: number,
): Promise<{ id: number; sourceSqliteId: number; path: string } | null> {
  const rows = await trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id', 'parent_source_sqlite_id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .execute();
  const bySource = new Map<number, WorkflowCategoryLookupRow>();
  for (const row of rows) {
    bySource.set(Number(row.source_sqlite_id), {
      id: Number(row.id),
      sourceSqliteId: Number(row.source_sqlite_id),
      parentSourceSqliteId: row.parent_source_sqlite_id === null || row.parent_source_sqlite_id === undefined
        ? null
        : Number(row.parent_source_sqlite_id),
      name: String(row.name ?? ''),
    });
  }
  const start = bySource.get(categorySourceSqliteId);
  if (!start) return null;

  const path: string[] = [];
  const seen = new Set<number>();
  let current: WorkflowCategoryLookupRow | undefined = start;
  while (current && !seen.has(current.sourceSqliteId) && path.length < MAX_EMAIL_CATEGORY_DEPTH) {
    seen.add(current.sourceSqliteId);
    path.unshift(current.name);
    current = current.parentSourceSqliteId === null ? undefined : bySource.get(current.parentSourceSqliteId);
  }

  return { id: start.id, sourceSqliteId: categorySourceSqliteId, path: path.join('/') };
}

async function ensureWorkflowEmailCategory(
  trx: WorkspaceTransaction,
  workspaceId: string,
  parent: WorkflowEmailCategoryReference | null,
  name: string,
  fullPath: readonly string[],
  now: Date,
): Promise<WorkflowEmailCategoryReference> {
  let query = trx
    .selectFrom('email_categories')
    .select(['id', 'source_sqlite_id', 'parent_id', 'parent_source_sqlite_id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .where('name', '=', name);
  query = parent === null
    ? query.where('parent_id', 'is', null)
    : query.where('parent_id', '=', parent.id);

  const existing = await query.executeTakeFirst();
  if (existing) {
    return {
      id: Number(existing.id),
      sourceSqliteId: Number(existing.source_sqlite_id),
      parentId: existing.parent_id === null || existing.parent_id === undefined ? null : Number(existing.parent_id),
      parentSourceSqliteId: existing.parent_source_sqlite_id === null || existing.parent_source_sqlite_id === undefined
        ? null
        : Number(existing.parent_source_sqlite_id),
      name: String(existing.name ?? name),
    };
  }

  let childrenQuery = trx
    .selectFrom('email_categories')
    .select('sort_order')
    .where('workspace_id', '=', workspaceId);
  childrenQuery = parent === null
    ? childrenQuery.where('parent_id', 'is', null)
    : childrenQuery.where('parent_id', '=', parent.id);
  const siblings = await childrenQuery.execute();
  const maxSortOrder = siblings.reduce((max, row) => Math.max(max, Number(row.sort_order ?? -1)), -1);

  const row = await trx
    .insertInto('email_categories')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedWorkflowEmailCategorySourceSqliteId(workspaceId, fullPath),
      parent_source_sqlite_id: parent?.sourceSqliteId ?? null,
      parent_id: parent?.id ?? null,
      name,
      sort_order: maxSortOrder + 1,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();

  return {
    id: Number(row.id),
    sourceSqliteId: Number(row.source_sqlite_id),
    parentId: parent?.id ?? null,
    parentSourceSqliteId: parent?.sourceSqliteId ?? null,
    name,
  };
}

function authProtocolConfig(value: unknown): 'spf' | 'dkim' | 'dmarc' | 'arc' {
  const raw = String(value ?? 'dmarc').trim().toLowerCase();
  if (raw === 'spf' || raw === 'dkim' || raw === 'arc') return raw;
  return 'dmarc';
}

function serverCreatedWorkflowEmailCategorySourceSqliteId(
  workspaceId: string,
  fullPath: readonly string[],
): number {
  return serverCreatedSourceSqliteId(
    'email_categories',
    workspaceId,
    ...fullPath.map((part) => part.toLowerCase()),
  );
}

function serverCreatedWorkflowMessageCategorySourceSqliteId(
  workspaceId: string,
  messageSourceSqliteId: number,
  categorySourceSqliteId: number,
): number {
  return serverCreatedSourceSqliteId(
    'email_message_categories',
    workspaceId,
    String(messageSourceSqliteId),
    String(categorySourceSqliteId),
  );
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const MESSAGE_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'email.tag': handleEmailTag,
  tag: handleEmailTag,
  'email.set_category': handleEmailSetCategory,
  set_category: handleEmailSetCategory,
  'email.tag_attachment_meta': handleEmailTagAttachmentMeta,
  tag_attachment_meta: handleEmailTagAttachmentMeta,
  'email.set_priority': handleEmailSetPriority,
  'email.auth_check': handleEmailAuthCheck,
  'email.read_tracking_evidence': handleEmailReadTrackingEvidence,
  'email.sender_filter': handleEmailSenderFilter,
  'email.mark_seen': handleEmailMarkSeen,
  mark_seen: handleEmailMarkSeen,
  'email.archive': handleEmailArchive,
  archive: handleEmailArchive,
  'email.assign': handleEmailAssign,
};
