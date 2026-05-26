import { createHash, timingSafeEqual } from 'crypto';
import { serializeWebhookBodyForWorkflow } from '../../shared/webhook-body-serialize';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { listWorkflowsByTrigger } from './email-workflow-store';
import { executeWorkflowForTrigger } from '../workflow/workflow-executor';

const WEBHOOK_DEDUP_MS = 5 * 60 * 1000;

function webhookSecretMatches(provided: string, expected: string): boolean {
  const ah = createHash('sha256').update(provided, 'utf8').digest();
  const bh = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}

function webhookPayloadHash(bodyJson: string): string {
  return createHash('sha256').update(bodyJson, 'utf8').digest('hex').slice(0, 40);
}

function tryClaimWebhookPayload(bodyHash: string): boolean {
  const key = `webhook_dedup:${bodyHash}`;
  const raw = getSyncInfo(key);
  if (raw) {
    const t = Number(raw);
    if (!Number.isNaN(t) && Date.now() - t < WEBHOOK_DEDUP_MS) {
      return false;
    }
  }
  setSyncInfo(key, String(Date.now()));
  return true;
}

export async function fireWebhookWorkflows(payload: {
  secret: string;
  body?: Record<string, unknown>;
}): Promise<{ fired: number; error?: string; deduplicated?: boolean }> {
  const expected = getSyncInfo('email_webhook_secret')?.trim();
  if (!expected || !webhookSecretMatches(payload.secret, expected)) {
    return { fired: 0, error: 'Ungültiges Webhook-Secret' };
  }
  const bodyJson = serializeWebhookBodyForWorkflow(payload.body ?? {});
  const bodyHash = webhookPayloadHash(bodyJson);
  if (!tryClaimWebhookPayload(bodyHash)) {
    return { fired: 0, deduplicated: true };
  }

  const workflows = listWorkflowsByTrigger('webhook.incoming').filter((w) => w.enabled);
  let fired = 0;
  const errors: string[] = [];
  for (const wf of workflows) {
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
      if (result.status === 'ok' && !result.blocked) {
        fired += 1;
      } else if (result.status === 'error') {
        errors.push(`wf${wf.id}:${result.log.join(';').slice(0, 120)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`wf${wf.id}:${msg}`);
      console.warn(`[webhook] workflow ${wf.id} failed`, e);
    }
  }
  return {
    fired,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}
