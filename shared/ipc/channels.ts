import { literal, tuple } from './utils';

const WindowChannels = literal({
  GetState: 'window:get-state',
});

const UpdateChannels = literal({
  CheckForUpdates: 'app:check-for-updates',
  InstallUpdate: 'app:install-update',
  GetStatus: 'app:get-update-status',
});

// DB related invoke channels
const DbChannels = literal({
  GetCustomers: 'db:get-customers',
  GetCustomersDropdown: 'db:get-customers-dropdown',
  SearchCustomers: 'db:search-customers',
  GetCustomer: 'db:get-customer',
  CreateCustomer: 'db:create-customer',
  UpdateCustomer: 'db:update-customer',
  DeleteCustomer: 'db:delete-customer',
  GetDealsForCustomer: 'db:get-deals-for-customer',
  GetTasksForCustomer: 'db:get-tasks-for-customer',
});

const CalendarChannels = literal({
  GetCalendarEvents: 'db:getCalendarEvents',
  AddCalendarEvent: 'db:addCalendarEvent',
  UpdateCalendarEvent: 'db:updateCalendarEvent',
  DeleteCalendarEvent: 'db:deleteCalendarEvent',
});

const ProductChannels = literal({
  GetAll: 'products:get-all',
  Search: 'products:search',
  GetById: 'products:get-by-id',
  Create: 'products:create',
  Update: 'products:update',
  Delete: 'products:delete',
});

const DealChannels = literal({
  GetAll: 'deals:get-all',
  GetById: 'deals:get-by-id',
  Create: 'deals:create',
  Update: 'deals:update',
  Delete: 'deals:delete',
  UpdateStage: 'deals:update-stage',
  GetProducts: 'deals:get-products',
  GetTasks: 'deals:get-tasks',
  AddProduct: 'deals:add-product',
  RemoveProduct: 'deals:remove-product',
  UpdateProduct: 'deals:update-product',
  UpdateProductQuantityLegacy: 'deals:update-product-quantity',
});

const TaskChannels = literal({
  GetAll: 'tasks:get-all',
  GetById: 'tasks:get-by-id',
  Create: 'tasks:create',
  Update: 'tasks:update',
  ToggleCompletion: 'tasks:toggle-completion',
  Delete: 'tasks:delete',
});

const SyncChannels = literal({
  Run: 'sync:run',
  GetStatus: 'sync:get-status',
  GetInfo: 'sync:get-info',
  SetInfo: 'sync:set-info',
});

const MssqlChannels = literal({
  SaveSettings: 'mssql:save-settings',
  GetSettings: 'mssql:get-settings',
  TestConnection: 'mssql:test-connection',
  ClearPassword: 'mssql:clear-password',
});

const JtlChannels = literal({
  GetFirmen: 'jtl:get-firmen',
  GetWarenlager: 'jtl:get-warenlager',
  GetZahlungsarten: 'jtl:get-zahlungsarten',
  GetVersandarten: 'jtl:get-versandarten',
  CreateOrder: 'jtl:create-order',
});

const AutomationChannels = literal({
  GetSettings: 'automation:get-settings',
  SetSettings: 'automation:set-settings',
  GenerateApiKey: 'automation:generate-api-key',
  RevokeApiKey: 'automation:revoke-api-key',
});

const FollowUpChannels = literal({
  GetItems: 'followup:get-items',
  GetQueueCounts: 'followup:get-queue-counts',
  SnoozeTask: 'followup:snooze-task',
  LogActivity: 'followup:log-activity',
  GetTimeline: 'followup:get-timeline',
  GetSavedViews: 'followup:get-saved-views',
  CreateSavedView: 'followup:create-saved-view',
  DeleteSavedView: 'followup:delete-saved-view',
});

const DashboardChannels = literal({
  GetStats: 'dashboard:get-stats',
  GetRecentCustomers: 'dashboard:get-recent-customers',
  GetUpcomingTasks: 'dashboard:get-upcoming-tasks',
});

const CustomFieldChannels = literal({
  GetAll: 'custom-fields:get-all',
  GetActive: 'custom-fields:get-active',
  GetById: 'custom-fields:get-by-id',
  Create: 'custom-fields:create',
  Update: 'custom-fields:update',
  Delete: 'custom-fields:delete',
  GetValuesForCustomer: 'custom-fields:get-values-for-customer',
  SetValue: 'custom-fields:set-value',
  DeleteValue: 'custom-fields:delete-value',
});

