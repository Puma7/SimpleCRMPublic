import {
  addMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
  setOutboundHold,
  getEmailAccountById,
} from '../../email/email-store';
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
