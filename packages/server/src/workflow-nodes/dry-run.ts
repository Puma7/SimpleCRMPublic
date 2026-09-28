/**
 * Plan 043: Testlauf (Dry-Run) – Ergebnisse für Knoten mit Seiteneffekten.
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  LOGIC_INMEMORY_NODE_TYPES,
  READ_ONLY_WORKFLOW_NODE_TYPES,
  type WorkflowGraphNode,
  listBuiltinWorkflowNodeCatalog,
} from '@simplecrm/core';
import { isServerWorkflowNodeTypeSupported } from '../workflow-node-catalog';
import { booleanConfig, spamStatusConfig, unsupportedWorkflowNodeResult } from './shared';
import type { NodeResult, WorkflowVariableContext } from './types';

/**
 * Knotentypen, die im Dry-Run nach dryRunMutatingNodeResult live laufen. Die
 * Vorschau committet unter der System-Rolle; eine reine Denylist liess den
 * Vorlagen-Alias set_category und ai.pick_canned live laufen (C-A64). Alles,
 * was weder hier steht noch simuliert wird, faellt auf
 * dryRunFailClosedResult — ein neuer schreibender Knoten wirkt so in der
 * Vorschau nie live.
 */
export const DRY_RUN_LIVE_NODE_TYPES: ReadonlySet<string> = new Set([
  ...READ_ONLY_WORKFLOW_NODE_TYPES,
  ...LOGIC_INMEMORY_NODE_TYPES,
  // Eigener Dry-Run-Zweig in executeServerNode.
  'logic.delay',
  'ai.draft_reply',
  'ai.review_draft',
  'email.release_outbound',
  'email.send_draft',
  // Nur Auswertung bzw. Halte-Ergebnis, kein Schreibzugriff.
  'email.hold_outbound',
  'hold_outbound',
  'email.auto_reply',
  'ai.spam_score',
  'ai.agent_tool',
  // Lesen live aus dem externen ERP. Ob die Vorschau das darf, ist eine offene
  // Produktentscheidung; bis dahin bleibt das bisherige Verhalten.
  'mssql.query',
  'jtl.order_context',
]);

/**
 * Knoten ohne Live-Freigabe und ohne eigene Simulation: Bekannte Server-Knoten
 * werden simuliert, unbekannte und nicht serverfaehige bleiben wie im echten
 * Lauf "nicht unterstuetzt".
 */
export function dryRunFailClosedResult(type: string, log: string[]): NodeResult {
  const knownServerNode = isServerWorkflowNodeTypeSupported(type)
    && listBuiltinWorkflowNodeCatalog().some((entry) => entry.type === type);
  return knownServerNode ? dryRunSideEffectResult(type, log) : unsupportedWorkflowNodeResult(type, log);
}