const EmailChannels = literal({
  ListAccounts: 'email:list-accounts',
  CreateAccount: 'email:create-account',
  UpdateAccount: 'email:update-account',
  DeleteAccount: 'email:delete-account',
  TestImap: 'email:test-imap',
  SyncAccount: 'email:sync-account',
  ListMessages: 'email:list-messages',
  GetMessage: 'email:get-message',
  ListWorkflows: 'email:list-workflows',
  GetWorkflow: 'email:get-workflow',
  CreateWorkflow: 'email:create-workflow',
  UpdateWorkflow: 'email:update-workflow',
  DeleteWorkflow: 'email:delete-workflow',
  ValidateOutbound: 'email:validate-outbound',
  CreateComposeDraft: 'email:create-compose-draft',
  UpdateComposeDraft: 'email:update-compose-draft',
  BackfillInboundWorkflows: 'email:backfill-inbound-workflows',
  ListMessageTags: 'email:list-message-tags',
  ListMessagesByView: 'email:list-messages-by-view',
  SearchMessages: 'email:search-messages',
  ListConversationMessages: 'email:list-conversation-messages',
  SendCompose: 'email:send-compose',
  TestSmtp: 'email:test-smtp',
  ListCategories: 'email:list-categories',
  CreateCategory: 'email:create-category',
  UpdateCategory: 'email:update-category',
  DeleteCategory: 'email:delete-category',
  SetMessageCategory: 'email:set-message-category',
  GetMessageCategory: 'email:get-message-category',
  CategoryCounts: 'email:category-counts',
  MoveMessageToView: 'email:move-message-to-view',
  MailFolderCounts: 'email:mail-folder-counts',
  AddInternalNote: 'email:add-internal-note',
  UpdateInternalNote: 'email:update-internal-note',
  DeleteInternalNote: 'email:delete-internal-note',
  ListInternalNotes: 'email:list-internal-notes',
  AddMessageTag: 'email:add-message-tag',
  RemoveMessageTag: 'email:remove-message-tag',
  ListCannedResponses: 'email:list-canned',
  SaveCannedResponse: 'email:save-canned',
  DeleteCannedResponse: 'email:delete-canned',
  ListAiPrompts: 'email:list-ai-prompts',
  SaveAiPrompt: 'email:save-ai-prompt',
  DeleteAiPrompt: 'email:delete-ai-prompt',
  AiTransformText: 'email:ai-transform-text',
  GetAiSettings: 'email:get-ai-settings',
  SetAiSettings: 'email:set-ai-settings',
  SetAiApiKey: 'email:set-ai-api-key',
  ClearAiApiKey: 'email:clear-ai-api-key',
  ListAiProfiles: 'email:list-ai-profiles',
  SaveAiProfile: 'email:save-ai-profile',
  DeleteAiProfile: 'email:delete-ai-profile',
  SetAiProfileApiKey: 'email:set-ai-profile-api-key',
  ClearAiProfileApiKey: 'email:clear-ai-profile-api-key',
  GetComposeSignature: 'email:get-compose-signature',
  ListAccountSignatures: 'email:list-account-signatures',
  SaveAccountSignature: 'email:save-account-signature',
  LinkCustomer: 'email:link-customer',
  SoftDeleteMessage: 'email:soft-delete-message',
  DeleteComposeDraft: 'email:delete-compose-draft',
  RestoreMessage: 'email:restore-message',
  SetMessageArchived: 'email:set-message-archived',
  RestoreInboxFromArchive: 'email:restore-inbox-from-archive',
  GetMessageRawHeaders: 'email:get-message-raw-headers',
  SetMessageSeen: 'email:set-message-seen',
  SetMessageSpam: 'email:set-message-spam',
  PickComposeAttachments: 'email:pick-compose-attachments',
  ListTeamMembers: 'email:list-team-members',
  SaveTeamMember: 'email:save-team-member',
  DeleteTeamMember: 'email:delete-team-member',
  AssignMessage: 'email:assign-message',
  GetGoogleOAuthApp: 'email:get-google-oauth-app',
  SetGoogleOAuthApp: 'email:set-google-oauth-app',
  BuildGoogleOAuthUrl: 'email:build-google-oauth-url',
  FinishGoogleOAuth: 'email:finish-google-oauth',
  TestPop3: 'email:test-pop3',
  CompileWorkflowGraph: 'email:compile-workflow-graph',
  ListWorkflowNodeCatalog: 'workflow:list-node-catalog',
  TestWorkflowOnMessage: 'workflow:test-on-message',
  ExecuteWorkflowNow: 'workflow:execute-now',
  ListWorkflowRuns: 'workflow:list-runs',
  ListWorkflowRunSteps: 'workflow:list-run-steps',
  ListWorkflowTemplates: 'workflow:list-templates',
  ImportWorkflowBundle: 'workflow:import-bundle',
  ExportWorkflowBundle: 'workflow:export-bundle',
  ImportWorkflowBundleFromFile: 'workflow:import-bundle-from-file',
  ExportWorkflowBundleToFile: 'workflow:export-bundle-to-file',
  GetWorkflowAutomationSettings: 'workflow:get-automation-settings',
  SetWorkflowAutomationSettings: 'workflow:set-automation-settings',
  ListKnowledgeBases: 'workflow:list-knowledge-bases',
  CreateKnowledgeBase: 'workflow:create-knowledge-base',
  DeleteKnowledgeBase: 'workflow:delete-knowledge-base',
  AddKnowledgeChunk: 'workflow:add-knowledge-chunk',
  ImportKnowledgeFile: 'workflow:import-knowledge-file',
  ListWorkflowPlugins: 'workflow:list-plugins',
  ListWorkflowVersions: 'workflow:list-versions',
  SaveWorkflowVersion: 'workflow:save-version',
  RestoreWorkflowVersion: 'workflow:restore-version',
  ListMessageAttachments: 'email:list-message-attachments',
  SaveAttachmentToDisk: 'email:save-attachment-to-disk',
  OpenAttachmentPath: 'email:open-attachment-path',
  EmailReporting: 'email:reporting',
  EmailGdprExport: 'email:gdpr-export',
  GetMicrosoftOAuthApp: 'email:get-microsoft-oauth-app',
  SetMicrosoftOAuthApp: 'email:set-microsoft-oauth-app',
  BuildMicrosoftOAuthUrl: 'email:build-microsoft-oauth-url',
  FinishMicrosoftOAuth: 'email:finish-microsoft-oauth',
});

