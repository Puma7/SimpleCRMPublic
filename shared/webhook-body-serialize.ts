const WEBHOOK_BODY_JSON_MAX = 64 * 1024;

export function serializeWebhookBodyForWorkflow(body: Record<string, unknown>): string {
  let bodyJson = JSON.stringify(body ?? {});
  if (bodyJson.length <= WEBHOOK_BODY_JSON_MAX) {
    return bodyJson;
  }
  const wrapped = {
    __truncated: true,
    __originalLength: bodyJson.length,
    preview: bodyJson.slice(0, WEBHOOK_BODY_JSON_MAX - 512),
  };
  bodyJson = JSON.stringify(wrapped);
  if (bodyJson.length > WEBHOOK_BODY_JSON_MAX) {
    wrapped.preview = wrapped.preview.slice(0, WEBHOOK_BODY_JSON_MAX - 1024);
    bodyJson = JSON.stringify(wrapped);
  }
  return bodyJson;
}
