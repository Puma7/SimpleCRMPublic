import { getEmailMessageById } from './email-store';

type ParsedAttachmentPart = {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: Buffer;
};
import { buildCustomerEmailMap, tryLinkMessageToCustomer } from './email-crm-store';
import {
  listWorkflowsByTrigger,
  loadAppliedWorkflowIdsForMessage,
} from './email-workflow-store';

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
): Promise<void> {
  if (items.length === 0) return;

  const { persistParsedAttachments } = await import('./email-message-attachments-store');
  const { assignJwzThreadAndTicket } = await import('./email-threading-jwz');
  const { runInboundWorkflowsForMessage } = await import('./email-workflow-engine');

  const customerByEmail = buildCustomerEmailMap();
  const inboundWorkflows = listWorkflowsByTrigger('inbound');

  for (const item of items) {
    await persistParsedAttachments(item.localMsgId, item.parsedAttachments);
    assignJwzThreadAndTicket(item.localMsgId, accountId, item.threading);
    tryLinkMessageToCustomer(item.localMsgId, customerByEmail);
  }

  for (const item of items) {
    const row = getEmailMessageById(item.localMsgId);
    if (!row) continue;
    const appliedWorkflowIds = loadAppliedWorkflowIdsForMessage(item.localMsgId);
    await runInboundWorkflowsForMessage(item.localMsgId, {
      row,
      inboundWorkflows,
      appliedWorkflowIds,
    });
  }
}
