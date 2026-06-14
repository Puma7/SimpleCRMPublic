import {
  addMessageTag,
  clearMessageSeenSyncPending,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageSpam,
  setMessageSpamStatus,
  setMessageAssignedTo,
  setOutboundHold,
  getEmailAccountById,
} from '../../email/email-store';
import { evaluateSenderFilter } from '../sender-filter';
import { AUTO_REPLY_NOREPLY_RE, loadAutoReplyEnabled } from '../auto-reply-settings';
import { prepareDraftForWorkflowSend, releaseOutboundHoldForDraft } from '../draft-send-prep';
import { assignCategoryPathToMessage } from '../../email/email-crm-store';
import type { RegisteredWorkflowNode, WorkflowContext } from '../types';
import type { SpamStatus } from '../../email/email-spam-types';

type Reg = (def: RegisteredWorkflowNode) => void;

function requireMessage(ctx: WorkflowContext) {
  if (!ctx.message || ctx.messageId == null) throw new Error('Keine Nachricht im Kontext');
  return { row: ctx.message, messageId: ctx.messageId };
}

function shouldSyncSeenStateToServer(row: { account_id?: number | null }): boolean {
  const accountId = row.account_id;
  if (accountId == null) return false;
  const account = getEmailAccountById(accountId);
  return (
    account != null &&
    (account.protocol || 'imap') === 'imap' &&
    (account.imap_sync_seen_on_open ?? 1) !== 0
  );
}

