import { AUTOMATION_API_PREFIX } from '../../shared/automation-api';

export function getOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'SimpleCRM Automation API',
      version: '1.0.0',
      description:
        'Lokale REST-API für n8n, Make und Skripte. Standard: http://127.0.0.1:3847' + AUTOMATION_API_PREFIX,
    },
    servers: [{ url: `http://127.0.0.1:3847${AUTOMATION_API_PREFIX}` }],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    paths: {
      '/health': { get: { summary: 'Health check', security: [] } },
      '/customers': {
        get: { summary: 'List or search customers (q=)' },
        post: { summary: 'Create customer' },
      },
      '/customers/{id}': {
        get: { summary: 'Get customer' },
        patch: { summary: 'Update customer' },
        delete: { summary: 'Delete customer' },
      },
      '/deals': { get: { summary: 'List deals' }, post: { summary: 'Create deal' } },
      '/deals/{id}': {
        get: { summary: 'Get deal' },
        patch: { summary: 'Update deal' },
        delete: { summary: 'Delete deal' },
      },
      '/deals/{id}/stage': { post: { summary: 'Update deal stage' } },
      '/tasks': { get: { summary: 'List tasks' }, post: { summary: 'Create task' } },
      '/tasks/{id}': {
        get: { summary: 'Get task' },
        patch: { summary: 'Update task' },
        delete: { summary: 'Delete task' },
      },
      '/tasks/{id}/toggle': { post: { summary: 'Toggle task completion' } },
      '/email/accounts': { get: { summary: 'List email accounts (no secrets)' } },
      '/email/messages': { get: { summary: 'List messages (accountId required)' } },
      '/email/messages/{id}': { get: { summary: 'Get message' } },
      '/email/messages/{id}/actions': { post: { summary: 'Apply message action' } },
      '/workflows': { get: { summary: 'List workflows' } },
      '/workflows/{id}': { get: { summary: 'Get workflow' } },
      '/workflows/{id}/runs': { get: { summary: 'Recent workflow runs' } },
      '/workflows/{id}/execute': { post: { summary: 'Execute workflow (dryRun default true)' } },
      '/webhooks/incoming': {
        post: {
          summary: 'Trigger webhook.incoming workflows (requires workflows scope + secret)',
        },
      },
    },
  };
}
