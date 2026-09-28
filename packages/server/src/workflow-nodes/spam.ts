/**
 * Plan 043: Spam-Knoten (Spam-Score, Spam-Status, als Spam markieren).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  type SpamDecisionMessageInput,
  type SpamEngineSettings,
  type SpamFeatureStatInput,
  type SpamListMatch,
  buildFeaturePreview,
  buildSpamDecision,
} from '@simplecrm/core';
import type { WorkspaceTransaction } from '../db/workspace-context';
import {
  addWorkflowMessageTag,
  booleanConfig,
  extractWorkflowEmailAddress,
  finiteNumber,
  runWorkflowImapMoveAction,
  serverCreatedSourceSqliteId,
  serverWorkerSourceRow,
  spamStatusConfig,
  updateWorkflowMessage,
  workflowSpamStatusPatch,
} from './shared';
import type {
  MessageRow,
  NodeResult,
  ServerNodeHandler,
  ServerNodeHandlerArgs,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
  WorkflowVariableContext,
} from './types';

/** Knoten ai.spam_score. */
async function handleAiSpamScore({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await workflowAiSpamScoreResult(trx, context, config);
}

/** Knoten email.set_spam_status. */
async function handleEmailSetSpamStatus({ trx, context, config, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const train = booleanConfig(config.train, 'train', false);
  if (!train.ok) return { status: 'error', port: 'error', message: train.message };
  const status = spamStatusConfig(config.status);
  const tag = String(config.tag ?? '').trim();
  // Default false: gespeicherte Graphen kennen dieses Feld nicht — ein
  // stiller Default true würde in ihnen rückwirkend alle Folgeknoten und die
  // gesamte Inbound-Kette kappen. Stoppen ist ausdrücklich zu aktivieren.
  const stopFurther = booleanConfig(config.stopFurtherWorkflows, 'stopFurtherWorkflows', false);
  if (!stopFurther.ok) return { status: 'error', port: 'error', message: stopFurther.message };
  return await setWorkflowSpamStatus(trx, context, status, tag, train.value, now, {
    stopFurtherWorkflows: stopFurther.value,
    ports,
  });
}

/** Knoten email.mark_spam. */
async function handleEmailMarkSpam({ trx, context, config, log, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const train = booleanConfig(config.train, 'train', false);
  if (!train.ok) return { status: 'error', port: 'error', message: train.message };
  const spam = booleanConfig(config.spam, 'spam', true);
  if (!spam.ok) return { status: 'error', port: 'error', message: spam.message };
  const moveImap = booleanConfig(config.moveImap, 'moveImap', false);
  if (!moveImap.ok) return { status: 'error', port: 'error', message: moveImap.message };
  // Default false: gespeicherte Graphen kennen dieses Feld nicht — ein
  // stiller Default true würde in ihnen rückwirkend alle Folgeknoten und die
  // gesamte Inbound-Kette kappen. Stoppen ist ausdrücklich zu aktivieren.
  const stopFurther = booleanConfig(config.stopFurtherWorkflows, 'stopFurtherWorkflows', false);
  if (!stopFurther.ok) return { status: 'error', port: 'error', message: stopFurther.message };
  if (moveImap.value && spam.value) {
    const moveResult = await runWorkflowImapMoveAction(context, 'Spam', ports, log, 'email.mark_spam.move_imap', now);
    if (!moveResult.ok) return moveResult.node;
  }
  const tag = String(config.tag ?? 'auto-spam').trim();
  return await setWorkflowSpamStatus(trx, context, spam.value ? 'spam' : 'clean', tag, train.value, now, {
    stopFurtherWorkflows: stopFurther.value,
    ports,
  });
}

async function workflowAiSpamScoreResult(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const hasIgnoredDesktopAiConfig =
    (config.profileId !== null && config.profileId !== undefined && Number(config.profileId) > 0)
    || (typeof config.customPrompt === 'string' && config.customPrompt.trim().length > 0)
    || config.contextMode === 'full';
  const serverNote = hasIgnoredDesktopAiConfig
    ? 'Server: Profil/Prompt/contextMode werden ignoriert — es wird der gespeicherte oder lokal berechnete Spam-Score genutzt.'
    : '';
  const score = numericVariable(context.variables['spam.score']);
  const mode = String(config.contextMode ?? 'stored').trim() || 'stored';
  if (score !== null) {
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'ai.spam_score': score,
        'ai.spam_context': `stored:${mode}`,
        ...(serverNote ? { 'ai.spam_score.server_note': serverNote } : {}),
      },
    };
  }
  if (!context.message) {
    return { status: 'error', port: 'error', message: 'Kein gespeicherter Spam-Score' };
  }

  const input = workflowSpamDecisionInputFromMessage(context.message);
  const preview = buildFeaturePreview(input);
  const [settings, listMatch, featureStats] = await Promise.all([
    loadWorkflowSpamEngineSettings(trx, context.workspaceId),
    selectWorkflowSpamListMatch(trx, context.workspaceId, context.message),
    loadWorkflowSpamFeatureStatsForKeys(trx, context.workspaceId, preview.featureKeys),
  ]);
  const decision = buildSpamDecision(input, { settings, listMatch, featureStats });
  const firstReason = decision.reasons[0];
  const variables: WorkflowVariableContext = {
    'ai.spam_score': decision.score,
    'ai.spam_context': `computed:${mode}`,
    'spam.score': decision.score,
    'spam.status': decision.status,
    'spam.label': decision.status,
    'spam.recommendation': decision.status,
    'spam.source': decision.source,
    'spam.decision_source': decision.source,
    'spam.model_version': decision.modelVersion,
    'spam.feature_keys': decision.featureKeys.join(','),
    'spam.score_breakdown': JSON.stringify(decision),
  };
  if (decision.listMatch) variables['spam.list_match'] = decision.listMatch.listType;
  if (firstReason?.label) variables['spam.top_reason'] = firstReason.label;
  if (serverNote) variables['ai.spam_score.server_note'] = serverNote;
  return {
    status: 'ok',
    port: 'default',
    variables,
  };
}

function workflowSpamDecisionInputFromMessage(message: MessageRow): SpamDecisionMessageInput {
  return {
    fromJson: message.from_json,
    subject: message.subject,
    snippet: message.snippet,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    authSpf: message.auth_spf,
    authDkim: message.auth_dkim,
    authDmarc: message.auth_dmarc,
    authArc: message.auth_arc,
    attachmentsJson: message.attachments_json,
    hasAttachments: Boolean(message.has_attachments),
    rspamdScore: finiteNumber(message.rspamd_score),
    rspamdAction: message.rspamd_action,
  };
}

async function loadWorkflowSpamEngineSettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<SpamEngineSettings> {
  const keys = [
    'mail_security_rspamd_enabled',
    'mail_security_spam_engine_enabled',
    'mail_security_spam_review_threshold',
    'mail_security_spam_spam_threshold',
    'mail_security_spam_local_learning_enabled',
    'mail_security_spam_rspamd_contribution_enabled',
  ] as const;
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const rspamdEnabled = workflowSyncInfoFlag(values.get('mail_security_rspamd_enabled'), false);
  const review = workflowSyncInfoBoundedInt(values.get('mail_security_spam_review_threshold'), 45, 0, 100);
  const spam = Math.max(
    review,
    workflowSyncInfoBoundedInt(values.get('mail_security_spam_spam_threshold'), 75, 0, 100),
  );
  return {
    spamEngineEnabled: workflowSyncInfoFlag(values.get('mail_security_spam_engine_enabled'), true),
    spamReviewThreshold: review,
    spamSpamThreshold: spam,
    localLearningEnabled: workflowSyncInfoFlag(values.get('mail_security_spam_local_learning_enabled'), true),
    rspamdContributionEnabled: workflowSyncInfoFlag(
      values.get('mail_security_spam_rspamd_contribution_enabled'),
      rspamdEnabled,
    ),
  };
}

async function selectWorkflowSpamListMatch(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: MessageRow,
): Promise<SpamListMatch | null> {
  const senderEmail = extractWorkflowEmailAddress(message.from_json);
  const senderDomain = senderEmail ? workflowDomainOf(senderEmail) : '';
  if (!senderEmail && !senderDomain) return null;
  const rows = await trx
    .selectFrom('email_spam_list_entries')
    .select(['list_type', 'pattern_type', 'pattern', 'account_id'])
    .where('workspace_id', '=', workspaceId)
    .execute();
  let bestAllow: SpamListMatch | null = null;
  let bestBlock: SpamListMatch | null = null;
  const messageAccountId = message.account_id === null || message.account_id === undefined
    ? null
    : Number(message.account_id);
  for (const row of rows) {
    const rowAccountId = row.account_id === null || row.account_id === undefined
      ? null
      : Number(row.account_id);
    if (rowAccountId !== null && rowAccountId !== messageAccountId) continue;
    const listType = workflowSpamListType(row.list_type);
    const patternType = workflowSpamPatternType(row.pattern_type);
    const pattern = String(row.pattern ?? '').trim().toLowerCase();
    if (!listType || !patternType || !pattern) continue;
    const specificity = workflowSpamListEntrySpecificity(patternType, pattern, senderEmail, senderDomain);
    if (specificity <= 0) continue;
    const match: SpamListMatch = { listType, patternType, pattern, specificity };
    if (listType === 'allow') {
      if (!bestAllow || specificity > bestAllow.specificity) bestAllow = match;
    } else if (!bestBlock || specificity > bestBlock.specificity) {
      bestBlock = match;
    }
  }
  return bestAllow ?? bestBlock;
}

async function loadWorkflowSpamFeatureStatsForKeys(
  trx: WorkspaceTransaction,
  workspaceId: string,
  featureKeys: readonly string[],
): Promise<Map<string, SpamFeatureStatInput>> {
  const out = new Map<string, SpamFeatureStatInput>();
  const keys = [...new Set(featureKeys)];
  if (keys.length === 0) return out;
  const rows = await trx
    .selectFrom('email_spam_feature_stats')
    .select(['feature_key', 'spam_count', 'ham_count'])
    .where('workspace_id', '=', workspaceId)
    .where('feature_key', 'in', keys)
    .execute();
  for (const row of rows) {
    const featureKey = String(row.feature_key ?? '');
    if (!featureKey) continue;
    out.set(featureKey, {
      feature_key: featureKey,
      spam_count: Number(row.spam_count ?? 0),
      ham_count: Number(row.ham_count ?? 0),
    });
  }
  return out;
}

function workflowSyncInfoFlag(value: string | null | undefined, defaultOn: boolean): boolean {
  if (value == null || value === '') return defaultOn;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function workflowSyncInfoBoundedInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function workflowSpamListEntrySpecificity(
  patternType: 'email' | 'domain',
  pattern: string,
  senderEmail: string,
  domain: string,
): number {
  if (patternType === 'email') return senderEmail === pattern ? 100 : 0;
  if (domain === pattern) return 80;
  if (domain.endsWith(`.${pattern}`)) return 60;
  return 0;
}

function workflowSpamListType(value: unknown): 'allow' | 'block' | null {
  return value === 'allow' || value === 'block' ? value : null;
}

function workflowSpamPatternType(value: unknown): 'email' | 'domain' | null {
  return value === 'email' || value === 'domain' ? value : null;
}

function workflowDomainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

function numericVariable(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

async function setWorkflowSpamStatus(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  status: 'clean' | 'review' | 'spam',
  tag: string,
  train: boolean,
  now: Date,
  options: { stopFurtherWorkflows?: boolean; ports?: ServerWorkflowRuntimePorts } = {},
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const current = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id',
      'account_source_sqlite_id',
      'account_id',
      'folder_kind',
      'is_spam',
      'spam_status',
      'from_json',
      'subject',
      'snippet',
      'body_text',
      'body_html',
      'auth_spf',
      'auth_dkim',
      'auth_dmarc',
      'auth_arc',
      'attachments_json',
      'has_attachments',
    ])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (!current) return { status: 'error', port: 'error', message: 'Nachricht nicht gefunden' };
  const previous = { ...current };

  const result = await updateWorkflowMessage(trx, context, workflowSpamStatusPatch(
    status,
    String(current.folder_kind ?? 'inbox'),
    now,
  ));
  if (result) return result;

  if (tag) {
    const tagResult = await addWorkflowMessageTag(trx, context, tag, now, options.ports);
    if (tagResult) return tagResult;
  }

  if (train) {
    await trainWorkflowSpamStatus(trx, context.workspaceId, previous, status, now);
  }

  return {
    status: 'ok',
    port: 'default',
    variables: { 'email.is_spam': status === 'spam', 'spam.status': status },
    // Opt-in (=== true), nicht !== false: ohne gesetztes Feld darf nichts stoppen.
    ...(options.stopFurtherWorkflows === true && (status === 'spam' || status === 'review')
      ? { stop: true, inboundChainStop: true, message: 'stop_further_workflows:spam_status' }
      : {}),
  };
}

function workflowSpamLearningLabel(
  previous: string,
  next: 'clean' | 'review' | 'spam',
): 'spam' | 'ham' | null {
  if (next === 'spam' && previous !== 'spam') return 'spam';
  if (next === 'clean' && (previous === 'spam' || previous === 'review')) return 'ham';
  return null;
}

async function trainWorkflowSpamStatus(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: {
    id: unknown;
    source_sqlite_id?: unknown;
    account_source_sqlite_id?: unknown;
    account_id?: unknown;
    is_spam?: unknown;
    spam_status?: unknown;
    from_json?: unknown;
    subject?: string | null;
    snippet?: string | null;
    body_text?: string | null;
    body_html?: string | null;
    auth_spf?: string | null;
    auth_dkim?: string | null;
    auth_dmarc?: string | null;
    auth_arc?: string | null;
    attachments_json?: unknown;
    has_attachments?: unknown;
  },
  status: 'clean' | 'review' | 'spam',
  now: Date,
): Promise<void> {
  const previous = String(message.spam_status ?? (message.is_spam ? 'spam' : 'clean'));
  const label = workflowSpamLearningLabel(previous, status);
  const accountSourceSqliteId = Number(message.account_source_sqlite_id);
  if (!label || !Number.isFinite(accountSourceSqliteId)) return;

  const featureKeys = buildFeaturePreview({
    fromJson: message.from_json,
    subject: message.subject,
    snippet: message.snippet,
    bodyText: message.body_text,
    bodyHtml: message.body_html,
    authSpf: message.auth_spf,
    authDkim: message.auth_dkim,
    authDmarc: message.auth_dmarc,
    authArc: message.auth_arc,
    attachmentsJson: message.attachments_json,
    hasAttachments: message.has_attachments as boolean | number | string | null,
  }).featureKeys;
  const spamInc = label === 'spam' ? 1 : 0;
  const hamInc = label === 'ham' ? 1 : 0;

  await trx
    .insertInto('email_spam_learning_events')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedWorkflowSpamLearningEventSourceSqliteId(
        workspaceId,
        Number(message.source_sqlite_id ?? message.id),
        label,
        now,
      ),
      message_source_sqlite_id: Number(message.source_sqlite_id ?? message.id),
      account_source_sqlite_id: accountSourceSqliteId,
      message_id: Number(message.id),
      account_id: message.account_id === null || message.account_id === undefined ? null : Number(message.account_id),
      label,
      source: 'workflow',
      // jsonb column: stringify the array (matches postgres-mail-read-ports);
      // a raw JS array would serialize as a Postgres array literal and fail.
      feature_keys_json: featureKeys.length > 0 ? JSON.stringify([...featureKeys]) : null,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  for (const featureKey of featureKeys) {
    await trx
      .insertInto('email_spam_feature_stats')
      .values({
        workspace_id: workspaceId,
        feature_key: featureKey,
        spam_count: spamInc,
        ham_count: hamInc,
        source_row: serverWorkerSourceRow(),
        imported_in_run_id: null,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(['workspace_id', 'feature_key']).doUpdateSet((eb) => ({
        spam_count: eb('email_spam_feature_stats.spam_count', '+', spamInc),
        ham_count: eb('email_spam_feature_stats.ham_count', '+', hamInc),
        updated_at: now,
      })))
      .execute();
  }
}

function serverCreatedWorkflowSpamLearningEventSourceSqliteId(
  workspaceId: string,
  messageSourceSqliteId: number,
  label: 'spam' | 'ham',
  now: Date,
): number {
  return serverCreatedSourceSqliteId(
    'email_spam_learning_events',
    workspaceId,
    String(messageSourceSqliteId),
    label,
    now.toISOString(),
  );
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const SPAM_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'ai.spam_score': handleAiSpamScore,
  'email.set_spam_status': handleEmailSetSpamStatus,
  'email.mark_spam': handleEmailMarkSpam,
};
