import { getSyncInfo } from '../sqlite-service';
import { listWorkflowsByTrigger } from './email-workflow-store';
import { executeWorkflowForTrigger } from '../workflow/workflow-executor';

export async function fireWebhookWorkflows(payload: {
  secret: string;
  body?: Record<string, unknown>;
}): Promise<{ fired: number; error?: string }> {
  const expected = getSyncInfo('email_webhook_secret')?.trim();
  if (!expected || payload.secret !== expected) {
    return { fired: 0, error: 'Ungültiges Webhook-Secret' };
  }
  const workflows = listWorkflowsByTrigger('webhook.incoming');
  let fired = 0;
  const bodyJson = JSON.stringify(payload.body ?? {});
  for (const wf of workflows) {
    if (!wf.enabled) continue;
    try {
      const result = await executeWorkflowForTrigger({
        workflow: wf,
        trigger: 'webhook.incoming',
        direction: 'crm_event',
        message: null,
        eventStrings: {
          subject: 'Webhook',
          body_text: bodyJson,
          snippet: bodyJson.slice(0, 200),
          combined_text: bodyJson,
          from_address: '',
          to_address: '',
          cc_address: '',
          has_attachments: 'false',
          attachment_names: '',
          attachment_types: '',
        },
        eventVariables: { webhook_body: bodyJson },
      });
      if (result.status === 'ok' && !result.blocked) fired += 1;
    } catch {
      /* skip failed workflow */
    }
  }
  return { fired };
}
