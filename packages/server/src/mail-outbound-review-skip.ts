import {
  OUTBOUND_REVIEW_SKIP_POLICY_KEY,
  outboundReviewSkippedKey,
  parseOutboundReviewSkipPolicy,
} from '@simplecrm/core';
import { sql, type Kysely, type RawBuilder } from 'kysely';

import type {
  EmailComposeSendInput,
  EmailOutboundReviewSkipApiPort,
} from './api/types';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';
import { outboundReviewApprovedKey, persistManualOutboundApproval } from './mail-outbound-approval-store';
import { parseDraftAttachmentPaths, recipientFieldFromJson } from './mail-scheduled-send';

/**
 * „Ohne Ausgangsprüfung senden“ (Teilautomatisierung P2): bereitet einen vom
 * Ausgang angehaltenen Entwurf für den normalen Sendepfad vor. Der Versand
 * selbst läuft über composeSender.send; die Ausgangsprüfung erkennt den hier
 * gesetzten Freigabe-Marker (Fingerprint des aktuellen Inhalts) und lässt die
 * Mail ohne erneuten Workflow-Durchlauf raus. Rolle/Einstellung und Mail-ACL
 * prüft die Route vorher.
 */
export function createPostgresOutboundReviewSkipPort(options: {
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): EmailOutboundReviewSkipApiPort {
  const now = () => options.now?.() ?? new Date();
  return {
    async readPolicy(input) {
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('sync_info')
          .select('value')
          .where('workspace_id', '=', input.workspaceId)
          .where('key', '=', OUTBOUND_REVIEW_SKIP_POLICY_KEY)
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      return parseOutboundReviewSkipPolicy(row?.value);
    },

    async prepare(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const at = now();
          const draft = await trx
            .selectFrom('email_messages')
            .select([
              'uid',
              'folder_kind',
              'soft_deleted',
              'outbound_hold',
              'subject',
              'body_text',
              'body_html',
              'to_json',
              'cc_json',
              'bcc_json',
              'draft_attachment_paths_json',
              'ticket_code',
              'account_id',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .forUpdate()
            .executeTakeFirst();
          if (!draft) return { ok: false as const, reason: 'not_found' as const };
          if (Number(draft.uid) >= 0 || draft.folder_kind !== 'draft' || draft.soft_deleted) {
            return { ok: false as const, reason: 'not_local_draft' as const };
          }
          if (draft.outbound_hold !== true) return { ok: false as const, reason: 'not_held' as const };

          const to = recipientFieldFromJson(draft.to_json);
          const cc = recipientFieldFromJson(draft.cc_json);
          const bcc = recipientFieldFromJson(draft.bcc_json);
          const attachmentPaths = parseDraftAttachmentPaths(draft.draft_attachment_paths_json);
          // Entfernt den Banner, setzt den Betreff mit Ticket, hebt die Sperre auf
          // und schreibt den Freigabe-Marker für genau diesen Inhalt.
          await persistManualOutboundApproval(trx, {
            workspaceId: input.workspaceId,
            draftId: input.messageId,
            subject: draft.subject ?? '',
            bodyText: draft.body_text ?? '',
            bodyHtml: draft.body_html,
            to,
            cc: cc || null,
            bcc: bcc || null,
            attachmentPaths,
            draftSnapshot: draft,
            now: at,
          });
          // Kein zusätzlicher Hintergrundversand: gesendet wird gleich synchron.
          await trx
            .updateTable('email_messages')
            .set({
              scheduled_send_at: null,
              scheduled_send_actor_user_id: null,
              scheduled_send_trusted_service_principal: null,
              updated_at: at,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .execute();
          // Übersprung-Marker = aktueller Freigabe-Marker. Nur solange beide
          // übereinstimmen, zählt der Versand als „Ausgangsprüfung übersprungen“
          // (eine spätere Änderung am Entwurf entwertet den Freigabe-Marker).
          const marker = await trx
            .selectFrom('sync_info')
            .select('value')
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', outboundReviewApprovedKey(input.messageId))
            .executeTakeFirst();
          await trx
            .insertInto('sync_info')
            .values({
              workspace_id: input.workspaceId,
              key: outboundReviewSkippedKey(input.messageId),
              value: marker?.value ?? null,
              last_updated: at,
              source_row: serverApiSourceRow(),
              imported_in_run_id: null,
              updated_at: at,
            })
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
              value: marker?.value ?? null,
              last_updated: at,
              updated_at: at,
            }))
            .execute();

          const updated = await trx
            .selectFrom('email_messages')
            .select([
              'account_id',
              'subject',
              'body_text',
              'body_html',
              'reply_parent_message_id',
              'tracking_override',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirstOrThrow();
          const values: EmailComposeSendInput = {
            accountId: Number(updated.account_id),
            draftMessageId: input.messageId,
            subject: updated.subject ?? '(Ohne Betreff)',
            bodyText: updated.body_text ?? '',
            ...(updated.body_html === null ? {} : { bodyHtml: updated.body_html }),
            to,
            ...(cc ? { cc } : {}),
            ...(bcc ? { bcc } : {}),
            ...(updated.reply_parent_message_id === null
              ? {}
              : { inReplyToMessageId: Number(updated.reply_parent_message_id) }),
            ...(updated.tracking_override === null ? {} : { trackingOverride: updated.tracking_override }),
            ...(attachmentPaths.length > 0 ? { attachmentPaths } : {}),
          };
          return { ok: true as const, values };
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return sql`'{"origin":"server_api"}'::jsonb`;
}
