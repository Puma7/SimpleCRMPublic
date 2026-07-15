import {
  getEmailMessageById,
  listMessagesPendingPostProcess,
  markMessagePostProcessDone,
} from './email-store';
import { assertInboundRfc822Base64Size } from '@simplecrm/core';

type ParsedAttachmentPart = {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: Buffer;
};
import { buildCustomerEmailMap, tryLinkMessageToCustomer } from './email-crm-store';
import { loadAppliedWorkflowIdsForMessage } from './email-workflow-store';

export type SyncNewMessageItem = {
  localMsgId: number;
  parsedAttachments: ParsedAttachmentPart[] | undefined;
  threading: {
    messageIdHeader: string | null;
    inReplyTo: string | null;
    referencesHeader: string | null;
    subject: string | null;
  };
};

/**
 * Post-insert work for newly synced messages: attachments, threading, CRM link, workflows.
 * Loads shared data once per sync batch instead of per message.
 */
export async function processNewMessagesAfterSync(
  accountId: number,
  items: SyncNewMessageItem[],
  folderId?: number,
  opts?: { runInboundWorkflows?: boolean },
): Promise<void> {
  const runInboundWorkflows = opts?.runInboundWorkflows !== false;
  const merged = [...items];
  if (folderId != null) {
    const pending = listMessagesPendingPostProcess(folderId);
    const seen = new Set(merged.map((i) => i.localMsgId));
    for (const p of pending) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push({
        localMsgId: p.id,
        parsedAttachments: undefined,
        threading: {
          messageIdHeader: p.message_id,
          inReplyTo: p.in_reply_to,
          referencesHeader: p.references_header,
          subject: p.subject,
        },
      });
    }
  }
  if (merged.length === 0) return;

  const { hasCompleteStoredAttachmentsForMessage, persistParsedAttachments } = await import('./email-message-attachments-store.js');
  const { assignJwzThreadAndTicket } = await import('./email-threading-jwz.js');
  const { runInboundWorkflowsForMessage } = await import('./email-workflow-engine.js');

  const customerByEmail = buildCustomerEmailMap();
  const failedPostProcessIds = new Set<number>();

  for (const item of merged) {
    try {
      let parsedAttachments = item.parsedAttachments;
      if (parsedAttachments === undefined) {
        const row = getEmailMessageById(item.localMsgId);
        if (row?.has_attachments) {
          if (!hasCompleteStoredAttachmentsForMessage(item.localMsgId, row.attachments_json)) {
            if (!row.raw_rfc822_b64) {
              throw new Error('raw RFC822 unavailable for attachment recovery');
            }
            assertInboundRfc822Base64Size(row.raw_rfc822_b64);
            const { simpleParser } = await import('mailparser');
            const parsed = await simpleParser(Buffer.from(row.raw_rfc822_b64, 'base64'));
            parsedAttachments = parsed.attachments;
          }
        }
      }
      await persistParsedAttachments(item.localMsgId, parsedAttachments);
    } catch (e) {
      failedPostProcessIds.add(item.localMsgId);
      console.warn(`[email] post-process attachments failed msg ${item.localMsgId}`, e);
    }
    try {
      assignJwzThreadAndTicket(item.localMsgId, accountId, item.threading);
      tryLinkMessageToCustomer(item.localMsgId, customerByEmail);
      const row = getEmailMessageById(item.localMsgId);
      if (row?.raw_headers) {
        const { getDb } = await import('../sqlite-service.js');
        const { detectAndFlagReadReceiptRequest } = await import('./email-read-receipt.js');
        const db = getDb();
        if (db) detectAndFlagReadReceiptRequest(db, item.localMsgId, row.raw_headers);
        const { detectPgpInbound } = await import('../pgp/pgp-service.js');
        detectPgpInbound(item.localMsgId);
        const { runCrossAccountThreadHeuristics } = await import('./email-thread-heuristics.js');
        runCrossAccountThreadHeuristics(item.localMsgId);
      }
    } catch (e) {
      failedPostProcessIds.add(item.localMsgId);
      console.warn(`[email] post-process threading/crm failed msg ${item.localMsgId}`, e);
    }
  }

  if (runInboundWorkflows) {
    for (const item of merged) {
      if (failedPostProcessIds.has(item.localMsgId)) continue;
      try {
        const row = getEmailMessageById(item.localMsgId);
        if (!row) continue;
        const appliedWorkflowIds = loadAppliedWorkflowIdsForMessage(item.localMsgId);
        await runInboundWorkflowsForMessage(item.localMsgId, {
          row,
          appliedWorkflowIds,
        });
        markMessagePostProcessDone(item.localMsgId);
      } catch (e) {
        console.warn(`[email] post-process workflows failed msg ${item.localMsgId}`, e);
      }
    }
  } else {
    for (const item of merged) {
      if (!failedPostProcessIds.has(item.localMsgId)) {
        markMessagePostProcessDone(item.localMsgId);
      }
    }
  }
}