export const IPCChannels = {
  Window: WindowChannels,
  Update: UpdateChannels,
  Db: DbChannels,
  Calendar: CalendarChannels,
  Products: ProductChannels,
  Deals: DealChannels,
  Tasks: TaskChannels,
  Sync: SyncChannels,
  Mssql: MssqlChannels,
  Jtl: JtlChannels,
  Dashboard: DashboardChannels,
  CustomFields: CustomFieldChannels,
  Email: EmailChannels,
  Automation: AutomationChannels,
  FollowUp: FollowUpChannels,
} as const;

// Flattened invoke list for preload allow-listing
export const AllowedInvokeChannels = tuple(
  ...Object.values(IPCChannels.Window),
  ...Object.values(IPCChannels.Update),
  ...Object.values(IPCChannels.Db),
  ...Object.values(IPCChannels.Calendar),
  ...Object.values(IPCChannels.Products),
  ...Object.values(IPCChannels.Deals),
  ...Object.values(IPCChannels.Tasks),
  ...Object.values(IPCChannels.Sync),
  ...Object.values(IPCChannels.Mssql),
  ...Object.values(IPCChannels.Jtl),
  ...Object.values(IPCChannels.Dashboard),
  ...Object.values(IPCChannels.CustomFields),
  ...Object.values(IPCChannels.Email),
  ...Object.values(IPCChannels.Automation),
  ...Object.values(IPCChannels.FollowUp),
);

export type InvokeChannel = typeof AllowedInvokeChannels[number];

export const DeprecatedInvokeChannels = tuple(
  IPCChannels.Deals.UpdateProductQuantityLegacy,
);

export type DeprecatedInvokeChannel = typeof DeprecatedInvokeChannels[number];

export type ChannelGroups = typeof IPCChannels;
