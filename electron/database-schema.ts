// simplecrmelectron/electron/database-schema.ts
export const CUSTOMERS_TABLE = 'customers';
export const PRODUCTS_TABLE = 'products';
export const DEAL_PRODUCTS_TABLE = 'deal_products';
export const SYNC_INFO_TABLE = 'sync_info'; // To store last sync status/time
export const CALENDAR_EVENTS_TABLE = 'calendar_events'; // Added
export const DEALS_TABLE = 'deals'; // Added deals table constant
export const TASKS_TABLE = 'tasks'; // Added tasks table constant
export const CUSTOMER_CUSTOM_FIELDS_TABLE = 'customer_custom_fields'; // Custom fields definitions
export const CUSTOMER_CUSTOM_FIELD_VALUES_TABLE = 'customer_custom_field_values'; // Custom field values

export const JTL_FIRMEN_TABLE = 'jtl_firmen';
export const JTL_WARENLAGER_TABLE = 'jtl_warenlager';
export const JTL_ZAHLUNGSARTEN_TABLE = 'jtl_zahlungsarten';
export const JTL_VERSANDARTEN_TABLE = 'jtl_versandarten';

export const EMAIL_ACCOUNTS_TABLE = 'email_accounts';
export const EMAIL_FOLDERS_TABLE = 'email_folders';
export const EMAIL_MESSAGES_TABLE = 'email_messages';
export const EMAIL_WORKFLOWS_TABLE = 'email_workflows';
export const EMAIL_WORKFLOW_RUNS_TABLE = 'email_workflow_runs';
export const EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE = 'email_message_workflow_applied';
export const EMAIL_MESSAGE_TAGS_TABLE = 'email_message_tags';
export const EMAIL_THREADS_TABLE = 'email_threads';
export const EMAIL_CATEGORIES_TABLE = 'email_categories';
export const EMAIL_MESSAGE_CATEGORIES_TABLE = 'email_message_categories';
export const EMAIL_INTERNAL_NOTES_TABLE = 'email_internal_notes';
export const EMAIL_CANNED_RESPONSES_TABLE = 'email_canned_responses';
export const EMAIL_AI_PROMPTS_TABLE = 'email_ai_prompts';
export const EMAIL_TEAM_MEMBERS_TABLE = 'email_team_members';
export const EMAIL_MESSAGE_ATTACHMENTS_TABLE = 'email_message_attachments';
export const EMAIL_MESSAGES_FTS_TABLE = 'email_messages_fts';
export const EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE = 'email_workflow_forward_dedup';

export const createCustomersTable = `
  CREATE TABLE IF NOT EXISTS ${CUSTOMERS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jtl_kKunde INTEGER UNIQUE, -- JTL primary key, nullable for local customers
    customerNumber TEXT,       -- JTL customer number (cKundenNr)
    name TEXT,
    firstName TEXT,
    company TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    street TEXT,
    zipCode TEXT,
    city TEXT,
    country TEXT,
    jtl_dateCreated DATETIME,
    jtl_blocked BOOLEAN,
    status TEXT DEFAULT 'Active', -- App-specific status if needed
    notes TEXT,                  -- App-specific notes
    affiliateLink TEXT,          -- App-specific affiliate link
    dateAdded DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastModifiedLocally DATETIME DEFAULT CURRENT_TIMESTAMP, -- Track local changes (though sync is one-way for now)
    lastSynced DATETIME          -- Timestamp of the last sync for this record
  );
`;

export const createProductsTable = `
  CREATE TABLE IF NOT EXISTS ${PRODUCTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jtl_kArtikel INTEGER UNIQUE NULL, -- Allow NULL for local products
    name TEXT NOT NULL,               -- Made NOT NULL
    sku TEXT UNIQUE NULL,             -- Allow NULL for local products
    description TEXT,
    price REAL NOT NULL DEFAULT 0.0, -- Added NOT NULL and DEFAULT
    isActive BOOLEAN NOT NULL DEFAULT 1, -- Added NOT NULL and DEFAULT
    dateCreated TEXT DEFAULT CURRENT_TIMESTAMP, -- Added (local creation date)
    lastModified TEXT DEFAULT CURRENT_TIMESTAMP, -- Renamed from lastModifiedLocally
    jtl_dateCreated TEXT NULL,       -- Changed type to TEXT for ISO string, kept from JTL
    lastSynced TEXT NULL,            -- Kept, changed type to TEXT
    lastModifiedLocally TEXT NULL    -- Added for sync conflict (can be same as lastModified initially)
  );
`;