export function dryRunMutatingNodeResult(
  type: string,
  config: Record<string, unknown>,
  node: WorkflowGraphNode,
  log: string[],
): NodeResult | null {
  switch (type) {
    case 'ai.reply_suggestion':
      return dryRunSideEffectResult(type, log, {
        variables: { 'reply_suggestion.status': 'dry_run' },
      });
    case 'ai.outbound_review':
    case 'ai.review':
    case 'ai_review':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.review.status': 'dry_run',
      });
    case 'ai.classify':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.classification.status': 'dry_run',
      });
    case 'ai.transform_text':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.transform_text.status': 'dry_run',
      });
    case 'ai.agent':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.agent.status': 'dry_run',
      });
    case 'ai.pick_canned':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'ai.pick_canned.status': 'dry_run',
      });
    case 'email.tag':
    case 'tag': {
      const tag = String(config.tag ?? node.data.tag ?? '').trim();
      return tag
        ? dryRunSideEffectResult(type, log, { variables: { 'email.last_tag': tag } })
        : { status: 'skipped', port: 'default', message: 'leerer Tag' };
    }
    case 'email.set_category':
    case 'set_category': {
      const path = String(config.path ?? '').trim();
      return path
        ? dryRunSideEffectResult(type, log, { variables: { 'email.category_path': path } })
        : { status: 'skipped', port: 'default' };
    }
    case 'email.tag_attachment_meta':
    case 'tag_attachment_meta': {
      const tag = String(config.tag ?? node.data.tag ?? 'attachment').trim() || 'attachment';
      return dryRunSideEffectResult(type, log, { variables: { 'email.last_tag': tag } });
    }
    case 'email.create_draft':
      return dryRunSideEffectResult(type, log, { variables: { 'draft.status': 'dry_run' } });
    case 'email.set_priority': {
      const level = String(config.level ?? 'normal').toLowerCase();
      const allowed = new Set(['hoch', 'high', 'normal', 'niedrig', 'low']);
      if (!allowed.has(level)) return { status: 'error', port: 'error', message: 'level muss hoch, normal oder niedrig sein' };
      const tag = level === 'hoch' || level === 'high'
        ? 'priority:hoch'
        : level === 'niedrig' || level === 'low'
          ? 'priority:niedrig'
          : 'priority:normal';
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.priority': tag, 'email.last_tag': tag },
      });
    }
    case 'email.mark_seen':
    case 'mark_seen':
      return dryRunSideEffectResult(type, log, { variables: { 'email.seen': true } });
    case 'email.archive':
    case 'archive':
      return dryRunSideEffectResult(type, log, { variables: { 'email.archived': true } });
    case 'email.set_spam_status': {
      const status = spamStatusConfig(config.status);
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.is_spam': status === 'spam', 'spam.status': status },
      });
    }
    case 'email.mark_spam': {
      const spam = booleanConfig(config.spam, 'spam', true);
      if (!spam.ok) return { status: 'error', port: 'error', message: spam.message };
      return dryRunSideEffectResult(type, log, {
        variables: { 'email.is_spam': spam.value, 'spam.status': spam.value ? 'spam' : 'clean' },
      });
    }
    case 'email.move_imap':
      return dryRunSideEffectResult(type, log, {
        variables: { 'imap.moved_to': String(config.folderPath ?? config.folder ?? config.targetFolderPath ?? 'Spam') },
      });
    case 'email.delete_server':
      return dryRunSideEffectResult(type, log, { variables: { 'imap.deleted': true } });
    case 'email.assign': {
      const raw = config.teamMemberId;
      const teamMemberId = raw === null || raw === undefined || raw === '' ? null : String(raw).trim();
      if (teamMemberId !== null && !teamMemberId) return { status: 'error', port: 'error', message: 'teamMemberId leer' };
      return dryRunSideEffectResult(type, log, { variables: { 'email.assigned_to': teamMemberId } });
    }
    case 'crm.create_task':
      return dryRunSideEffectResult(type, log, { variables: { 'task.status': 'dry_run' } });
    case 'crm.log_activity':
      return dryRunSideEffectResult(type, log, { variables: { 'activity_log.status': 'dry_run' } });
    case 'crm.update_deal':
      return dryRunSideEffectResult(type, log, { variables: { 'deal.status': 'dry_run' } });
    case 'crm.link_customer':
    case 'link_customer':
      return dryRunSideEffectResult(type, log, { variables: { 'customer.link_status': 'dry_run' } });
    case 'sync.run':
      return dryRunSideEffectResult(type, log, { variables: { 'sync.status': 'dry_run' } });
    case 'email.forward_copy':
    case 'forward_copy':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'forward_copy.status': 'dry_run',
      });
    case 'email.ingest_dmarc_report':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'dmarc.status': 'dry_run',
      });
    case 'http.request':
      return dryRunAsyncContinuationResult(type, config, node, log, {
        'http.status': 'dry_run',
      });
    case 'workflow.subflow':
      return dryRunSideEffectResult(type, log, { variables: { 'subflow.status': 'dry_run' } });
    // returns.evaluate is intentionally NOT listed: it is read-only and runs live
    // even in dry-run so the previewed routing port reflects the real decision.
    case 'returns.offer_exchange':
      return dryRunSideEffectResult(type, log, { variables: { 'returns.outcome': 'exchange' } });
    case 'returns.offer_credit':
      return dryRunSideEffectResult(type, log, { variables: { 'returns.outcome': 'credit' } });
    default:
      return null;
  }
}

export function dryRunAsyncContinuationResult(
  type: string,
  config: Record<string, unknown>,
  node: WorkflowGraphNode,
  log: string[],
  variables: WorkflowVariableContext,
): NodeResult {
  const resumeNodeId = String(config.resumeNodeId ?? '').trim() || '';
  return dryRunSideEffectResult(type, log, {
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    variables: {
      ...variables,
      ...(resumeNodeId ? { 'workflow.resume_node_id': resumeNodeId } : {}),
      'workflow.node_id': node.id,
    },
  });
}

export function dryRunSideEffectResult(
  type: string,
  log: string[],
  options: Partial<Pick<NodeResult, 'stop' | 'deferred' | 'message' | 'variables'>> = {},
): NodeResult {
  const message = options.message ?? `dry_run:${type}`;
  log.push(message);
  return {
    status: 'ok',
    port: 'default',
    message,
    ...(options.stop === undefined ? {} : { stop: options.stop }),
    ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
    ...(options.variables === undefined ? {} : { variables: options.variables }),
  };
}
