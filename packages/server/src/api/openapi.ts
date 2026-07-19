export function getServerOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'SimpleCRM Server API',
      version: '1.0.0',
      description: 'Serverseitige REST-API fuer SimpleCRM Server- und Server-Client-Modus.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
        DataEnvelope: {
          type: 'object',
          properties: {
            data: {},
          },
          required: ['data'],
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check (liveness)',
          security: [],
          responses: { '200': { description: 'Prozess erreichbar' } },
        },
      },
      '/health/ready': {
        get: {
          summary: 'Readiness check (liveness plus database connectivity)',
          security: [],
          responses: {
            '200': { description: 'Datenbank erreichbar, betriebsbereit' },
            '503': { description: 'Datenbank nicht erreichbar' },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI document',
          security: [],
          responses: { '200': { description: 'OpenAPI 3 document' } },
        },
      },
      '/auth/setup-state': { get: { summary: 'Initial setup state', security: [] } },
      '/auth/initial-setup': { post: { summary: 'Create initial owner', security: [] } },
      '/auth/login': { post: { summary: 'Login', security: [] } },
      '/auth/refresh': { post: { summary: 'Refresh access token', security: [] } },
      '/auth/logout': { post: { summary: 'Logout' } },
      '/auth/invitations': {
        get: { summary: 'List invitations' },
        post: { summary: 'Create invitation' },
      },
      '/auth/users': {
        get: { summary: 'List users' },
        post: { summary: 'Create or update user' },
      },
      '/auth/audit-log': { get: { summary: 'List audit log' } },
      '/auth/audit-chain/verify': { get: { summary: 'Verify audit chain' } },
      '/customers': {
        get: { summary: 'List or search customers' },
        post: { summary: 'Create customer' },
      },
      '/customers/{id}': {
        get: { summary: 'Get customer' },
        patch: { summary: 'Update customer' },
        delete: { summary: 'Delete customer' },
      },
      '/products': {
        get: { summary: 'List products' },
        post: { summary: 'Create product' },
      },
      '/products/{id}': {
        get: { summary: 'Get product' },
        patch: { summary: 'Update product' },
        delete: { summary: 'Delete product' },
      },
      '/deals': {
        get: { summary: 'List deals' },
        post: { summary: 'Create deal' },
      },
      '/deals/{id}': {
        get: { summary: 'Get deal' },
        patch: { summary: 'Update deal' },
        delete: { summary: 'Delete deal' },
      },
      '/deals/{id}/stage': {
        post: { summary: 'Update deal stage' },
      },
      '/deals/{id}/tasks': { get: { summary: 'List tasks for deal customer' } },
      '/deals/{id}/products': {
        get: { summary: 'List deal products' },
        post: { summary: 'Add product to deal' },
      },
      '/deals/{id}/products/{dealProductId}': {
        patch: { summary: 'Update deal product' },
        delete: { summary: 'Remove deal product' },
      },
      '/deals/{id}/products/by-product/{productId}': {
        patch: { summary: 'Update deal product by product id' },
        delete: { summary: 'Remove deal product by product id' },
      },
      '/deal-products/{dealProductId}': {
        patch: { summary: 'Update deal product by link id' },
        delete: { summary: 'Remove deal product by link id' },
      },
      '/tasks': {
        get: { summary: 'List tasks' },
        post: { summary: 'Create task' },
      },
      '/tasks/{id}': {
        get: { summary: 'Get task' },
        patch: { summary: 'Update task' },
        delete: { summary: 'Delete task' },
      },
      '/tasks/{id}/toggle': {
        post: { summary: 'Toggle task completion' },
      },
      '/calendar-events': {
        get: { summary: 'List calendar events' },
        post: { summary: 'Create calendar event' },
      },
      '/calendar-events/{id}': {
        get: { summary: 'Get calendar event' },
        patch: { summary: 'Update calendar event' },
        delete: { summary: 'Delete calendar event' },
      },
      '/activity-log': {
        get: { summary: 'List activity log' },
        post: { summary: 'Create activity log entry' },
      },
      '/activity-log/{id}': { get: { summary: 'Get activity log entry' } },
      '/customer-custom-fields': {
        get: { summary: 'List customer custom fields' },
        post: { summary: 'Create customer custom field' },
      },
      '/customer-custom-fields/{id}': {
        get: { summary: 'Get customer custom field' },
        patch: { summary: 'Update customer custom field' },
        delete: { summary: 'Delete customer custom field' },
      },
      '/customer-custom-field-values': {
        get: { summary: 'List customer custom field values' },
        post: { summary: 'Create customer custom field value' },
      },
      '/customer-custom-field-values/{id}': {
        get: { summary: 'Get customer custom field value' },
        patch: { summary: 'Update customer custom field value' },
        delete: { summary: 'Delete customer custom field value' },
      },
      '/customers/{id}/custom-field-values/{fieldId}': {
        delete: { summary: 'Delete customer custom field value by customer and field' },
      },
      '/saved-views': {
        get: { summary: 'List saved views' },
        post: { summary: 'Create saved view' },
      },
      '/saved-views/{id}': {
        get: { summary: 'Get saved view' },
        patch: { summary: 'Update saved view' },
        delete: { summary: 'Delete saved view' },
      },
      '/dashboard/stats': { get: { summary: 'Get dashboard stats' } },
      '/dashboard/recent-customers': { get: { summary: 'Get recent customers' } },
      '/dashboard/upcoming-tasks': { get: { summary: 'Get upcoming tasks' } },
      '/follow-up/queue-counts': { get: { summary: 'Get follow-up queue counts' } },
      '/follow-up/items': { get: { summary: 'List follow-up items' } },
      '/follow-up/tasks/{id}/snooze': { post: { summary: 'Snooze follow-up task' } },
      '/email/accounts': {
        get: { summary: 'List email accounts without secrets' },
        post: { summary: 'Create email account' },
      },
      '/email/accounts/{id}': {
        get: { summary: 'Get email account without secrets' },
        patch: { summary: 'Update email account' },
        delete: { summary: 'Delete email account' },
      },
      '/email/accounts/test-imap': { post: { summary: 'Test IMAP connection' } },
      '/email/accounts/test-pop3': { post: { summary: 'Test POP3 connection' } },
      '/email/accounts/test-smtp': { post: { summary: 'Test SMTP connection' } },
      '/email/accounts/{id}/sync': { post: { summary: 'Queue account sync' } },
      '/email/accounts/{id}/sync-lock': { delete: { summary: 'Release stale account sync job locks' } },
      '/email/accounts/{id}/vacation-test': { post: { summary: 'Test vacation responder' } },
      '/email/accounts/{id}/inbox-archive-recovery': {
        get: { summary: 'Preview inbox archive recovery' },
        post: { summary: 'Restore archived inbox messages' },
      },
      '/email/oauth/{provider}/app': {
        get: { summary: 'Get OAuth app config state' },
        post: { summary: 'Save OAuth app config' },
      },
      '/email/oauth/{provider}/authorize-url': { post: { summary: 'Create OAuth authorization URL' } },
      '/email/oauth/{provider}/finish': { post: { summary: 'Finish OAuth account link' } },
      '/email/folder-counts': { get: { summary: 'Get mail folder counts' } },
      '/email/diagnostics': { get: { summary: 'Get mail diagnostics' } },
      '/email/reporting': { get: { summary: 'Get email reporting metrics' } },
      '/email/gdpr-export': { get: { summary: 'Create email GDPR export' } },
      '/email/tracking/settings': {
        get: { summary: 'Get privacy-controlled email evidence settings' },
        patch: { summary: 'Update email evidence settings (admin)' },
      },
      '/email/relays': {
        get: { summary: 'List SMTP relays with allowed accounts and credentials (sans secrets)' },
        post: { summary: 'Create SMTP relay (admin)' },
      },
      '/email/relays/{id}': {
        patch: { summary: 'Update SMTP relay configuration (admin)' },
        delete: { summary: 'Delete SMTP relay (admin)' },
      },
      '/email/relays/{id}/accounts': { post: { summary: 'Allow sender account on SMTP relay (admin)' } },
      '/email/relays/{id}/accounts/{accountId}': { delete: { summary: 'Remove allowed sender account from SMTP relay (admin)' } },
      '/email/relays/{id}/credentials': { post: { summary: 'Create SMTP relay credential; returns the password exactly once (admin)' } },
      '/email/relays/{id}/credentials/{credentialId}/revoke': { post: { summary: 'Revoke SMTP relay credential (admin)' } },
      '/email/relays/{id}/submissions': { get: { summary: 'List recent SMTP relay submissions' } },
      '/email/messages': {
        get: { summary: 'List messages' },
      },
      '/email/messages/conversation': { get: { summary: 'List conversation messages' } },
      '/email/messages/backfill-customer-links': { post: { summary: 'Backfill message customer links' } },
      '/email/messages/bulk/soft-delete': { patch: { summary: 'Soft-delete messages in bulk' } },
      '/email/messages/bulk/archive': { patch: { summary: 'Archive messages in bulk' } },
      '/email/messages/bulk/done': { patch: { summary: 'Set done flag in bulk' } },
      '/email/messages/bulk/spam-status': { patch: { summary: 'Set spam status in bulk' } },
      '/email/messages/bulk/local-drafts': { delete: { summary: 'Delete local drafts in bulk' } },
      '/email/messages/{id}': {
        get: { summary: 'Get message' },
      },
      '/email/messages/{id}/actions': {
        post: {
          summary: 'Apply documented automation-style message action',
          description: 'Supports archive, unarchive, mark_seen, mark_unseen, spam, spam_review, not_spam, link_customer, assign, and add_tag.',
        },
      },
      '/email/messages/{id}/seen': {
        patch: {
          summary: 'Set local seen flag and optionally sync IMAP Seen',
        },
      },
      '/email/messages/{id}/archive': { patch: { summary: 'Archive or unarchive message' } },
      '/email/messages/{id}/move': { patch: { summary: 'Move message to inbox, archive, trash, spam review, or spam' } },
      '/email/messages/{id}/done': { patch: { summary: 'Set done flag' } },
      '/email/messages/{id}/soft-delete': { patch: { summary: 'Soft-delete message' } },
      '/email/messages/{id}/restore': { patch: { summary: 'Restore message' } },
      '/email/messages/{id}/snooze': { patch: { summary: 'Snooze or unsnooze message' } },
      '/email/messages/{id}/local-draft': { delete: { summary: 'Delete local draft' } },
      '/email/messages/{id}/customer-link': { patch: { summary: 'Link or unlink customer' } },
      '/email/messages/{id}/assignment': { patch: { summary: 'Assign message' } },
      '/email/messages/{id}/security': { get: { summary: 'Get message security summary' } },
      '/email/messages/{id}/security/check': { post: { summary: 'Run message mailauth/Rspamd security check' } },
      '/email/messages/{id}/tracking': {
        get: { summary: 'Get outbound email evidence timeline' },
        delete: { summary: 'Erase outbound email evidence (admin)' },
      },
      '/email/messages/{id}/tracking/revoke': { post: { summary: 'Revoke outbound tracking tokens (admin)' } },
      '/email/messages/{id}/raw-headers': { get: { summary: 'Get raw message headers' } },
      '/email/messages/{id}/spam-status': { patch: { summary: 'Set spam status and optional training' } },
      '/email/messages/{id}/spam-decision': { post: { summary: 'Run spam decision for one message' } },
      '/email/messages/{id}/read-receipt-state': { get: { summary: 'Get read receipt state' } },
      '/email/messages/{id}/read-receipt-response': { post: { summary: 'Send read receipt response' } },
      '/email/messages/{id}/remote-content-policy': { patch: { summary: 'Update remote content policy' } },
      '/email/messages/{id}/remote-content-policy/consume': { post: { summary: 'Consume one-shot remote content allow' } },
      '/email/messages/{id}/compose-draft': {
        patch: { summary: 'Update compose draft' },
        delete: { summary: 'Delete compose draft' },
      },
      '/email/messages/{id}/compose-draft-recovery-state': { get: { summary: 'Get compose draft recovery state' } },
      '/email/messages/{id}/compose-attachments': { post: { summary: 'Upload compose attachment' } },
      '/email/messages/{id}/scheduled-send': { patch: { summary: 'Schedule draft send' } },
      '/email/messages/{id}/scheduled-send-state': { get: { summary: 'Get scheduled send state' } },
      '/email/messages/{id}/scheduled-send/retry': { patch: { summary: 'Retry scheduled send' } },
      '/email/messages/{id}/scheduled-send-failure': { delete: { summary: 'Clear scheduled send failure' } },
      '/email/messages/{id}/attachments': { get: { summary: 'List message attachments' } },
      '/email/messages/{id}/reply-suggestion': { get: { summary: 'Get AI reply suggestion' } },
      '/email/messages/{id}/reply-suggestion/ensure': { post: { summary: 'Ensure AI reply suggestion' } },
      '/email/messages/{id}/reply-draft': { post: { summary: 'Generate reply draft' } },
      '/email/compose-drafts': { post: { summary: 'Create compose draft' } },
      '/email/compose/send': { post: { summary: 'Send compose draft' } },
      '/email/compose/validate-outbound': { post: { summary: 'Validate outbound compose' } },
      '/email/threads/{threadId}/messages': { get: { summary: 'List thread messages' } },
      '/email/attachments/{id}/content': { get: { summary: 'Download attachment content' } },
      '/email/attachments/{id}': { get: { summary: 'Get attachment metadata' } },
      '/email/notices/uid-validity': {
        get: { summary: 'List UIDVALIDITY notices' },
        delete: { summary: 'Dismiss UIDVALIDITY notices' },
      },
      '/email/notices/imap-auth': {
        get: { summary: 'List IMAP auth notices' },
        delete: { summary: 'Dismiss IMAP auth notices' },
      },
      '/email/folders': { get: { summary: 'List mail folders' } },
      '/email/access/bindings': {
        get: { summary: 'List mailbox delegation bindings' },
        post: { summary: 'Create or replace mailbox delegation binding' },
      },
      '/email/access/bindings/{id}': {
        patch: { summary: 'Replace mailbox delegation binding permissions' },
        delete: { summary: 'Delete mailbox delegation binding' },
      },
      '/email/tags': {
        get: { summary: 'List mail tags' },
        post: { summary: 'Create mail tag' },
      },
      '/email/tags/{id}': { delete: { summary: 'Delete mail tag' } },
      '/email/categories': {
        get: { summary: 'List mail categories' },
        post: { summary: 'Create mail category' },
      },
      '/email/categories/{id}': {
        patch: { summary: 'Update mail category' },
        delete: { summary: 'Delete mail category' },
      },
      '/email/categories/reorder': { patch: { summary: 'Reorder mail categories' } },
      '/email/messages/{id}/tags': {
        get: { summary: 'List message tags' },
        post: { summary: 'Add message tag' },
        delete: { summary: 'Remove message tag' },
      },
      '/email/messages/{id}/categories': {
        get: { summary: 'List message categories' },
        post: { summary: 'Assign message category' },
      },
      '/email/messages/{id}/internal-notes': {
        get: { summary: 'List message internal notes' },
        post: { summary: 'Create message internal note' },
      },
      '/email/internal-notes/{id}': {
        patch: { summary: 'Update internal note' },
        delete: { summary: 'Delete internal note' },
      },
      '/email/canned-responses': {
        get: { summary: 'List canned responses' },
        post: { summary: 'Create canned response' },
      },
      '/email/canned-responses/{id}': {
        patch: { summary: 'Update canned response' },
        delete: { summary: 'Delete canned response' },
      },
      '/email/team-members': {
        get: { summary: 'List mail team members' },
        post: { summary: 'Create mail team member' },
      },
      '/email/team-members/{id}': {
        patch: { summary: 'Update mail team member' },
        delete: { summary: 'Delete mail team member' },
      },
      '/email/team-members/{id}/upsert': { post: { summary: 'Upsert mail team member' } },
      '/email/account-signatures': {
        get: { summary: 'List account signatures' },
        post: { summary: 'Create account signature' },
      },
      '/email/account-signatures/{id}': {
        patch: { summary: 'Update account signature' },
        delete: { summary: 'Delete account signature' },
      },
      '/email/account-signatures/by-account/{accountId}/upsert': { post: { summary: 'Upsert account signature' } },
      '/email/remote-content-allowlist': {
        get: { summary: 'List remote content allowlist entries' },
        post: { summary: 'Create remote content allowlist entry' },
      },
      '/email/remote-content-allowlist/{id}': {
        patch: { summary: 'Update remote content allowlist entry' },
        delete: { summary: 'Delete remote content allowlist entry' },
      },
      '/email/thread-edges': {
        get: { summary: 'List thread edges' },
        post: { summary: 'Create thread edge' },
      },
      '/email/thread-edges/{id}': { delete: { summary: 'Delete thread edge' } },
      '/email/thread-aliases': {
        get: { summary: 'List thread aliases' },
        post: { summary: 'Create thread alias' },
      },
      '/email/thread-aliases/{id}': {
        patch: { summary: 'Update thread alias' },
        delete: { summary: 'Delete thread alias' },
      },
      '/email/threads/merge': { post: { summary: 'Merge mail threads' } },
      '/email/threads/split-message': { post: { summary: 'Split message into a new thread' } },
      '/email/thread-alias-warnings': { get: { summary: 'List thread alias warnings' } },
      '/email/category-counts': { get: { summary: 'List message category counts' } },
      '/email/settings/misc': {
        get: { summary: 'Get mail misc settings' },
        patch: { summary: 'Update mail misc settings' },
      },
      '/email/settings/security': {
        get: { summary: 'Get mail security settings' },
        patch: { summary: 'Update mail security settings' },
      },
      '/email/settings/security/test-rspamd': { post: { summary: 'Test Rspamd connection' } },
      '/email/settings/snooze': {
        get: { summary: 'Get snooze settings' },
        patch: { summary: 'Update snooze settings' },
      },
      '/email/settings/reply-suggestion': {
        get: { summary: 'Get reply suggestion settings' },
        patch: { summary: 'Update reply suggestion settings' },
      },
      '/workflow/settings/automation': {
        get: { summary: 'Get workflow automation settings' },
        patch: { summary: 'Update workflow automation settings' },
      },
      '/sync-info/{key}': {
        get: { summary: 'Get sync_info value' },
        patch: { summary: 'Set sync_info value' },
      },
      '/mssql/settings': {
        get: { summary: 'Get MSSQL settings' },
        patch: { summary: 'Update MSSQL settings' },
      },
      '/mssql/test-connection': { post: { summary: 'Test MSSQL connection' } },
      '/mssql/password': { delete: { summary: 'Delete MSSQL password secret' } },
      '/ai/profiles': {
        get: { summary: 'List AI profiles' },
        post: { summary: 'Create AI profile' },
      },
      '/ai/profiles/{id}': {
        get: { summary: 'Get AI profile' },
        patch: { summary: 'Update AI profile' },
        delete: { summary: 'Delete AI profile' },
      },
      '/ai/prompts': {
        get: { summary: 'List AI prompts' },
        post: { summary: 'Create AI prompt' },
      },
      '/ai/prompts/{id}': {
        get: { summary: 'Get AI prompt' },
        patch: { summary: 'Update AI prompt' },
        delete: { summary: 'Delete AI prompt' },
      },
      '/ai/prompts/reorder': { patch: { summary: 'Reorder AI prompts' } },
      '/ai/transform-text': { post: { summary: 'Run AI text transform' } },
      '/workflow/node-catalog': { get: { summary: 'List workflow node catalog' } },
      '/workflow/plugins': { get: { summary: 'List server workflow plugins' } },
      '/workflow/templates': { get: { summary: 'List workflow templates' } },
      '/workflows/compile-graph': { post: { summary: 'Compile workflow graph to legacy definition JSON' } },
      '/workflows': {
        get: { summary: 'List workflows' },
        post: { summary: 'Create workflow' },
      },
      '/workflows/{id}': {
        get: { summary: 'Get workflow' },
        patch: { summary: 'Update workflow' },
        delete: { summary: 'Delete workflow' },
      },
      '/workflows/{id}/execute': { post: { summary: 'Enqueue or dry-run workflow execution' } },
      '/workflows/{id}/runs': { get: { summary: 'List workflow runs' } },
      '/workflows/{id}/versions': {
        get: { summary: 'List workflow versions' },
        post: { summary: 'Create workflow version' },
      },
      '/workflows/by-source/{sourceId}': { get: { summary: 'Get workflow by source id' } },
      '/workflows/by-source/{sourceId}/execute': { post: { summary: 'Enqueue or dry-run workflow execution by source id' } },
      '/workflows/by-source/{sourceId}/runs': { get: { summary: 'List workflow runs by source id' } },
      '/workflows/by-source/{sourceId}/versions': { get: { summary: 'List workflow versions by source id' } },
      '/workflows/by-source/{sourceId}/versions/snapshot': { post: { summary: 'Snapshot workflow version by source id' } },
      '/workflows/inbound/backfill': { post: { summary: 'Queue inbound workflow backfill' } },
      '/workflows/webhook/incoming': { post: { summary: 'Trigger workflow webhook with workspace secret or scoped automation key' } },
      '/webhooks/incoming': { post: { summary: 'Alias for incoming workflow webhooks with workspace secret or scoped automation key' } },
      '/workflow-versions': {
        get: { summary: 'List workflow versions' },
        post: { summary: 'Create workflow version' },
      },
      '/workflow-versions/{id}': {
        get: { summary: 'Get workflow version' },
        patch: { summary: 'Update workflow version' },
        delete: { summary: 'Delete workflow version' },
      },
      '/workflow-versions/by-source/{sourceId}/restore': { post: { summary: 'Restore workflow version by source id' } },
      '/workflow-runs': { get: { summary: 'List workflow runs' } },
      '/workflow-runs/{id}': { get: { summary: 'Get workflow run' } },
      '/workflow-runs/{id}/steps': { get: { summary: 'List workflow run steps' } },
      '/workflow-runs/by-source/{sourceId}/steps': { get: { summary: 'List workflow run steps by source id' } },
      '/workflow-run-steps': { get: { summary: 'List workflow run steps' } },
      '/workflow-message-applied': { get: { summary: 'List workflow message applied rows' } },
      '/workflow-forward-dedup': { get: { summary: 'List workflow forward dedup rows' } },
      '/workflow-knowledge-bases': {
        get: { summary: 'List workflow knowledge bases' },
        post: { summary: 'Create workflow knowledge base' },
      },
      '/workflow-knowledge-bases/{id}': {
        get: { summary: 'Get workflow knowledge base' },
        patch: { summary: 'Update workflow knowledge base' },
        delete: { summary: 'Delete workflow knowledge base' },
      },
      '/workflow-knowledge-chunks': {
        get: { summary: 'List workflow knowledge chunks' },
        post: { summary: 'Create workflow knowledge chunk' },
      },
      '/workflow-knowledge-chunks/{id}': {
        get: { summary: 'Get workflow knowledge chunk' },
        patch: { summary: 'Update workflow knowledge chunk' },
        delete: { summary: 'Delete workflow knowledge chunk' },
      },
      '/workflow-delayed-jobs': {
        get: { summary: 'List workflow delayed jobs' },
        post: { summary: 'Create workflow delayed job' },
      },
      '/workflow-delayed-jobs/{id}': {
        get: { summary: 'Get workflow delayed job' },
        patch: { summary: 'Update workflow delayed job' },
        delete: { summary: 'Delete workflow delayed job' },
      },
      '/events': {
        get: {
          summary: 'Replay server events since a sequence',
          description: 'The same path also supports a WebSocket upgrade for live workspace events.',
        },
      },
      '/locks/{messageId}': {
        get: { summary: 'Get conversation lock' },
        post: { summary: 'Acquire conversation lock' },
        delete: { summary: 'Release conversation lock' },
      },
      '/automation/api-keys': {
        get: { summary: 'List automation API keys' },
        post: { summary: 'Create automation API key' },
      },
      '/automation/api-keys/{id}': {
        get: { summary: 'Get automation API key' },
        delete: { summary: 'Revoke automation API key' },
      },
      '/pgp/identities': {
        get: { summary: 'List PGP identities' },
        post: { summary: 'Create PGP identity' },
      },
      '/pgp/identities/{id}': {
        get: { summary: 'Get PGP identity' },
        patch: { summary: 'Update PGP identity' },
        delete: { summary: 'Delete PGP identity' },
      },
      '/pgp/identities/generate': { post: { summary: 'Generate PGP identity' } },
      '/pgp/identities/{id}/private-key/passphrase': { post: { summary: 'Rotate PGP private-key passphrase' } },
      '/pgp/identities/by-source/{sourceId}': { get: { summary: 'Get PGP identity by source id' } },
      '/pgp/identities/by-source/{sourceId}/private-key/passphrase': { post: { summary: 'Rotate PGP private-key passphrase by source id' } },
      '/pgp/peer-keys': {
        get: { summary: 'List PGP peer keys' },
        post: { summary: 'Create PGP peer key' },
      },
      '/pgp/peer-keys/{id}': {
        get: { summary: 'Get PGP peer key' },
        patch: { summary: 'Update PGP peer key' },
        delete: { summary: 'Delete PGP peer key' },
      },
      '/pgp/peer-keys/import': { post: { summary: 'Import PGP peer key' } },
      '/pgp/peer-keys/by-source/{sourceId}': { get: { summary: 'Get PGP peer key by source id' } },
      '/pgp/recipient-key-status': { post: { summary: 'Check recipient key status' } },
      '/pgp/messages/{id}/detect': { post: { summary: 'Detect PGP message armor' } },
      '/pgp/messages/{id}/decrypt': { post: { summary: 'Decrypt PGP message' } },
      '/pgp/messages/{id}/verify': { post: { summary: 'Verify PGP message signature' } },
      '/pgp/messages/encrypt': { post: { summary: 'Encrypt plaintext PGP message and optional attachments' } },
      '/pgp/messages/sign': { post: { summary: 'Sign plaintext PGP message and optional attachments' } },
      '/pgp/attachments/{id}/decrypt': { post: { summary: 'Decrypt stored PGP attachment transiently' } },
      '/pgp/attachments/{id}/verify': { post: { summary: 'Verify stored attachment detached PGP signature' } },
      '/spam/list-entries': {
        get: { summary: 'List spam list entries' },
        post: { summary: 'Create spam list entry' },
      },
      '/spam/list-entries/{id}': {
        get: { summary: 'Get spam list entry' },
        patch: { summary: 'Update spam list entry' },
        delete: { summary: 'Delete spam list entry' },
      },
      '/spam/list-entries/upsert': { post: { summary: 'Upsert spam list entry' } },
      '/spam/learning-events': {
        get: { summary: 'List spam learning events' },
        post: { summary: 'Create spam learning event' },
      },
      '/spam/decisions': {
        get: { summary: 'List spam decisions' },
        post: { summary: 'Create spam decision' },
      },
      '/spam/decisions/{id}': {
        get: { summary: 'Get spam decision' },
        patch: { summary: 'Update spam decision' },
        delete: { summary: 'Delete spam decision' },
      },
      '/spam/feature-stats': { get: { summary: 'List spam feature stats' } },
      '/jtl/orders': { post: { summary: 'Create JTL order' } },
      '/jtl/sync/status': { get: { summary: 'Get JTL sync status' } },
      '/jtl/sync/run': { post: { summary: 'Run JTL sync' } },
      '/jtl/{resource}': {
        get: { summary: 'List JTL reference rows' },
        post: { summary: 'Create JTL reference row' },
      },
      '/jtl/{resource}/{id}': {
        get: { summary: 'Get JTL reference row' },
        patch: { summary: 'Update JTL reference row' },
        delete: { summary: 'Delete JTL reference row' },
      },
    },
  };
}