// Added new table for Deal-Product relationship
export const createDealProductsTable = `
CREATE TABLE IF NOT EXISTS ${DEAL_PRODUCTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price_at_time_of_adding REAL NOT NULL,
    dateAdded TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES deals (id) ON DELETE CASCADE, -- Assuming 'deals' table exists with 'id' PK
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT, -- Or CASCADE, based on deletion policy
    UNIQUE(deal_id, product_id) -- Prevent adding the same product multiple times to the same deal
);
`;

// Store metadata about sync operations
export const createSyncInfoTable = `
  CREATE TABLE IF NOT EXISTS ${SYNC_INFO_TABLE} (
    key TEXT PRIMARY KEY,
    value TEXT,
    lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// Added schema for calendar events
export const createCalendarEventsTable = `
  CREATE TABLE IF NOT EXISTS ${CALENDAR_EVENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL, -- ISO 8601 string
    end_date TEXT NOT NULL,   -- ISO 8601 string
    all_day INTEGER NOT NULL DEFAULT 0, -- Use INTEGER for boolean (0/1)
    color_code TEXT,
    event_type TEXT,
    recurrence_rule TEXT,     -- Storing recurrence as JSON string
    task_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES ${TASKS_TABLE}(id) ON DELETE SET NULL
  );
`;

// Added schema for deals table
export const createDealsTable = `
  CREATE TABLE IF NOT EXISTS ${DEALS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    value REAL DEFAULT 0,
    value_calculation_method TEXT DEFAULT 'static', -- 'static' or 'dynamic'
    stage TEXT NOT NULL,
    notes TEXT,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    expected_close_date TEXT,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES ${CUSTOMERS_TABLE}(id) ON DELETE CASCADE
  );
