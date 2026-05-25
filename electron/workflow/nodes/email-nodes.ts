import {
  addMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageSpam,
  setMessageAssignedTo,
  setOutboundHold,
  getEmailAccountById,
} from '../../email/email-store';
import { evaluateSenderFilter } from '../sender-filter';
import { assignCategoryPathToMessage } from '../../email/email-crm-store';
import { sendSmtpForAccount } from '../../email/email-smtp';
import { syncSeenFlagToServer } from '../../email/email-imap-flags';
import { getDb } from '../../sqlite-service';
import { EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE } from '../../database-schema';
import type { RegisteredWorkflowNode, WorkflowContext } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

function requireMessage(ctx: WorkflowContext) {
  if (!ctx.message || ctx.messageId == null) throw new Error('Keine Nachricht im Kontext');
  return { row: ctx.message, messageId: ctx.messageId };
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
        setMessageSeenLocal(messageId, true);
        try {
          await syncSeenFlagToServer(row, true);
        } catch {
          /* best-effort */
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
      const acc = getEmailAccountById(row.account_id);
      if (!acc) return { status: 'error', message: 'Konto fehlt' };
      const dest = to.toLowerCase();
      const dup = getDb()
        .prepare(
          `SELECT 1 FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
        )
        .get(messageId, ctx.workflowId, dest);
      if (dup) return { status: 'ok', message: 'duplicate_skip' };
      const subj = row.subject ? `Fwd: ${row.subject}` : 'Weitergeleitet';
      const body = [row.body_text ?? row.snippet ?? '', '', '---', `Original: ${ctx.strings.from_address}`].join('\n');
      await sendSmtpForAccount(row.account_id, {
        from: acc.email_address,
        to,
        subject: subj,
        text: body.slice(0, 500_000),
      });
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} (message_id, workflow_id, dest) VALUES (?, ?, ?)`,
        )
        .run(messageId, ctx.workflowId, dest);
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
        setMessageSpam(messageId, spam);
        if (tag) addMessageTag(messageId, tag);
        if (config.moveImap === true && spam) {
          const { moveImapMessage } = await import('../../email/email-imap-move');
          await moveImapMessage(row, 'Spam');
        }
      }
      return { status: 'ok', variables: { 'email.is_spam': spam } };
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
      if (!isImapDeleteOptInEnabled()) {
        return {
          status: 'error',
          message: 'Opt-in workflow_imap_delete_opt_in in sync_info erforderlich',
        };
      }
      await deleteImapMessageOnServer(row);
      return { status: 'ok' };
    },
  });
}
