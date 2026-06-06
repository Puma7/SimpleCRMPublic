import type { ColumnType, Generated, Selectable } from 'kysely';

export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

export type ServerDatabase = {
  workspaces: WorkspacesTable;
  secrets: SecretsTable;
  audit_events: AuditEventsTable;
  server_events: ServerEventsTable;
  users: UsersTable;
  auth_invitations: AuthInvitationsTable;
  refresh_tokens: RefreshTokensTable;
  auth_login_failures: AuthLoginFailuresTable;
  conversation_locks: ConversationLocksTable;
  job_queue: JobQueueTable;
  sync_info: SyncInfoTable;
  customers: CustomersTable;
  products: ProductsTable;
  deals: DealsTable;
  tasks: TasksTable;
  deal_products: DealProductsTable;
  calendar_events: CalendarEventsTable;
  customer_custom_fields: CustomerCustomFieldsTable;
  customer_custom_field_values: CustomerCustomFieldValuesTable;
  activity_log: ActivityLogTable;
  saved_views: SavedViewsTable;
  jtl_firmen: JtlReferenceTable;
  jtl_warenlager: JtlReferenceTable;
  jtl_zahlungsarten: JtlReferenceTable;
  jtl_versandarten: JtlReferenceTable;
  email_accounts: EmailAccountsTable;
  email_folders: EmailFoldersTable;
  email_team_members: EmailTeamMembersTable;
  email_threads: EmailThreadsTable;
  email_messages: EmailMessagesTable;
  email_message_attachments: EmailMessageAttachmentsTable;
  email_message_tags: EmailMessageTagsTable;
  email_categories: EmailCategoriesTable;
  email_message_categories: EmailMessageCategoriesTable;
  email_internal_notes: EmailInternalNotesTable;
  email_canned_responses: EmailCannedResponsesTable;
  email_account_signatures: EmailAccountSignaturesTable;
  email_remote_content_allowlist: EmailRemoteContentAllowlistTable;
  email_read_receipt_log: EmailReadReceiptLogTable;
  email_thread_edges: EmailThreadEdgesTable;
  email_thread_aliases: EmailThreadAliasesTable;
  email_ai_profiles: EmailAiProfilesTable;
  email_ai_prompts: EmailAiPromptsTable;
  email_workflows: EmailWorkflowsTable;
  email_workflow_versions: EmailWorkflowVersionsTable;
  email_workflow_runs: EmailWorkflowRunsTable;
  email_workflow_run_steps: EmailWorkflowRunStepsTable;
  email_message_workflow_applied: EmailMessageWorkflowAppliedTable;
  email_workflow_forward_dedup: EmailWorkflowForwardDedupTable;
  workflow_knowledge_bases: WorkflowKnowledgeBasesTable;
  workflow_knowledge_chunks: WorkflowKnowledgeChunksTable;
  workflow_delayed_jobs: WorkflowDelayedJobsTable;
  email_spam_list_entries: EmailSpamListEntriesTable;
  email_spam_learning_events: EmailSpamLearningEventsTable;
  email_spam_feature_stats: EmailSpamFeatureStatsTable;
  email_spam_decisions: EmailSpamDecisionsTable;
  pgp_identities: PgpIdentitiesTable;
  pgp_peer_keys: PgpPeerKeysTable;
  automation_api_keys: AutomationApiKeysTable;
};