export function registerEmailNodes(register: Reg): void {
  register({
    type: 'email.tag',
    label: 'Tag setzen',
    category: 'email',
    canvasType: 'action',
    defaultConfig: { tag: '' },
    execute: async (ctx, config) => {
      const { messageId } = requireMessage(ctx);
      const tag = String(config.tag ?? '').trim();
      if (!tag) return { status: 'skipped', message: 'leerer Tag' };
      if (!ctx.dryRun) addMessageTag(messageId, tag);
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.mark_seen',
    label: 'Als gelesen markieren',
    category: 'email',
    canvasType: 'action',
    execute: async (ctx) => {
      const { row, messageId } = requireMessage(ctx);
      if (!ctx.dryRun) {
        const syncToServer = shouldSyncSeenStateToServer(row);
        setMessageSeenLocal(messageId, true, syncToServer);
        if (syncToServer) {
          try {
            const { syncSeenFlagToServer } = await import('../../email/email-imap-flags');
            await syncSeenFlagToServer(row, true);
            clearMessageSeenSyncPending(messageId);
          } catch {
            /* best-effort */
          }
        }
      }
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.archive',
    label: 'Archivieren',
    category: 'email',
    canvasType: 'action',
    execute: async (ctx) => {
      const { messageId } = requireMessage(ctx);
      if (!ctx.dryRun) setMessageArchived(messageId, true);
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.hold_outbound',
    label: 'Versand sperren',
    category: 'email',
    canvasType: 'action',
    defaultConfig: { reason: '' },
    execute: async (ctx, config) => {
      const id = ctx.messageId ?? ctx.outbound?.messageId;
      if (id == null) return { status: 'error', message: 'Keine Nachricht/Entwurf' };
      const reason = String(config.reason ?? 'Workflow');
      if (!ctx.dryRun) setOutboundHold(id, true, reason);
      return { status: 'ok', blocked: true, blockReason: reason };
    },
  });

  register({
    type: 'email.set_category',
    label: 'Kategorie setzen',
    category: 'email',
    canvasType: 'action',
    defaultConfig: { path: '' },
    execute: async (ctx, config) => {
      const { messageId } = requireMessage(ctx);
      const path = String(config.path ?? '').trim();
      if (!path) return { status: 'skipped' };
      if (!ctx.dryRun) assignCategoryPathToMessage(messageId, path);
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.forward_copy',
    label: 'Kopie weiterleiten',
    category: 'email',
    canvasType: 'action',
    defaultConfig: { to: '' },
    execute: async (ctx, config) => {
      const { row, messageId } = requireMessage(ctx);
      const to = String(config.to ?? '').trim();
      if (!to) return { status: 'skipped' };
      if (ctx.dryRun) return { status: 'ok', message: `dry-run forward ${to}` };
      const subj = row.subject ? `Fwd: ${row.subject}` : 'Weitergeleitet';
      const body = [row.body_text ?? row.snippet ?? '', '', '---', `Original: ${ctx.strings.from_address}`].join('\n');
      const { sendWorkflowForwardCopy } = await import('../../email/email-forward-copy');
      const sent = await sendWorkflowForwardCopy({
        accountId: row.account_id,
        sourceMessageId: messageId,
        workflowId: ctx.workflowId,
        to,
        subject: subj,
        bodyText: body,
        originalFromLine: ctx.strings.from_address,
        includeAttachments: config.includeAttachments === true,
        runOutboundReview: config.runOutboundReview === true,
      });
      if (!sent.ok) {
        return { status: 'error', message: sent.reason };
      }
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.tag_attachment_meta',
    label: 'Tag bei Anhang',
    category: 'email',
    canvasType: 'action',
    defaultConfig: { tag: 'attachment' },
    execute: async (ctx, config) => {
      const { row, messageId } = requireMessage(ctx);
      if (!row.has_attachments) return { status: 'skipped' };
      const tag = String(config.tag ?? 'attachment');
      if (!ctx.dryRun) addMessageTag(messageId, tag);
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.create_draft',
    label: 'Antwort-Entwurf erstellen',
    category: 'email',
    canvasType: 'registry',
    defaultConfig: { bodyPrefix: '' },
    execute: async (ctx, config) => {
      const { row } = requireMessage(ctx);
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run draft' };
      const { createComposeDraft } = await import('../../email/email-store');
      const prefix = String(config.bodyPrefix ?? '');
      const body = `${prefix}\n\n---\n${ctx.strings.combined_text}`.trim();
      const id = createComposeDraft({
        accountId: row.account_id,
        subject: row.subject?.startsWith('Re:') ? row.subject : `Re: ${row.subject ?? ''}`,
        bodyText: body,
      });
      return { status: 'ok', variables: { 'draft.id': id } };
    },
  });

  register({
    type: 'email.set_priority',
    label: 'Priorität setzen',
    category: 'email',
    canvasType: 'registry',
    description: 'Setzt Tags priority:hoch, priority:normal oder priority:niedrig für Sortierung/Filter.',
    defaultConfig: { level: 'normal' },
    execute: async (ctx, config) => {
      const { messageId } = requireMessage(ctx);
      const level = String(config.level ?? 'normal').toLowerCase();
      const allowed = new Set(['hoch', 'high', 'normal', 'niedrig', 'low']);
      if (!allowed.has(level)) {
        return { status: 'error', message: 'level muss hoch, normal oder niedrig sein' };
      }
      const tag =
        level === 'hoch' || level === 'high'
          ? 'priority:hoch'
          : level === 'niedrig' || level === 'low'
            ? 'priority:niedrig'
            : 'priority:normal';
      if (!ctx.dryRun) addMessageTag(messageId, tag);
      return { status: 'ok', variables: { 'email.priority': tag } };
    },
  });

  register({
    type: 'email.auth_check',
    label: 'Auth-Prüfung (SPF/DKIM/DMARC/ARC)',
    category: 'email',
    canvasType: 'registry',
    description:
      'Verzweigt nach gespeicherten mailauth-Ergebnissen (nach Sync). Kanten: pass | fail | none | default.',
    defaultConfig: { protocol: 'dmarc', treatSoftfailAsFail: true },
    execute: async (ctx, config) => {
      const protocol = String(config.protocol ?? 'dmarc').toLowerCase();
      const key =
        protocol === 'spf'
          ? 'auth.spf'
          : protocol === 'dkim'
            ? 'auth.dkim'
            : protocol === 'arc'
              ? 'auth.arc'
              : 'auth.dmarc';
      const value = String(ctx.variables[key] ?? 'none').toLowerCase();
      const softIsFail = config.treatSoftfailAsFail !== false;
      const failSet = new Set(['fail', 'permerror', ...(softIsFail ? ['softfail', 'policy'] : [])]);
      let port: string;
      if (value === 'pass') port = 'pass';
      else if (failSet.has(value)) port = 'fail';
      else if (value === 'none' || value === 'neutral' || value === 'skipped') port = 'none';
      else port = 'default';
      return {
        status: 'ok',
        port,
        variables: { [`auth.check.${protocol}`]: value },
      };
    },
  });

  register({
    type: 'email.sender_filter',
    label: 'Absender-Filter',
    category: 'email',
    canvasType: 'registry',
    description:
      'Whitelist/Blacklist und bekannte Absender (PayPal, Amazon, …) vor KI-Spam-Prüfung. Kanten: whitelist | blacklist | default.',
    defaultConfig: {
      useGlobalLists: true,
      useBuiltinTrusted: true,
      extraWhitelist: '',
      extraBlacklist: '',
    },
    execute: async (ctx, config) => {
      const from = ctx.strings.from_address ?? '';
      const result = evaluateSenderFilter(from, {
        useGlobalLists: config.useGlobalLists !== false,
        useBuiltinTrusted: config.useBuiltinTrusted !== false,
        extraWhitelist: String(config.extraWhitelist ?? ''),
        extraBlacklist: String(config.extraBlacklist ?? ''),
      });
      return {
        status: 'ok',
        port: result,
        variables: { 'sender.filter': result },
      };
    },
  });

  register({
    type: 'email.set_spam_status',
    label: 'Spam-Status setzen',
    category: 'email',
    canvasType: 'registry',
    description: 'Setzt den lokalen Spam-Status: clean, review oder spam.',
    defaultConfig: { status: 'review', train: false, tag: '' },
    execute: async (ctx, config) => {
      const { messageId } = requireMessage(ctx);
      const raw = String(config.status ?? 'review').toLowerCase();
      const status: SpamStatus =
        raw === 'spam' || raw === 'clean' || raw === 'review' ? raw : 'review';
      const tag = String(config.tag ?? '').trim();
      if (!ctx.dryRun) {
        setMessageSpamStatus(messageId, status, {
          train: config.train === true,
          source: 'workflow',
        });
        if (tag) addMessageTag(messageId, tag);
      }
      return {
        status: 'ok',
        variables: { 'email.is_spam': status === 'spam', 'spam.status': status },
      };
    },
  });

  register({
    type: 'email.mark_spam',
    label: 'Als Spam markieren',
    category: 'email',
    canvasType: 'registry',
    defaultConfig: { spam: true, tag: 'auto-spam', moveImap: false },
    execute: async (ctx, config) => {
      const { row, messageId } = requireMessage(ctx);
      const spam = config.spam !== false;
      const tag = String(config.tag ?? 'auto-spam').trim();
      if (!ctx.dryRun) {
        setMessageSpam(messageId, spam, { train: config.train === true, source: 'workflow' });
        if (tag) addMessageTag(messageId, tag);
        if (config.moveImap === true && spam) {
          const { moveImapMessage } = await import('../../email/email-imap-move');
          await moveImapMessage(row, 'Spam');
        }
      }
      return {
        status: 'ok',
        variables: { 'email.is_spam': spam, 'spam.status': spam ? 'spam' : 'clean' },
      };
    },
  });

  register({
    type: 'email.assign',
    label: 'Mitarbeiter zuweisen',
    category: 'email',
    canvasType: 'registry',
    defaultConfig: { teamMemberId: '' },
    execute: async (ctx, config) => {
      const { messageId } = requireMessage(ctx);
      const raw = config.teamMemberId;
      const teamMemberId =
        raw === null || raw === undefined || raw === ''
          ? null
          : String(raw).trim();
      if (teamMemberId !== null && !teamMemberId) {
        return { status: 'error', message: 'teamMemberId leer' };
      }
      if (!ctx.dryRun) setMessageAssignedTo(messageId, teamMemberId);
      return {
        status: 'ok',
        variables: { 'email.assigned_to': teamMemberId },
      };
    },
  });

  register({
    type: 'email.move_imap',
    label: 'IMAP verschieben',
    category: 'email',
    canvasType: 'registry',
    defaultConfig: { folderPath: 'Spam' },
    execute: async (ctx, config) => {
      const { row, messageId } = requireMessage(ctx);
      const folderPath = String(config.folderPath ?? 'Spam').trim();
      if (!folderPath) return { status: 'skipped', message: 'Zielordner leer' };
      if (ctx.dryRun) return { status: 'ok', message: `dry-run move ${folderPath}` };
      const { moveImapMessage } = await import('../../email/email-imap-move');
      await moveImapMessage(row, folderPath);
      return { status: 'ok', variables: { 'imap.moved_to': folderPath, messageId } };
    },
  });

  register({
    type: 'email.delete_server',
    label: 'Auf Server löschen',
    category: 'email',
    canvasType: 'registry',
    defaultConfig: {},
    execute: async (ctx, config) => {
      const { row } = requireMessage(ctx);
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run delete' };
      const { deleteImapMessageOnServer, isImapDeleteOptInEnabled } = await import(
        '../../email/email-imap-move'
      );
      if (!isImapDeleteOptInEnabled(row.account_id)) {
        return {
          status: 'error',
          message: 'IMAP-Server-Löschung für dieses Konto nicht aktiviert',
        };
      }
      await deleteImapMessageOnServer(row);
      return { status: 'ok' };
    },
  });

  register({
    type: 'email.auto_reply',
    label: 'Auto-Antwort (Gate)',
    category: 'email',
    canvasType: 'registry',
    description:
      'Entscheidet, ob automatisch geantwortet werden darf (Schalter + Confidence + Anti-Loop). Sendet selbst nichts.',
    defaultConfig: { confidenceVar: 'ai.class_confidence', minConfidence: 70 },
    execute: async (ctx, config) => {
      const confidenceVar =
        String(config.confidenceVar ?? 'ai.class_confidence').trim() || 'ai.class_confidence';
      const minConfidence = Math.max(0, Math.min(100, Number(config.minConfidence ?? 70) || 70));
      const rawConfidence = ctx.variables[confidenceVar];
      const confidence =
        typeof rawConfidence === 'number'
          ? rawConfidence
          : Number.parseFloat(String(rawConfidence ?? ''));
      const confidenceValue = Number.isFinite(confidence) ? confidence : 0;
      const sender = ctx.strings.from_address?.split(',')[0]?.trim() ?? '';

      const block = (reason: string) => ({
        status: 'ok' as const,
        port: 'blocked' as const,
        message: `auto_reply:blocked:${reason}`,
        variables: {
          'auto_reply.decision': 'blocked',
          'auto_reply.blocked_reason': reason,
          'auto_reply.confidence': confidenceValue,
        },
      });

      if (!ctx.message) return block('no_message');
      if (ctx.dryRun) {
        return confidenceValue >= minConfidence
          ? {
              status: 'ok',
              port: 'approved',
              variables: {
                'auto_reply.decision': 'approved',
                'auto_reply.confidence': confidenceValue,
              },
            }
          : block('low_confidence');
      }
      if (!loadAutoReplyEnabled()) return block('disabled');
      if (!sender || AUTO_REPLY_NOREPLY_RE.test(sender)) return block('noreply_sender');
      if (confidenceValue < minConfidence) return block('low_confidence');

      return {
        status: 'ok',
        port: 'approved',
        message: 'auto_reply:approved',
        variables: {
          'auto_reply.decision': 'approved',
          'auto_reply.confidence': confidenceValue,
        },
      };
    },
  });

  register({
    type: 'email.release_outbound',
    label: 'Versand freigeben',
    category: 'email',
    canvasType: 'registry',
    description:
      'Hebt die Ausgangssperre auf. Mit autoSend=true wird der Entwurf zur sofortigen Zustellung eingeplant.',
    defaultConfig: { autoSend: true },
    execute: async (ctx, config) => {
      if (ctx.direction !== 'outbound') {
        return { status: 'skipped', message: 'Nur für ausgehende Nachrichten' };
      }
      const id = ctx.messageId ?? ctx.outbound?.messageId;
      if (id == null) return { status: 'error', message: 'Keine Nachricht im Kontext' };
      const autoSend = config.autoSend === true;
      const r = releaseOutboundHoldForDraft(id, autoSend, ctx.dryRun);
      if (!r.ok) return { status: 'error', message: r.message };
      return {
        status: 'ok',
        message: autoSend ? 'outbound_hold_released_auto_send' : 'outbound_hold_released',
        variables: {
          'email.outbound_hold': false,
          'email.auto_send_scheduled': r.autoSendScheduled,
        },
      };
    },
  });

  register({
    type: 'email.send_draft',
    label: 'Entwurf versenden (vollautomatisch)',
    category: 'email',
    canvasType: 'registry',
    description:
      'Plant den Versand eines zuvor angelegten Entwurfs (draft.id). runOutboundReview=false sendet ohne erneute Outbound-Prüfung.',
    defaultConfig: { draftIdVariable: 'draft.id', runOutboundReview: false },
    execute: async (ctx, config) => {
      const draftIdVar = String(config.draftIdVariable ?? 'draft.id').trim() || 'draft.id';
      const rawId = config.draftId ?? ctx.variables[draftIdVar];
      const draftId = Number(rawId);
      if (!Number.isFinite(draftId) || draftId <= 0) {
        return {
          status: 'error',
          message: `Keine gültige Entwurfs-ID unter ${draftIdVar} oder config.draftId`,
        };
      }

      if (ctx.direction === 'inbound') {
        if (!ctx.dryRun && !loadAutoReplyEnabled()) {
          return { status: 'skipped', message: 'auto_reply_disabled' };
        }
        const sender = ctx.strings.from_address?.split(',')[0]?.trim() ?? '';
        if (!ctx.dryRun && (!sender || AUTO_REPLY_NOREPLY_RE.test(sender))) {
          return { status: 'skipped', message: 'noreply_sender_blocked' };
        }
      }

      const runOutboundReview = config.runOutboundReview === true;
      const prep = prepareDraftForWorkflowSend(draftId, {
        runOutboundReview,
        dryRun: ctx.dryRun,
      });
      if (!prep.ok) return { status: 'error', message: prep.message };

      return {
        status: 'ok',
        message: runOutboundReview ? 'send_draft_queued_with_review' : 'send_draft_queued_auto',
        variables: {
          'send_draft.draft_id': draftId,
          'send_draft.with_review': runOutboundReview,
          'email.auto_send_scheduled': !ctx.dryRun,
        },
      };
    },
  });
}