`;

// Added schema for tasks table
export const createTasksTable = `
  CREATE TABLE IF NOT EXISTS ${TASKS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    priority TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    calendar_event_id INTEGER,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES ${CUSTOMERS_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (calendar_event_id) REFERENCES ${CALENDAR_EVENTS_TABLE}(id) ON DELETE SET NULL
  );
`;

export const createJtlFirmenTable = `
  CREATE TABLE IF NOT EXISTS ${JTL_FIRMEN_TABLE} (
    kFirma INTEGER PRIMARY KEY,
    cName TEXT
  );
`;

export const createJtlWarenlagerTable = `
  CREATE TABLE IF NOT EXISTS ${JTL_WARENLAGER_TABLE} (
    kWarenlager INTEGER PRIMARY KEY,
    cName TEXT
  );
`;

export const createJtlZahlungsartenTable = `
  CREATE TABLE IF NOT EXISTS ${JTL_ZAHLUNGSARTEN_TABLE} (
    kZahlungsart INTEGER PRIMARY KEY,
    cName TEXT
  );
`;

export const createJtlVersandartenTable = `
  CREATE TABLE IF NOT EXISTS ${JTL_VERSANDARTEN_TABLE} (
    kVersandart INTEGER PRIMARY KEY,
    cName TEXT
  );
`;

// Create table for custom field definitions
export const createCustomerCustomFieldsTable = `
  CREATE TABLE IF NOT EXISTS ${CUSTOMER_CUSTOM_FIELDS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL, -- 'text', 'number', 'date', 'boolean', 'select'
    required INTEGER NOT NULL DEFAULT 0, -- 0 = false, 1 = true
    options TEXT, -- JSON string for select options: [{"value": "option1", "label": "Option 1"}, ...]
    default_value TEXT, -- Default value for the field
    placeholder TEXT, -- Placeholder text for the field
    description TEXT, -- Help text for the field
    display_order INTEGER NOT NULL DEFAULT 0, -- Order in which to display fields
    active INTEGER NOT NULL DEFAULT 1, -- 0 = inactive, 1 = active
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

// Create table for custom field values
export const createCustomerCustomFieldValuesTable = `
  CREATE TABLE IF NOT EXISTS ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    field_id INTEGER NOT NULL,
    value TEXT, -- Store all values as text, convert as needed in the application
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES ${CUSTOMERS_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES ${CUSTOMER_CUSTOM_FIELDS_TABLE}(id) ON DELETE CASCADE,
    UNIQUE(customer_id, field_id) -- Each customer can have only one value per field
  );
`;

export const createEmailAccountsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_ACCOUNTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    email_address TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_tls INTEGER NOT NULL DEFAULT 1,
    imap_username TEXT NOT NULL,
    keytar_account_key TEXT NOT NULL UNIQUE,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    smtp_tls INTEGER NOT NULL DEFAULT 1,
    smtp_username TEXT,
    smtp_use_imap_auth INTEGER NOT NULL DEFAULT 1,
    smtp_keytar_account_key TEXT UNIQUE,
    protocol TEXT NOT NULL DEFAULT 'imap',
    pop3_host TEXT,
    pop3_port INTEGER DEFAULT 995,
    pop3_tls INTEGER NOT NULL DEFAULT 1,
    oauth_provider TEXT,
    oauth_refresh_keytar_key TEXT UNIQUE,
    sent_folder_path TEXT DEFAULT 'Sent',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const createEmailFoldersTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_FOLDERS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    delimiter TEXT DEFAULT '/',
    uidvalidity INTEGER,
    uidvalidity_str TEXT,
    last_uid INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT,
    pop3_uidl_str TEXT,
    FOREIGN KEY (account_id) REFERENCES ${EMAIL_ACCOUNTS_TABLE}(id) ON DELETE CASCADE,
    UNIQUE(account_id, path)
  );
`;

export const createEmailMessagesTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_MESSAGES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    folder_id INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    message_id TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    subject TEXT,
    from_json TEXT,
    to_json TEXT,
    cc_json TEXT,
    date_received TEXT,
    snippet TEXT,
    body_text TEXT,
    body_html TEXT,
    seen_local INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    soft_deleted INTEGER NOT NULL DEFAULT 0,
    outbound_hold INTEGER NOT NULL DEFAULT 0,
    outbound_block_reason TEXT,
    thread_id TEXT,
    ticket_code TEXT,
    customer_id INTEGER,
    folder_kind TEXT NOT NULL DEFAULT 'inbox',
    imap_thread_id TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT,
    assigned_to TEXT,
    pop3_uidl TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES ${EMAIL_ACCOUNTS_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES ${EMAIL_FOLDERS_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES ${CUSTOMERS_TABLE}(id) ON DELETE SET NULL,
    UNIQUE(account_id, folder_id, uid)
  );
`;

/** FTS5 external-content index on email_messages (rowid = message id). */
export const createEmailMessagesFtsTable = `
  CREATE VIRTUAL TABLE IF NOT EXISTS ${EMAIL_MESSAGES_FTS_TABLE} USING fts5(
    subject,
    snippet,
    body_text,
    content='${EMAIL_MESSAGES_TABLE}',
    content_rowid='id',
    tokenize = 'unicode61'
  );
`;

export const createEmailWorkflowForwardDedupTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} (
    message_id INTEGER NOT NULL,
    workflow_id INTEGER NOT NULL,
    dest TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, workflow_id, dest),
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES ${EMAIL_WORKFLOWS_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailThreadsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_THREADS_TABLE} (
    id TEXT PRIMARY KEY,
    ticket_code TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const createEmailCategoriesTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_CATEGORIES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES ${EMAIL_CATEGORIES_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailMessageCategoriesTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_MESSAGE_CATEGORIES_TABLE} (
    message_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY (message_id, category_id),
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES ${EMAIL_CATEGORIES_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailInternalNotesTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_INTERNAL_NOTES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailCannedResponsesTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_CANNED_RESPONSES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const createEmailTeamMembersTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_TEAM_MEMBERS_TABLE} (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const createEmailAiPromptsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_AI_PROMPTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    user_template TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT 'full_body',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

export const createEmailWorkflowsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_WORKFLOWS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,
    definition_json TEXT NOT NULL,
    graph_json TEXT,
    cron_expr TEXT,
    schedule_account_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_account_id) REFERENCES ${EMAIL_ACCOUNTS_TABLE}(id) ON DELETE SET NULL
  );
`;

export const createEmailMessageAttachmentsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    filename_display TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    content_sha256 TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailWorkflowRunsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_WORKFLOW_RUNS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id INTEGER NOT NULL,
    message_id INTEGER,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    log_json TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES ${EMAIL_WORKFLOWS_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE SET NULL
  );
`;

export const createEmailMessageWorkflowAppliedTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE} (
    message_id INTEGER NOT NULL,
    workflow_id INTEGER NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, workflow_id),
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES ${EMAIL_WORKFLOWS_TABLE}(id) ON DELETE CASCADE
  );
`;

export const createEmailMessageTagsTable = `
  CREATE TABLE IF NOT EXISTS ${EMAIL_MESSAGE_TAGS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES ${EMAIL_MESSAGES_TABLE}(id) ON DELETE CASCADE,
    UNIQUE(message_id, tag)
  );
