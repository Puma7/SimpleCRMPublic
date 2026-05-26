import { timingSafeEqual } from 'crypto';
import { getSyncInfo } from '../sqlite-service';
import { listWorkflowsByTrigger } from './email-workflow-store';
import { executeWorkflowForTrigger } from '../workflow/workflow-executor';

const WEBHOOK_BODY_JSON_MAX = 64 * 1024;

function webhookSecretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function fireWebhookWorkflows(payload: {
  secret: string;
  body?: Record<string, unknown>;
}): Promise<{ fired: number; error?: string }> {
  const expected = getSyncInfo('email_webhook_secret')?.trim();
  if (!expected || !webhookSecretMatches(payload.secret, expected)) {
    return { fired: 0, error: 'Ungültiges Webhook-Secret' };
  }
  let bodyJson = JSON.stringify(payload.body ?? {});
  if (bodyJson.length > WEBHOOK_BODY_JSON_MAX) {
    bodyJson = bodyJson.slice(0, WEBHOOK_BODY_JSON_MAX);
  }
  const workflows = listWorkflowsByTrigger('webhook.incoming').filter((w) => w.enabled);
  const counts = await Promise.all(
    workflows.map(async (wf) => {
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
        return result.status === 'ok' && !result.blocked ? 1 : 0;
      } catch {
        return 0;
      }
    }),
  );
  return { fired: counts.reduce<number>((sum, n) => sum + n, 0) };
}