export type WorkspacesTable = {
  id: Generated<string>;
  name: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type SecretsTable = {
  id: Generated<string>;
  workspace_id: string;
  kind: string;
  name: string;
  ciphertext: Buffer;
  nonce: Buffer;
  key_id: string;
  algorithm: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type AuditEventsTable = {
  id: Generated<number>;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: JsonColumn;
  previous_hash: string | null;
  event_hash: string;
  created_at: TimestampColumn;
};

export type ServerEventsTable = {
  sequence: Generated<number>;
  workspace_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string;
  occurred_at: TimestampColumn;
  payload: JsonColumn;
  created_at: TimestampColumn;
};

export type UsersTable = {
  id: Generated<string>;
  workspace_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: 'owner' | 'admin' | 'user';
  disabled_at: TimestampColumn | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type AuthInvitationsTable = {
  id: Generated<string>;
  workspace_id: string;
  email: string;
  display_name: string;
  role: 'owner' | 'admin' | 'user';
  token_hash: string;
  invited_by_user_id: string;
  accepted_user_id: string | null;
  expires_at: TimestampColumn;
  accepted_at: TimestampColumn | null;
  revoked_at: TimestampColumn | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type RefreshTokensTable = {
  id: Generated<string>;
  user_id: string;
  workspace_id: string;
  token_hash: string;
  device: string | null;
  expires_at: TimestampColumn;
  revoked_at: TimestampColumn | null;
  created_at: TimestampColumn;
};

export type AuthLoginFailuresTable = {
  id: Generated<number>;
  workspace_id: string | null;
  user_id: string | null;
  email_normalized: string;
  ip_address: string;
  failed_at: TimestampColumn;
  failed_attempts: number;
  lock_until: TimestampColumn | null;
  penalty_kind: 'none' | 'temporary' | 'permanent';
  user_agent: string | null;
};

export type ConversationLocksTable = {
  message_id: number;
  user_id: string;
  workspace_id: string;
  acquired_at: TimestampColumn;
  last_heartbeat_at: TimestampColumn;
  reason: 'reply' | 'forward' | 'edit';
  takeover_count: Generated<number>;
};

export type JsonColumn = ColumnType<unknown, unknown, unknown>;

export type JobQueueTable = {
  id: Generated<number>;
  type: string;
  payload: JsonColumn;
  run_after: TimestampColumn;
  attempts: Generated<number>;
  max_attempts: number;
  locked_at: TimestampColumn | null;
  locked_by: string | null;
  last_error: string | null;
  workspace_id: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type SyncInfoTable = {
  workspace_id: string;
  key: string;
  value: string | null;
  last_updated: TimestampColumn;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type CustomersTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  jtl_kkunde: number | null;
  customer_number: string | null;
  name: string | null;
  first_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  jtl_date_created: TimestampColumn | null;
  jtl_blocked: boolean | null;
  status: string;
  notes: string | null;
  affiliate_link: string | null;
  date_added: TimestampColumn | null;
  last_modified_locally: TimestampColumn | null;
  last_synced: TimestampColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type ProductsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  jtl_kartikel: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  price: string;
  is_active: boolean;
  date_created: TimestampColumn | null;
  last_modified: TimestampColumn | null;
  jtl_date_created: TimestampColumn | null;
  last_synced: TimestampColumn | null;
  last_modified_locally: TimestampColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type DealsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  customer_source_sqlite_id: number;
  customer_id: number | null;
  name: string;
  value: string;
  value_calculation_method: 'static' | 'dynamic';
  stage: string;
  notes: string | null;
  created_date: TimestampColumn | null;
  expected_close_date: TimestampColumn | null;
  last_modified: TimestampColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type TasksTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  customer_source_sqlite_id: number | null;
  customer_id: number | null;
  title: string;
  description: string | null;
  due_date: TimestampColumn | null;
  priority: string;
  completed: boolean;
  calendar_event_source_sqlite_id: number | null;
  snoozed_until: TimestampColumn | null;
  created_date: TimestampColumn | null;
  last_modified: TimestampColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type DealProductsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  deal_source_sqlite_id: number;
  product_source_sqlite_id: number;
  deal_id: number | null;
  product_id: number | null;
  quantity: number;
  price_at_time_of_adding: string;
  date_added: TimestampColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type CalendarEventsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  title: string;
  description: string | null;
  start_date: TimestampColumn;
  end_date: TimestampColumn;
  all_day: boolean;
  color_code: string | null;
  event_type: string | null;
  recurrence_rule: string | null;
  task_source_sqlite_id: number | null;
  task_id: number | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type CustomerCustomFieldsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: JsonColumn | null;
  default_value: string | null;
  placeholder: string | null;
  description: string | null;
  display_order: number;
  active: boolean;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type CustomerCustomFieldValuesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  customer_source_sqlite_id: number;
  field_source_sqlite_id: number;
  customer_id: number | null;
  field_id: number | null;
  value: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type ActivityLogTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  customer_source_sqlite_id: number | null;
  deal_source_sqlite_id: number | null;
  task_source_sqlite_id: number | null;
  customer_id: number | null;
  deal_id: number | null;
  task_id: number | null;
  activity_type: string;
  title: string | null;
  description: string | null;
  metadata: JsonColumn | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type SavedViewsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  name: string;
  filters: JsonColumn;
  display_order: number;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type JtlReferenceTable = {
  workspace_id: string;
  source_sqlite_id: number;
  name: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailAccountsTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  display_name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_tls: boolean;
  imap_username: string;
  keytar_account_key: string | null;
  imap_password_secret_id: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_tls: boolean;
  smtp_username: string | null;
  smtp_use_imap_auth: boolean;
  smtp_keytar_account_key: string | null;
  smtp_password_secret_id: string | null;
  protocol: string;
  pop3_host: string | null;
  pop3_port: number | null;
  pop3_tls: boolean;
  oauth_provider: string | null;
  oauth_refresh_keytar_key: string | null;
  oauth_refresh_secret_id: string | null;
  sent_folder_path: string | null;
  sync_spam_folder_path: string | null;
  sync_archive_folder_path: string | null;
  imap_sync_sent: boolean;
  imap_sync_archive: boolean;
  imap_sync_spam: boolean;
  imap_sync_seen_on_open: boolean;
  vacation_enabled: boolean;
  vacation_subject: string | null;
  vacation_body_text: string | null;
  request_read_receipt: boolean;
  default_remote_content_policy: string;
  respond_to_read_receipts: string;
  read_receipt_trusted_domains: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailFoldersTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  account_source_sqlite_id: number;
  account_id: number | null;
  path: string;
  delimiter: string | null;
  uidvalidity: number | null;
  uidvalidity_str: string | null;
  last_uid: number;
  last_synced_at: TimestampColumn | null;
  pop3_uidl_str: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailTeamMembersTable = {
  workspace_id: string;
  id: string;
  display_name: string;
  role: string;
  signature_html: string | null;
  sort_order: number;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailThreadsTable = {
  id: string;
  workspace_id: string;
  ticket_code: string;
  root_message_source_sqlite_id: number | null;
  root_message_id: number | null;
  last_message_at: TimestampColumn | null;
  message_count: number;
  has_unread: boolean;
  has_attachments: boolean;
  subject_normalized: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailMessagesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  account_source_sqlite_id: number;
  folder_source_sqlite_id: number;
  account_id: number | null;
  folder_id: number | null;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  subject: string | null;
  from_json: JsonColumn | null;
  to_json: JsonColumn | null;
  cc_json: JsonColumn | null;
  bcc_json: JsonColumn | null;
  date_received: TimestampColumn | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  seen_local: boolean;
  done_local: boolean;
  sent_imap_sync_failed: boolean;
  archived: boolean;
  soft_deleted: boolean;
  trash_prev_archived: boolean | null;
  trash_prev_is_spam: boolean | null;
  trash_prev_folder_kind: string | null;
  outbound_hold: boolean;
  outbound_block_reason: string | null;
  thread_id: string | null;
  ticket_code: string | null;
  customer_source_sqlite_id: number | null;
  customer_id: number | null;
  folder_kind: string;
  imap_thread_id: string | null;
  has_attachments: boolean;
  attachments_json: JsonColumn | null;
  auth_spf: string | null;
  auth_dkim: string | null;
  auth_dmarc: string | null;
  auth_arc: string | null;
  auth_dkim_domains: string | null;
  auth_error: string | null;
  rspamd_score: number | null;
  rspamd_action: string | null;
  rspamd_symbols: string | null;
  rspamd_error: string | null;
  security_checked_at: TimestampColumn | null;
  draft_attachment_paths_json: string | null;
  post_process_done: boolean;
  reply_parent_message_id: number | null;
  assigned_to: string | null;
  legacy_assigned_to_user_id: string | null;
  assigned_to_user_id: string | null;
  is_spam: boolean;
  spam_status: string;
  spam_score: number | null;
  spam_score_label: string | null;
  spam_decision_source: string | null;
  spam_score_breakdown_json: JsonColumn | null;
  spam_decided_at: TimestampColumn | null;
  snoozed_until: TimestampColumn | null;
  scheduled_send_at: TimestampColumn | null;
  reply_suggestion_text: string | null;
  reply_suggestion_status: string | null;
  reply_suggestion_error: string | null;
  reply_suggestion_updated_at: TimestampColumn | null;
  pop3_uidl: string | null;
  raw_headers: string | null;
  raw_rfc822_b64: string | null;
  remote_content_policy: string;
  read_receipt_requested: boolean;
  pgp_status: string | null;
  pgp_signer_fingerprint: string | null;
  thread_confidence: string | null;
  thread_resolver_version: number;
  normalized_subject: string | null;
  server_thread_source: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailMessageAttachmentsTable = EmailMessageChildTable & {
  filename_display: string;
  content_type: string | null;
  size_bytes: number;
  storage_path: string;
  content_sha256: string | null;
};

export type EmailMessageTagsTable = EmailMessageChildTable & {
  tag: string;
};

export type EmailCategoriesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  parent_source_sqlite_id: number | null;
  parent_id: number | null;
  name: string;
  sort_order: number;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailMessageCategoriesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  message_source_sqlite_id: number;
  category_source_sqlite_id: number;
  message_id: number | null;
  category_id: number | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailInternalNotesTable = EmailMessageChildTable & {
  body: string;
};

export type EmailCannedResponsesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  title: string;
  body: string;
  sort_order: number;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailAccountSignaturesTable = {
  workspace_id: string;
  source_sqlite_id: number;
  account_source_sqlite_id: number;
  account_id: number | null;
  signature_html: string | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailRemoteContentAllowlistTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  scope: string;
  value: string;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailReadReceiptLogTable = EmailMessageChildTable & {
  direction: string;
  recipient: string | null;
  at: TimestampColumn | null;
};

export type EmailThreadEdgesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  parent_message_source_sqlite_id: number;
  child_message_source_sqlite_id: number;
  parent_message_id: number | null;
  child_message_id: number | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailThreadAliasesTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  alias_thread_id: string;
  canonical_thread_id: string;
  confidence: string;
  source: string;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type EmailAiProfilesTable = SourceImportedTable & {
  id: Generated<number>;
  label: string;
  provider: string;
  base_url: string;
  model: string;
  embedding_model: string | null;
  legacy_keytar_account: string | null;
  secret_id: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: TimestampColumn | null;
};

export type EmailAiPromptsTable = SourceImportedTable & {
  id: Generated<number>;
  label: string;
  user_template: string;
  target: string;
  profile_source_sqlite_id: number | null;
  profile_id: number | null;
  sort_order: number;
  created_at: TimestampColumn | null;
};

export type EmailWorkflowsTable = SourceImportedTable & {
  id: Generated<number>;
  name: string;
  trigger_name: string;
  enabled: boolean;
  priority: number;
  definition_json: JsonColumn;
  graph_json: JsonColumn | null;
  cron_expr: string | null;
  schedule_account_source_sqlite_id: number | null;
  schedule_account_id: number | null;
  execution_mode: string;
  engine_version: number;
  legacy_created_by_user_id: string | null;
  created_by_user_id: string | null;
  created_at: TimestampColumn | null;
};

export type EmailWorkflowVersionsTable = SourceImportedTable & {
  id: Generated<number>;
  workflow_source_sqlite_id: number;
  workflow_id: number | null;
  label: string;
  graph_json: JsonColumn;
  definition_json: JsonColumn;
  created_at: TimestampColumn | null;
};

export type EmailWorkflowRunsTable = SourceImportedTable & {
  id: Generated<number>;
  workflow_source_sqlite_id: number;
  message_source_sqlite_id: number | null;
  workflow_id: number | null;
  message_id: number | null;
  direction: string;
  status: string;
  log_json: JsonColumn | null;
  started_at: TimestampColumn | null;
  finished_at: TimestampColumn | null;
};

export type EmailWorkflowRunStepsTable = SourceImportedTable & {
  id: Generated<number>;
  run_source_sqlite_id: number;
  run_id: number | null;
  node_id: string;
  node_type: string;
  status: string;
  port: string | null;
  duration_ms: number;
  message: string | null;
  detail_json: JsonColumn | null;
  created_at: TimestampColumn | null;
};

export type EmailMessageWorkflowAppliedTable = SourceImportedTable & {
  id: Generated<number>;
  source_sqlite_id: number;
  message_source_sqlite_id: number;
  workflow_source_sqlite_id: number;
  message_id: number | null;
  workflow_id: number | null;
  applied_at: TimestampColumn | null;
};

export type EmailWorkflowForwardDedupTable = EmailMessageWorkflowAppliedTable & {
  dest: string;
  created_at: TimestampColumn | null;
};

export type WorkflowKnowledgeBasesTable = SourceImportedTable & {
  id: Generated<number>;
  name: string;
  description: string | null;
  created_at: TimestampColumn | null;
};

export type WorkflowKnowledgeChunksTable = SourceImportedTable & {
  id: Generated<number>;
  knowledge_base_source_sqlite_id: number;
  knowledge_base_id: number | null;
  title: string | null;
  content: string;
  source_path: string | null;
  embedding_json: JsonColumn | null;
  created_at: TimestampColumn | null;
};

export type WorkflowDelayedJobsTable = SourceImportedTable & {
  id: Generated<number>;
  workflow_source_sqlite_id: number;
  message_source_sqlite_id: number | null;
  workflow_id: number | null;
  message_id: number | null;
  resume_node_id: string | null;
  execute_at: TimestampColumn;
  context_json: JsonColumn | null;
  status: string;
  created_at: TimestampColumn | null;
};

export type EmailSpamListEntriesTable = SourceImportedTable & {
  id: Generated<number>;
  list_type: 'allow' | 'block';
  pattern_type: 'email' | 'domain';
  pattern: string;
  account_source_sqlite_id: number | null;
  account_id: number | null;
  note: string | null;
  created_at: TimestampColumn | null;
};

export type EmailSpamLearningEventsTable = SourceImportedTable & {
  id: Generated<number>;
  message_source_sqlite_id: number | null;
  account_source_sqlite_id: number;
  message_id: number | null;
  account_id: number | null;
  label: 'spam' | 'ham';
  source: string;
  feature_keys_json: JsonColumn | null;
  created_at: TimestampColumn | null;
};

export type EmailSpamFeatureStatsTable = {
  workspace_id: string;
  feature_key: string;
  spam_count: number;
  ham_count: number;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailSpamDecisionsTable = SourceImportedTable & {
  id: Generated<number>;
  message_source_sqlite_id: number | null;
  account_source_sqlite_id: number;
  message_id: number | null;
  account_id: number | null;
  score: number;
  status: 'clean' | 'review' | 'spam';
  source: string;
  breakdown_json: JsonColumn | null;
  model_version: number;
  created_at: TimestampColumn | null;
};

export type PgpIdentitiesTable = SourceImportedTable & {
  id: Generated<number>;
  user_id: string | null;
  legacy_user_id: string | null;
  email: string;
  fingerprint: string;
  public_key_armor: string;
  has_private_key: boolean;
  legacy_keytar_private_key_handle: string | null;
  private_key_secret_id: string | null;
  expires_at: TimestampColumn | null;
  is_primary: boolean;
  created_at: TimestampColumn | null;
};

export type PgpPeerKeysTable = SourceImportedTable & {
  id: Generated<number>;
  email: string;
  fingerprint: string;
  public_key_armor: string;
  source: string;
  verified_at: TimestampColumn | null;
  verified_by_user_id: string | null;
  legacy_verified_by_user_id: string | null;
  trust_level: string;
  created_at: TimestampColumn | null;
};

export type AutomationApiKeysTable = {
  id: Generated<string>;
  workspace_id: string;
  label: string;
  key_hash: string;
  secret_id: string | null;
  scopes: JsonColumn;
  last_used_at: TimestampColumn | null;
  revoked_at: TimestampColumn | null;
  created_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
};

export type SourceImportedTable = {
  workspace_id: string;
  source_sqlite_id: number | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  updated_at: TimestampColumn;
};

export type EmailMessageChildTable = {
  id: Generated<number>;
  workspace_id: string;
  source_sqlite_id: number;
  message_source_sqlite_id: number;
  message_id: number | null;
  source_row: JsonColumn;
  imported_in_run_id: string | null;
  created_at: TimestampColumn | null;
  updated_at: TimestampColumn;
};

export type UserRow = Selectable<UsersTable>;
export type AuthInvitationRow = Selectable<AuthInvitationsTable>;
export type RefreshTokenRow = Selectable<RefreshTokensTable>;
export type SecretRow = Selectable<SecretsTable>;
export type ConversationLockRow = Selectable<ConversationLocksTable> & {
  display_name?: string | null;
  email?: string | null;
};
export type JobQueueRow = Selectable<JobQueueTable>;
export type CustomerRow = Selectable<CustomersTable>;
export type ProductRow = Selectable<ProductsTable>;
export type DealRow = Selectable<DealsTable>;
export type TaskRow = Selectable<TasksTable>;
export type CalendarEventRow = Selectable<CalendarEventsTable>;
export type EmailMessageRow = Selectable<EmailMessagesTable>;