`;

export const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_customers_jtl_kKunde ON ${CUSTOMERS_TABLE}(jtl_kKunde);`,
    `CREATE INDEX IF NOT EXISTS idx_customers_name ON ${CUSTOMERS_TABLE}(name);`,
    `CREATE INDEX IF NOT EXISTS idx_customers_email ON ${CUSTOMERS_TABLE}(email);`,
    `CREATE INDEX IF NOT EXISTS idx_products_jtl_kArtikel ON ${PRODUCTS_TABLE}(jtl_kArtikel);`,
    `CREATE INDEX IF NOT EXISTS idx_products_sku ON ${PRODUCTS_TABLE}(sku);`,
    `CREATE INDEX IF NOT EXISTS idx_products_name ON ${PRODUCTS_TABLE}(name);`,
    // Added indexes for new table
    `CREATE INDEX IF NOT EXISTS idx_deal_products_deal_id ON ${DEAL_PRODUCTS_TABLE}(deal_id);`,
    `CREATE INDEX IF NOT EXISTS idx_deal_products_product_id ON ${DEAL_PRODUCTS_TABLE}(product_id);`,
    // Added indexes for calendar events
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON ${CALENDAR_EVENTS_TABLE}(start_date);`,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_end_date ON ${CALENDAR_EVENTS_TABLE}(end_date);`,
    // Add indexes for deals and tasks
    `CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON ${DEALS_TABLE}(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_deals_stage ON ${DEALS_TABLE}(stage);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON ${TASKS_TABLE}(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON ${TASKS_TABLE}(due_date);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_completed ON ${TASKS_TABLE}(completed);`,
    `CREATE INDEX IF NOT EXISTS idx_jtl_firmen_name ON ${JTL_FIRMEN_TABLE}(cName);`,
    `CREATE INDEX IF NOT EXISTS idx_jtl_warenlager_name ON ${JTL_WARENLAGER_TABLE}(cName);`,
    `CREATE INDEX IF NOT EXISTS idx_jtl_zahlungsarten_name ON ${JTL_ZAHLUNGSARTEN_TABLE}(cName);`,
    `CREATE INDEX IF NOT EXISTS idx_jtl_versandarten_name ON ${JTL_VERSANDARTEN_TABLE}(cName);`,
    // Indexes for custom fields
    `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_name ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(name);`,
    `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_active ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(active);`,
    `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_display_order ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(display_order);`,
    `CREATE INDEX IF NOT EXISTS idx_customer_custom_field_values_customer_id ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_customer_custom_field_values_field_id ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(field_id);`,
    // Composite index for optimized custom field queries
    `CREATE INDEX IF NOT EXISTS idx_cfv_customer_field_composite ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(customer_id, field_id);`,
    // Covering index for the batch query
    `CREATE INDEX IF NOT EXISTS idx_cf_active_display ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(active, display_order, name) WHERE active = 1;`,
    `CREATE INDEX IF NOT EXISTS idx_email_accounts_address ON ${EMAIL_ACCOUNTS_TABLE}(email_address);`,
    `CREATE INDEX IF NOT EXISTS idx_email_folders_account ON ${EMAIL_FOLDERS_TABLE}(account_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_account_folder ON ${EMAIL_MESSAGES_TABLE}(account_id, folder_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_assigned ON ${EMAIL_MESSAGES_TABLE}(assigned_to);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_imap_thread ON ${EMAIL_MESSAGES_TABLE}(imap_thread_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_message_id ON ${EMAIL_MESSAGES_TABLE}(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_date ON ${EMAIL_MESSAGES_TABLE}(date_received);`,
    `CREATE INDEX IF NOT EXISTS idx_email_workflows_trigger ON ${EMAIL_WORKFLOWS_TABLE}(trigger, enabled, priority);`,
    `CREATE INDEX IF NOT EXISTS idx_email_workflow_runs_message ON ${EMAIL_WORKFLOW_RUNS_TABLE}(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_message_tags_message ON ${EMAIL_MESSAGE_TAGS_TABLE}(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_message_tags_tag ON ${EMAIL_MESSAGE_TAGS_TABLE}(tag);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON ${EMAIL_MESSAGES_TABLE}(thread_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_attach_message ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_ticket ON ${EMAIL_MESSAGES_TABLE}(ticket_code);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_customer ON ${EMAIL_MESSAGES_TABLE}(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_messages_folder_kind ON ${EMAIL_MESSAGES_TABLE}(account_id, folder_kind);`,
    `CREATE INDEX IF NOT EXISTS idx_email_categories_parent ON ${EMAIL_CATEGORIES_TABLE}(parent_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_msg_cat_category ON ${EMAIL_MESSAGE_CATEGORIES_TABLE}(category_id);`,
    `CREATE INDEX IF NOT EXISTS idx_email_notes_message ON ${EMAIL_INTERNAL_NOTES_TABLE}(message_id);`
];
