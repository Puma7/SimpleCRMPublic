import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import fs from 'fs';
import { ensureAssignedToReferentialIntegrity } from './email/email-assigned-to-integrity';
import { plainTextFromHtml } from './email/email-parse-utils';
import { runMailRoadmapMigrations } from './mail-roadmap-migrations';
import {
    createCustomersTable,
    createProductsTable,
    createSyncInfoTable,
    createDealProductsTable,
    createCalendarEventsTable,
    createDealsTable,
    createTasksTable,
    createCustomerCustomFieldsTable,
    createCustomerCustomFieldValuesTable,
    indexes,
    CUSTOMERS_TABLE,
    PRODUCTS_TABLE,
    DEAL_PRODUCTS_TABLE,
    SYNC_INFO_TABLE,
    CALENDAR_EVENTS_TABLE,
    DEALS_TABLE,
    TASKS_TABLE,
    CUSTOMER_CUSTOM_FIELDS_TABLE,
    CUSTOMER_CUSTOM_FIELD_VALUES_TABLE,
    JTL_FIRMEN_TABLE,
    JTL_WARENLAGER_TABLE,
    JTL_ZAHLUNGSARTEN_TABLE,
    JTL_VERSANDARTEN_TABLE,
    createJtlFirmenTable,
    createJtlWarenlagerTable,
    createJtlZahlungsartenTable,
    createJtlVersandartenTable,
    createEmailAccountsTable,
    createEmailFoldersTable,
    createEmailMessagesTable,
    createEmailWorkflowsTable,
    createEmailWorkflowRunsTable,
    createEmailMessageWorkflowAppliedTable,
    createEmailMessageTagsTable,
    createEmailThreadsTable,
    createEmailThreadAliasesTable,
    createEmailThreadEdgesTable,
    createEmailCategoriesTable,
    createEmailMessageCategoriesTable,
    createEmailInternalNotesTable,
    createEmailCannedResponsesTable,
    createEmailAiPromptsTable,
    createEmailTeamMembersTable,
    createEmailAccountSignaturesTable,
    createEmailAccountMailSettingsTable,
    createEmailAiProfilesTable,
    EMAIL_AI_PROFILES_TABLE,
    createEmailMessageAttachmentsTable,
    createEmailMessagesFtsTable,
    createEmailWorkflowForwardDedupTable,
    createEmailWorkflowRunStepsTable,
    createWorkflowKnowledgeBasesTable,
    createWorkflowKnowledgeChunksTable,
    createWorkflowDelayedJobsTable,
    createEmailWorkflowVersionsTable,
    createEmailSpamListEntriesTable,
    createEmailSpamLearningEventsTable,
    createEmailSpamFeatureStatsTable,
    createEmailSpamDecisionsTable,
    EMAIL_WORKFLOW_VERSIONS_TABLE,
    EMAIL_WORKFLOW_RUN_STEPS_TABLE,
    WORKFLOW_KNOWLEDGE_BASES_TABLE,
    WORKFLOW_KNOWLEDGE_CHUNKS_TABLE,
    WORKFLOW_DELAYED_JOBS_TABLE,
    EMAIL_SPAM_LIST_ENTRIES_TABLE,
    EMAIL_SPAM_LEARNING_EVENTS_TABLE,
    EMAIL_SPAM_FEATURE_STATS_TABLE,
    EMAIL_SPAM_DECISIONS_TABLE,
    EMAIL_ACCOUNTS_TABLE,
    EMAIL_FOLDERS_TABLE,
    EMAIL_MESSAGES_TABLE,
    EMAIL_WORKFLOWS_TABLE,
    EMAIL_WORKFLOW_RUNS_TABLE,
    EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE,
    EMAIL_MESSAGE_TAGS_TABLE,
    EMAIL_THREADS_TABLE,
    EMAIL_CATEGORIES_TABLE,
    EMAIL_MESSAGE_CATEGORIES_TABLE,
    EMAIL_INTERNAL_NOTES_TABLE,
    EMAIL_CANNED_RESPONSES_TABLE,
    EMAIL_AI_PROMPTS_TABLE,
    EMAIL_TEAM_MEMBERS_TABLE,
    EMAIL_ACCOUNT_SIGNATURES_TABLE,
    EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE,
    EMAIL_MESSAGE_ATTACHMENTS_TABLE,
    EMAIL_MESSAGES_FTS_TABLE,
    EMAIL_ATTACHMENTS_FTS_TABLE,
    createEmailAttachmentsFtsTable,
    EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE,
    ACTIVITY_LOG_TABLE,
    SAVED_VIEWS_TABLE,
    createActivityLogTable,
    createSavedViewsTable,
} from './database-schema';
import { Product, DealProduct } from './types';
// Optional: import Knex from 'knex';

function getDatabasePath(): string {
  try {
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'database.sqlite');
    }
  } catch {
    /* Electron app not available (Jest / tooling) */
  }
  const base =
    process.env.SIMPLECRM_USER_DATA ?? path.join(os.tmpdir(), 'simplecrm-test');
  return path.join(base, 'database.sqlite');
}
let db: Database.Database | undefined;
// Optional: let knex: Knex.Knex;
const isDevelopment = process.env.NODE_ENV === 'development';

const sqliteVerboseLogger = (...args: unknown[]) => {
    if (isDevelopment) {
        console.debug('[SQLite]', ...args);
    }
};

/**
 * Create all tables on an empty database (fresh install path).
 * Uses module `db` during FTS/migrations — safe for tests when `connection` is assigned temporarily.
 */
export function bootstrapFreshDatabaseSchema(
    connection: Database.Database,
    opts?: { keepDbAssigned?: boolean },
): void {
    const previousDb = db;
    db = connection;
    try {
        connection.exec('PRAGMA foreign_keys = ON;');

        connection.exec(createCustomersTable);
        connection.exec(createProductsTable);
        connection.exec(createSyncInfoTable);
        connection.exec(createDealsTable);
        connection.exec(createTasksTable);
        connection.exec(createDealProductsTable);
        connection.exec(createCalendarEventsTable);
        connection.exec(createCustomerCustomFieldsTable);
        connection.exec(createCustomerCustomFieldValuesTable);
        connection.exec(createActivityLogTable);
        connection.exec(createSavedViewsTable);
        connection.exec(createJtlFirmenTable);
        connection.exec(createJtlWarenlagerTable);
        connection.exec(createJtlZahlungsartenTable);
        connection.exec(createJtlVersandartenTable);
        connection.exec(createEmailAccountsTable);
        connection.exec(createEmailFoldersTable);
        connection.exec(createEmailTeamMembersTable);
        connection.exec(createEmailMessagesTable);
        connection.exec(createEmailWorkflowsTable);
        connection.exec(createEmailWorkflowRunsTable);
        connection.exec(createEmailMessageWorkflowAppliedTable);
        connection.exec(createEmailMessageTagsTable);
        connection.exec(createEmailThreadsTable);
        connection.exec(createEmailThreadAliasesTable);
        connection.exec(createEmailThreadEdgesTable);
        connection.exec(createEmailCategoriesTable);
        connection.exec(createEmailMessageCategoriesTable);
        connection.exec(createEmailInternalNotesTable);
        connection.exec(createEmailCannedResponsesTable);
        connection.exec(createEmailAiProfilesTable);
        connection.exec(createEmailAiPromptsTable);
        connection.exec(createEmailAccountSignaturesTable);
        connection.exec(createEmailAccountMailSettingsTable);
        connection.exec(createEmailMessageAttachmentsTable);
        connection.exec(createEmailWorkflowForwardDedupTable);
        connection.exec(createEmailWorkflowRunStepsTable);
        connection.exec(createWorkflowKnowledgeBasesTable);
        connection.exec(createWorkflowKnowledgeChunksTable);
        connection.exec(createWorkflowDelayedJobsTable);
        connection.exec(createEmailWorkflowVersionsTable);
        connection.exec(createEmailSpamListEntriesTable);
        connection.exec(createEmailSpamLearningEventsTable);
        connection.exec(createEmailSpamFeatureStatsTable);
        connection.exec(createEmailSpamDecisionsTable);
        indexes.forEach((index) => connection.exec(index));
        runMigrations();
        setupEmailFtsIndex();
        migrateEmailFtsSearchV2();
        migrateEmailFtsSearchV3();
        migrateAttachmentTextSearch();
        setSyncInfo('lastSyncStatus', 'Never');
        setSyncInfo('lastSyncTimestamp', '');
    } finally {
        if (!opts?.keepDbAssigned) {
            db = previousDb;
        }
    }
}

export function initializeDatabase() {
    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    const connection = new Database(dbPath, isDevelopment ? { verbose: sqliteVerboseLogger } : undefined);
    db = connection;

    if (!dbExists) {
        if (isDevelopment) {
            console.debug('Initializing new SQLite database...');
        }
        try {
            bootstrapFreshDatabaseSchema(connection, { keepDbAssigned: true });
            if (isDevelopment) {
                console.debug('Database initialized successfully.');
            }
        } catch (error) {
            console.error('Failed to initialize database schema:', error);
            throw error; // Rethrow to prevent app start with bad DB
        }
    } else {
        if (isDevelopment) {
            console.debug('Database already exists.');
        }
        // Ensure Foreign Keys are enabled on existing DBs too
        connection.exec('PRAGMA foreign_keys = ON;');
        // Here you could add migration logic if schema changes
        // Example: Check if deal_products table exists and create if not
        const checkTableStmt = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");

        // Helper function to check and create table with its indexes
        const ensureTableExists = (tableName: string, createTableSql: string, tableIndexes: string[]) => {
            if (!checkTableStmt.get(tableName)) {
                console.log(`Table ${tableName} not found, creating...`);
                try {
                    connection.exec(createTableSql);
                    tableIndexes.forEach(indexSql => {
                        // Ensure the index creation SQL targets the correct table, e.g., by checking if tableName is in indexSql
                        if (indexSql.includes(tableName)) {
                           connection.exec(indexSql);
                        }
                    });
                    console.log(`Table ${tableName} and its specific indexes created.`);
                } catch (error) {
                    console.error(`Failed to create table ${tableName} or its indexes:`, error);
                }
            }
        };

        ensureTableExists(DEAL_PRODUCTS_TABLE, createDealProductsTable, [
            `CREATE INDEX IF NOT EXISTS idx_deal_products_deal_id ON ${DEAL_PRODUCTS_TABLE}(deal_id);`,
            `CREATE INDEX IF NOT EXISTS idx_deal_products_product_id ON ${DEAL_PRODUCTS_TABLE}(product_id);`
        ]);
        ensureTableExists(DEALS_TABLE, createDealsTable, [
            `CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON ${DEALS_TABLE}(customer_id);`,
            `CREATE INDEX IF NOT EXISTS idx_deals_stage ON ${DEALS_TABLE}(stage);`
        ]);
        ensureTableExists(TASKS_TABLE, createTasksTable, [
            `CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON ${TASKS_TABLE}(customer_id);`,
            `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON ${TASKS_TABLE}(due_date);`,
            `CREATE INDEX IF NOT EXISTS idx_tasks_completed ON ${TASKS_TABLE}(completed);`
        ]);
        ensureTableExists(CALENDAR_EVENTS_TABLE, createCalendarEventsTable, [
            `CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON ${CALENDAR_EVENTS_TABLE}(start_date);`,
            `CREATE INDEX IF NOT EXISTS idx_calendar_events_end_date ON ${CALENDAR_EVENTS_TABLE}(end_date);`
        ]);
        ensureTableExists(JTL_FIRMEN_TABLE, createJtlFirmenTable, [
            `CREATE INDEX IF NOT EXISTS idx_jtl_firmen_name ON ${JTL_FIRMEN_TABLE}(cName);`
        ]);
        ensureTableExists(JTL_WARENLAGER_TABLE, createJtlWarenlagerTable, [
            `CREATE INDEX IF NOT EXISTS idx_jtl_warenlager_name ON ${JTL_WARENLAGER_TABLE}(cName);`
        ]);
        ensureTableExists(JTL_ZAHLUNGSARTEN_TABLE, createJtlZahlungsartenTable, [
            `CREATE INDEX IF NOT EXISTS idx_jtl_zahlungsarten_name ON ${JTL_ZAHLUNGSARTEN_TABLE}(cName);`
        ]);
        ensureTableExists(JTL_VERSANDARTEN_TABLE, createJtlVersandartenTable, [
            `CREATE INDEX IF NOT EXISTS idx_jtl_versandarten_name ON ${JTL_VERSANDARTEN_TABLE}(cName);`
        ]);

        // Ensure custom fields tables exist
        ensureTableExists(CUSTOMER_CUSTOM_FIELDS_TABLE, createCustomerCustomFieldsTable, [
            `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_name ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(name);`,
            `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_active ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(active);`,
            `CREATE INDEX IF NOT EXISTS idx_customer_custom_fields_display_order ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(display_order);`,
            // Covering index for the batch query
            `CREATE INDEX IF NOT EXISTS idx_cf_active_display ON ${CUSTOMER_CUSTOM_FIELDS_TABLE}(active, display_order, name) WHERE active = 1;`
        ]);

        ensureTableExists(CUSTOMER_CUSTOM_FIELD_VALUES_TABLE, createCustomerCustomFieldValuesTable, [
            `CREATE INDEX IF NOT EXISTS idx_customer_custom_field_values_customer_id ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(customer_id);`,
            `CREATE INDEX IF NOT EXISTS idx_customer_custom_field_values_field_id ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(field_id);`,
            // Composite index for optimized custom field queries
            `CREATE INDEX IF NOT EXISTS idx_cfv_customer_field_composite ON ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}(customer_id, field_id);`
        ]);

        ensureTableExists(EMAIL_ACCOUNTS_TABLE, createEmailAccountsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_accounts_address ON ${EMAIL_ACCOUNTS_TABLE}(email_address);`,
        ]);
        ensureTableExists(EMAIL_FOLDERS_TABLE, createEmailFoldersTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_folders_account ON ${EMAIL_FOLDERS_TABLE}(account_id);`,
        ]);
        ensureTableExists(EMAIL_MESSAGES_TABLE, createEmailMessagesTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_messages_account_folder ON ${EMAIL_MESSAGES_TABLE}(account_id, folder_id);`,
            `CREATE INDEX IF NOT EXISTS idx_email_messages_message_id ON ${EMAIL_MESSAGES_TABLE}(message_id);`,
            `CREATE INDEX IF NOT EXISTS idx_email_messages_date ON ${EMAIL_MESSAGES_TABLE}(date_received);`,
            `CREATE INDEX IF NOT EXISTS idx_email_messages_assigned ON ${EMAIL_MESSAGES_TABLE}(assigned_to);`,
            `CREATE INDEX IF NOT EXISTS idx_email_messages_imap_thread ON ${EMAIL_MESSAGES_TABLE}(imap_thread_id);`,
        ]);

        ensureTableExists(EMAIL_WORKFLOWS_TABLE, createEmailWorkflowsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_workflows_trigger ON ${EMAIL_WORKFLOWS_TABLE}(trigger, enabled, priority);`,
        ]);
        ensureTableExists(EMAIL_WORKFLOW_RUNS_TABLE, createEmailWorkflowRunsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_workflow_runs_message ON ${EMAIL_WORKFLOW_RUNS_TABLE}(message_id);`,
        ]);
        ensureTableExists(EMAIL_MESSAGE_WORKFLOW_APPLIED_TABLE, createEmailMessageWorkflowAppliedTable, []);
        ensureTableExists(EMAIL_MESSAGE_TAGS_TABLE, createEmailMessageTagsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_message_tags_message ON ${EMAIL_MESSAGE_TAGS_TABLE}(message_id);`,
            `CREATE INDEX IF NOT EXISTS idx_email_message_tags_tag ON ${EMAIL_MESSAGE_TAGS_TABLE}(tag);`,
        ]);

        ensureTableExists(EMAIL_THREADS_TABLE, createEmailThreadsTable, []);
        ensureTableExists(EMAIL_CATEGORIES_TABLE, createEmailCategoriesTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_categories_parent ON ${EMAIL_CATEGORIES_TABLE}(parent_id);`,
        ]);
        ensureTableExists(EMAIL_MESSAGE_CATEGORIES_TABLE, createEmailMessageCategoriesTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_msg_cat_category ON ${EMAIL_MESSAGE_CATEGORIES_TABLE}(category_id);`,
        ]);
        ensureTableExists(EMAIL_INTERNAL_NOTES_TABLE, createEmailInternalNotesTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_notes_message ON ${EMAIL_INTERNAL_NOTES_TABLE}(message_id);`,
        ]);
        ensureTableExists(EMAIL_CANNED_RESPONSES_TABLE, createEmailCannedResponsesTable, []);
        ensureTableExists(EMAIL_AI_PROMPTS_TABLE, createEmailAiPromptsTable, []);
        ensureTableExists(EMAIL_TEAM_MEMBERS_TABLE, createEmailTeamMembersTable, []);
        ensureTableExists(EMAIL_ACCOUNT_SIGNATURES_TABLE, createEmailAccountSignaturesTable, []);
        ensureTableExists(EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE, createEmailAccountMailSettingsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_account_mail_settings_prefix ON ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}(ticket_prefix);`,
        ]);
        ensureTableExists(EMAIL_AI_PROFILES_TABLE, createEmailAiProfilesTable, []);
        ensureTableExists(EMAIL_MESSAGE_ATTACHMENTS_TABLE, createEmailMessageAttachmentsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_attach_message ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}(message_id);`,
        ]);

        ensureTableExists(ACTIVITY_LOG_TABLE, createActivityLogTable, [
            `CREATE INDEX IF NOT EXISTS idx_activity_log_customer_id ON ${ACTIVITY_LOG_TABLE}(customer_id);`,
            `CREATE INDEX IF NOT EXISTS idx_activity_log_deal_id ON ${ACTIVITY_LOG_TABLE}(deal_id);`,
            `CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON ${ACTIVITY_LOG_TABLE}(created_at);`,
            `CREATE INDEX IF NOT EXISTS idx_activity_log_customer_created ON ${ACTIVITY_LOG_TABLE}(customer_id, created_at);`
        ]);

        ensureTableExists(SAVED_VIEWS_TABLE, createSavedViewsTable, []);

        // Run migrations for schema updates
        runMigrations();
    }

    // Optional Knex initialization
    // knex = Knex({
    //   client: 'better-sqlite3',
    //   connection: { filename: dbPath },
    //   useNullAsDefault: true
    // });

    console.log(`Database connection established: ${dbPath}`);
    setupPragmas();
}

function setupPragmas() {
    if (!db) return;
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
    db.pragma('synchronous = NORMAL'); // Good balance of safety and speed
    // Foreign keys are enabled in initializeDatabase now
}

/**
 * Idempotently (re)create the email_messages FTS5 sync triggers. The column
 * list is introspected from the actual FTS table so the triggers always match
 * its shape (a v2 table gets v2-column triggers, a v3 table v3 columns) —
 * otherwise every mail ingest would fail between schema versions. Existing
 * triggers are recreated when their SQL no longer matches the table columns.
 */
function ensureEmailFtsTriggers() {
    if (!db) return;
    const ftsCols = (db.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_FTS_TABLE})`).all() as { name: string }[])
        .map((c) => c.name);
    if (ftsCols.length === 0) return; // no FTS table — nothing to keep in sync
    const colList = ftsCols.join(', ');
    const newValues = ftsCols.map((c) => `new.${c}`).join(', ');
    const oldValues = ftsCols.map((c) => `old.${c}`).join(', ');
    const triggers = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'email_messages_fts_%'")
        .all() as { name: string; sql: string | null }[];
    const byName = new Map(triggers.map((t) => [t.name, t.sql ?? '']));
    // External-content FTS5 verlangt beim 'delete' die ALTEN Spaltenwerte —
    // sonst akkumuliert der Index stale Eintraege und integrity-check bricht.
    const deleteForm = `VALUES('delete', old.id, ${oldValues})`;
    const aiOk = byName.get('email_messages_fts_ai')?.includes(`(rowid, ${colList})`) ?? false;
    const adOk = byName.get('email_messages_fts_ad')?.includes(deleteForm) ?? false;
    const auOk = (byName.get('email_messages_fts_au')?.includes(deleteForm) ?? false)
        && (byName.get('email_messages_fts_au')?.includes(`(rowid, ${colList})`) ?? false);
    if (aiOk && adOk && auOk) return;
    console.log('Repairing email_messages FTS5 triggers...');
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ai`);
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ad`);
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_au`);
    db.exec(`
      CREATE TRIGGER email_messages_fts_ai AFTER INSERT ON ${EMAIL_MESSAGES_TABLE} BEGIN
        INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(rowid, ${colList})
        VALUES (new.id, ${newValues});
      END;
    `);
    db.exec(`
      CREATE TRIGGER email_messages_fts_ad AFTER DELETE ON ${EMAIL_MESSAGES_TABLE} BEGIN
        INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}, rowid, ${colList})
        VALUES('delete', old.id, ${oldValues});
      END;
    `);
    db.exec(`
      CREATE TRIGGER email_messages_fts_au AFTER UPDATE ON ${EMAIL_MESSAGES_TABLE} BEGIN
        INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}, rowid, ${colList})
        VALUES('delete', old.id, ${oldValues});
        INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(rowid, ${colList})
        VALUES (new.id, ${newValues});
      END;
    `);
}

function emailFtsSearchVersion(): number {
    const raw = getSyncInfo('email_fts_search_version');
    const n = Number.parseInt(raw ?? '0', 10);
    return Number.isFinite(n) ? n : 0;
}

/** Rebuild FTS when recipient/ticket columns were added (Codex P1 search). */
function migrateEmailFtsSearchV2(): void {
    if (!db) return;
    // >= 2 also covers v3 databases — never downgrade the version marker.
    if (emailFtsSearchVersion() >= 2) return;
    const ftsMaster = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(EMAIL_MESSAGES_FTS_TABLE) as { name: string } | undefined;
    if (!ftsMaster) {
        setSyncInfo('email_fts_search_version', '2');
        return;
    }
    const cols = db.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_FTS_TABLE})`).all() as { name: string }[];
    if (cols.some((c) => c.name === 'from_json')) {
        setSyncInfo('email_fts_search_version', '2');
        return;
    }
    console.log('Migrating email_messages FTS to v2 (recipients + ticket)...');
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ai`);
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ad`);
    db.exec(`DROP TRIGGER IF EXISTS email_messages_fts_au`);
    db.exec(`DROP TABLE IF EXISTS ${EMAIL_MESSAGES_FTS_TABLE}`);
    db.exec(createEmailMessagesFtsTable);
    db.exec(`INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}) VALUES('rebuild')`);
    ensureEmailFtsTriggers();
    setSyncInfo('email_fts_search_version', '2');
}

/**
 * FTS v3 (Mail Search Phase 1): attachments_json column + prefix index.
 * Runs as ONE transaction so a crash rolls back to a clean v2 state:
 * drop triggers -> backfill body_text from body_html for HTML-only mail
 * (no triggers firing into the doomed index) -> recreate table -> rebuild
 * -> recreate triggers (introspected columns) -> set version '3'.
 */
function migrateEmailFtsSearchV3(): void {
    if (!db) return;
    if (emailFtsSearchVersion() >= 3) return;
    const conn = db;
    console.log('Migrating email_messages FTS to v3 (attachments + prefix + body_text backfill)...');
    conn.exec('BEGIN');
    try {
        conn.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ai`);
        conn.exec(`DROP TRIGGER IF EXISTS email_messages_fts_ad`);
        conn.exec(`DROP TRIGGER IF EXISTS email_messages_fts_au`);

        const selectBatch = conn.prepare(
            `SELECT id, body_html FROM ${EMAIL_MESSAGES_TABLE}
             WHERE id > ? AND (body_text IS NULL OR body_text = '')
               AND body_html IS NOT NULL AND body_html <> ''
             ORDER BY id LIMIT 200`,
        );
        const updateBody = conn.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET body_text = ? WHERE id = ?`);
        let lastId = 0;
        let backfilled = 0;
        for (;;) {
            const rows = selectBatch.all(lastId) as { id: number; body_html: string }[];
            if (rows.length === 0) break;
            lastId = rows[rows.length - 1]!.id;
            for (const row of rows) {
                const text = plainTextFromHtml(row.body_html);
                if (text.length === 0) continue;
                updateBody.run(text, row.id);
                backfilled += 1;
            }
        }
        if (backfilled > 0) {
            console.log(`FTS v3: backfilled body_text for ${backfilled} HTML-only messages`);
        }

        conn.exec(`DROP TABLE IF EXISTS ${EMAIL_MESSAGES_FTS_TABLE}`);
        conn.exec(createEmailMessagesFtsTable);
        conn.exec(`INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}) VALUES('rebuild')`);
        ensureEmailFtsTriggers();
        setSyncInfo('email_fts_search_version', '3');
        conn.exec('COMMIT');
    } catch (error) {
        try {
            conn.exec('ROLLBACK');
        } catch {
            /* connection may already have rolled back */
        }
        console.error('FTS v3 migration failed — keeping previous FTS state, will retry next start:', error);
    }
}

function setupEmailFtsIndex() {
    if (!db) return;
    const ftsMaster = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_MESSAGES_FTS_TABLE);
    if (!ftsMaster) {
        console.log('Creating email_messages FTS5 index...');
        db.exec(createEmailMessagesFtsTable);
        db.exec(`INSERT INTO ${EMAIL_MESSAGES_FTS_TABLE}(${EMAIL_MESSAGES_FTS_TABLE}) VALUES('rebuild')`);
        // Fresh table already has the v3 shape. Mark the version only when no
        // key exists yet (true fresh install); an existing key means an
        // upgrade path whose migrations (e.g. body_text backfill) must still
        // run against the recreated table.
        if (getSyncInfo('email_fts_search_version') == null) {
            setSyncInfo('email_fts_search_version', '3');
        }
    }
    ensureEmailFtsTriggers();
}

/**
 * Idempotently (re)create the email_attachments_fts sync triggers with the
 * same introspection hardening as the message FTS triggers.
 */
function ensureAttachmentsFtsTriggers() {
    if (!db) return;
    const ftsCols = (db.prepare(`PRAGMA table_info(${EMAIL_ATTACHMENTS_FTS_TABLE})`).all() as { name: string }[])
        .map((c) => c.name);
    if (ftsCols.length === 0) return; // no FTS table — nothing to keep in sync
    const colList = ftsCols.join(', ');
    const newValues = ftsCols.map((c) => `new.${c}`).join(', ');
    const oldValues = ftsCols.map((c) => `old.${c}`).join(', ');
    const triggers = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'email_attachments_fts_%'")
        .all() as { name: string; sql: string | null }[];
    const byName = new Map(triggers.map((t) => [t.name, t.sql ?? '']));
    // External-content FTS5 verlangt beim 'delete' die ALTEN Spaltenwerte.
    const deleteForm = `VALUES('delete', old.id, ${oldValues})`;
    const aiOk = byName.get('email_attachments_fts_ai')?.includes(`(rowid, ${colList})`) ?? false;
    const adOk = byName.get('email_attachments_fts_ad')?.includes(deleteForm) ?? false;
    const auOk = (byName.get('email_attachments_fts_au')?.includes(deleteForm) ?? false)
        && (byName.get('email_attachments_fts_au')?.includes(`(rowid, ${colList})`) ?? false);
    if (aiOk && adOk && auOk) return;
    console.log('Repairing email_attachments FTS5 triggers...');
    db.exec(`DROP TRIGGER IF EXISTS email_attachments_fts_ai`);
    db.exec(`DROP TRIGGER IF EXISTS email_attachments_fts_ad`);
    db.exec(`DROP TRIGGER IF EXISTS email_attachments_fts_au`);
    db.exec(`
      CREATE TRIGGER email_attachments_fts_ai AFTER INSERT ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} BEGIN
        INSERT INTO ${EMAIL_ATTACHMENTS_FTS_TABLE}(rowid, ${colList})
        VALUES (new.id, ${newValues});
      END;
    `);
    db.exec(`
      CREATE TRIGGER email_attachments_fts_ad AFTER DELETE ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} BEGIN
        INSERT INTO ${EMAIL_ATTACHMENTS_FTS_TABLE}(${EMAIL_ATTACHMENTS_FTS_TABLE}, rowid, ${colList})
        VALUES('delete', old.id, ${oldValues});
      END;
    `);
    db.exec(`
      CREATE TRIGGER email_attachments_fts_au AFTER UPDATE ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} BEGIN
        INSERT INTO ${EMAIL_ATTACHMENTS_FTS_TABLE}(${EMAIL_ATTACHMENTS_FTS_TABLE}, rowid, ${colList})
        VALUES('delete', old.id, ${oldValues});
        INSERT INTO ${EMAIL_ATTACHMENTS_FTS_TABLE}(rowid, ${colList})
        VALUES (new.id, ${newValues});
      END;
    `);
}

/**
 * Suche Phase 2: text_content/text_extracted_at on email_message_attachments
 * plus the email_attachments_fts index. Structural guards (PRAGMA/
 * sqlite_master) make this idempotent; the initial creation runs in one
 * transaction so a crash leaves no half-migrated state. Fresh installs end in
 * the same state (columns come from the schema, the FTS table from here).
 */
function migrateAttachmentTextSearch(): void {
    if (!db) return;
    const conn = db;
    const cols = (conn.prepare(`PRAGMA table_info(${EMAIL_MESSAGE_ATTACHMENTS_TABLE})`).all() as { name: string }[])
        .map((c) => c.name);
    if (cols.length === 0) return; // attachments table not created yet
    const ftsMaster = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(EMAIL_ATTACHMENTS_FTS_TABLE) as { name: string } | undefined;
    const needCols = !cols.includes('text_content') || !cols.includes('text_extracted_at');
    if (!needCols && ftsMaster) {
        ensureAttachmentsFtsTriggers();
        return;
    }
    console.log('Migrating email_message_attachments for text search...');
    conn.exec('BEGIN');
    try {
        if (!cols.includes('text_content')) {
            conn.exec(`ALTER TABLE ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} ADD COLUMN text_content TEXT`);
        }
        if (!cols.includes('text_extracted_at')) {
            conn.exec(`ALTER TABLE ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} ADD COLUMN text_extracted_at TEXT`);
        }
        if (!ftsMaster) {
            conn.exec(createEmailAttachmentsFtsTable);
            conn.exec(`INSERT INTO ${EMAIL_ATTACHMENTS_FTS_TABLE}(${EMAIL_ATTACHMENTS_FTS_TABLE}) VALUES('rebuild')`);
        }
        ensureAttachmentsFtsTriggers();
        conn.exec('COMMIT');
    } catch (error) {
        try {
            conn.exec('ROLLBACK');
        } catch {
            /* connection may already have rolled back */
        }
        console.error('Attachment text search migration failed — will retry next start:', error);
    }
}

/**
 * Run database migrations to update schema for existing databases
 */
function runMigrations() {
    if (!db) {
        throw new Error('Database not initialized');
    }
    const conn = db;

    try {
        // Migration: Add value_calculation_method column to deals table if it doesn't exist
        const checkColumnStmt = db.prepare(`PRAGMA table_info(${DEALS_TABLE})`);
        const columns = checkColumnStmt.all();

        // Check if value_calculation_method column exists
        const hasValueCalculationMethod = columns.some((col: any) => col.name === 'value_calculation_method');

        if (!hasValueCalculationMethod) {
            console.log('Adding value_calculation_method column to deals table...');
            db.exec(`ALTER TABLE ${DEALS_TABLE} ADD COLUMN value_calculation_method TEXT DEFAULT 'static'`);
            console.log('Migration completed: Added value_calculation_method column to deals table');
        }

        // Migration: Add calendar_event_id column to tasks table if it doesn't exist
        const taskColumnsStmt = db.prepare(`PRAGMA table_info(${TASKS_TABLE})`);
        const taskColumns = taskColumnsStmt.all();
        const hasCalendarEventId = taskColumns.some((col: any) => col.name === 'calendar_event_id');

        if (!hasCalendarEventId) {
            console.log('Adding calendar_event_id column to tasks table...');
            db.exec(`ALTER TABLE ${TASKS_TABLE} ADD COLUMN calendar_event_id INTEGER`);
            console.log('Migration completed: Added calendar_event_id column to tasks table');
        }

        // Migration: Add task_id column to calendar events table if it doesn't exist
        const calendarColumnsStmt = db.prepare(`PRAGMA table_info(${CALENDAR_EVENTS_TABLE})`);
        const calendarColumns = calendarColumnsStmt.all();
        const hasTaskId = calendarColumns.some((col: any) => col.name === 'task_id');

        if (!hasTaskId) {
            console.log('Adding task_id column to calendar events table...');
            db.exec(`ALTER TABLE ${CALENDAR_EVENTS_TABLE} ADD COLUMN task_id INTEGER`);
            console.log('Migration completed: Added task_id column to calendar events table');
        }

        // Migration: Add customerNumber column to customers table if it doesn't exist
        const customerColumns = db.prepare(`PRAGMA table_info(${CUSTOMERS_TABLE})`).all();
        const hasCustomerNumber = customerColumns.some((col: any) => col.name === 'customerNumber');

        if (!hasCustomerNumber) {
            console.log('Adding customerNumber column to customers table...');
            db.exec(`ALTER TABLE ${CUSTOMERS_TABLE} ADD COLUMN customerNumber TEXT`);
            console.log('Migration completed: Added customerNumber column to customers table');
        }

        const emailFolderExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_FOLDERS_TABLE);
        const emailFolderColumns = emailFolderExists
            ? db.prepare(`PRAGMA table_info(${EMAIL_FOLDERS_TABLE})`).all()
            : [];
        const hasEmailFolderUidValidityStr = emailFolderColumns.some((col: any) => col.name === 'uidvalidity_str');
        if (!hasEmailFolderUidValidityStr && emailFolderExists) {
            console.log('Adding uidvalidity_str column to email_folders table...');
            db.exec(`ALTER TABLE ${EMAIL_FOLDERS_TABLE} ADD COLUMN uidvalidity_str TEXT`);
            db.exec(
                `UPDATE ${EMAIL_FOLDERS_TABLE} SET uidvalidity_str = CAST(uidvalidity AS TEXT) WHERE uidvalidity IS NOT NULL AND (uidvalidity_str IS NULL OR uidvalidity_str = '')`,
            );
            console.log('Migration completed: Added uidvalidity_str to email_folders');
        }

        const msgTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_MESSAGES_TABLE);
        if (msgTableExists) {
            const readMsgCols = () =>
                new Set(
                    (conn.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_TABLE})`).all() as { name: string }[]).map(
                        (c) => c.name,
                    ),
                );
            let msgColNames = readMsgCols();
            if (!msgColNames.has('outbound_hold')) {
                console.log('Adding outbound_hold to email_messages...');
                db.exec(`ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN outbound_hold INTEGER NOT NULL DEFAULT 0`);
                msgColNames = readMsgCols();
            }
            if (!msgColNames.has('outbound_block_reason')) {
                console.log('Adding outbound_block_reason to email_messages...');
                db.exec(`ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN outbound_block_reason TEXT`);
                msgColNames = readMsgCols();
            }
            const emailMsgCols = [
                { name: 'thread_id', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN thread_id TEXT` },
                { name: 'ticket_code', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN ticket_code TEXT` },
                { name: 'customer_id', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN customer_id INTEGER` },
                { name: 'folder_kind', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN folder_kind TEXT NOT NULL DEFAULT 'inbox'` },
            ];
            for (const col of emailMsgCols) {
                if (!msgColNames.has(col.name)) {
                    console.log(`Adding ${col.name} to email_messages...`);
                    db.exec(col.sql);
                    msgColNames = readMsgCols();
                }
            }
            if (msgColNames.has('folder_kind')) {
                db.exec(`UPDATE ${EMAIL_MESSAGES_TABLE} SET folder_kind = 'inbox' WHERE folder_kind IS NULL OR folder_kind = ''`);
            }
        }

        const accTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_ACCOUNTS_TABLE);
        if (accTable) {
            const ac = db.prepare(`PRAGMA table_info(${EMAIL_ACCOUNTS_TABLE})`).all() as { name: string }[];
            const an = new Set(ac.map((c) => c.name));
            const addAcc = (name: string, sql: string) => {
                if (!an.has(name)) {
                    console.log(`Adding ${name} to email_accounts...`);
                    conn.exec(sql);
                    an.add(name);
                }
            };
            addAcc('smtp_host', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_host TEXT`);
            addAcc('smtp_port', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_port INTEGER DEFAULT 587`);
            addAcc('smtp_tls', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_tls INTEGER NOT NULL DEFAULT 1`);
            addAcc('smtp_username', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_username TEXT`);
            addAcc('smtp_use_imap_auth', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_use_imap_auth INTEGER NOT NULL DEFAULT 1`);
            addAcc('smtp_keytar_account_key', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN smtp_keytar_account_key TEXT UNIQUE`);
            addAcc('protocol', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN protocol TEXT NOT NULL DEFAULT 'imap'`);
            addAcc('pop3_host', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN pop3_host TEXT`);
            addAcc('pop3_port', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN pop3_port INTEGER DEFAULT 995`);
            addAcc('pop3_tls', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN pop3_tls INTEGER NOT NULL DEFAULT 1`);
            addAcc('oauth_provider', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN oauth_provider TEXT`);
            addAcc('oauth_refresh_keytar_key', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN oauth_refresh_keytar_key TEXT UNIQUE`);
            addAcc('sent_folder_path', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN sent_folder_path TEXT DEFAULT 'Sent'`);
            addAcc(
                'imap_sync_seen_on_open',
                `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN imap_sync_seen_on_open INTEGER NOT NULL DEFAULT 1`,
            );
            addAcc('vacation_enabled', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN vacation_enabled INTEGER NOT NULL DEFAULT 0`);
            addAcc('vacation_subject', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN vacation_subject TEXT`);
            addAcc('vacation_body_text', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN vacation_body_text TEXT`);
            addAcc('request_read_receipt', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN request_read_receipt INTEGER NOT NULL DEFAULT 0`);
            addAcc('sync_spam_folder_path', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN sync_spam_folder_path TEXT`);
            addAcc('sync_archive_folder_path', `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN sync_archive_folder_path TEXT`);
            addAcc(
                'imap_sync_sent',
                `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN imap_sync_sent INTEGER NOT NULL DEFAULT 0`,
            );
            addAcc(
                'imap_sync_archive',
                `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN imap_sync_archive INTEGER NOT NULL DEFAULT 0`,
            );
            addAcc(
                'imap_sync_spam',
                `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN imap_sync_spam INTEGER NOT NULL DEFAULT 0`,
            );
            addAcc(
                'imap_delete_opt_in',
                `ALTER TABLE ${EMAIL_ACCOUNTS_TABLE} ADD COLUMN imap_delete_opt_in INTEGER NOT NULL DEFAULT 0`,
            );
        }

        const kbTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(WORKFLOW_KNOWLEDGE_BASES_TABLE);
        if (kbTable) {
            const kbCols = db.prepare(`PRAGMA table_info(${WORKFLOW_KNOWLEDGE_BASES_TABLE})`).all() as { name: string }[];
            const kbNames = new Set(kbCols.map((c) => c.name));
            if (!kbNames.has('knowledge_context')) {
                console.log('Adding knowledge_context to workflow_knowledge_bases...');
                db.exec(`ALTER TABLE ${WORKFLOW_KNOWLEDGE_BASES_TABLE} ADD COLUMN knowledge_context TEXT`);
            }
        }

        if (emailFolderExists) {
            const fc = db.prepare(`PRAGMA table_info(${EMAIL_FOLDERS_TABLE})`).all() as { name: string }[];
            const fn = new Set(fc.map((c) => c.name));
            if (!fn.has('pop3_uidl_str')) {
                console.log('Adding pop3_uidl_str to email_folders...');
                db.exec(`ALTER TABLE ${EMAIL_FOLDERS_TABLE} ADD COLUMN pop3_uidl_str TEXT`);
            }
        }

        if (msgTableExists) {
            const readMsgCols2 = () =>
                new Set(
                    (conn.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_TABLE})`).all() as { name: string }[]).map(
                        (c) => c.name,
                    ),
                );
            let mcn = readMsgCols2();
            const extraMsg = [
                { name: 'imap_thread_id', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN imap_thread_id TEXT` },
                { name: 'has_attachments', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0` },
                { name: 'attachments_json', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN attachments_json TEXT` },
                { name: 'assigned_to', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN assigned_to TEXT` },
                { name: 'pop3_uidl', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN pop3_uidl TEXT` },
                { name: 'raw_headers', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN raw_headers TEXT` },
                { name: 'raw_rfc822_b64', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN raw_rfc822_b64 TEXT` },
                { name: 'is_spam', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN is_spam INTEGER NOT NULL DEFAULT 0` },
                { name: 'spam_status', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_status TEXT NOT NULL DEFAULT 'clean'` },
                { name: 'spam_score', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_score INTEGER` },
                { name: 'spam_score_label', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_score_label TEXT` },
                { name: 'spam_decision_source', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_decision_source TEXT` },
                { name: 'spam_score_breakdown_json', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_score_breakdown_json TEXT` },
                { name: 'spam_decided_at', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN spam_decided_at TEXT` },
                { name: 'auth_spf', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_spf TEXT` },
                { name: 'auth_dkim', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_dkim TEXT` },
                { name: 'auth_dmarc', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_dmarc TEXT` },
                { name: 'auth_arc', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_arc TEXT` },
                { name: 'auth_dkim_domains', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_dkim_domains TEXT` },
                { name: 'auth_error', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN auth_error TEXT` },
                { name: 'rspamd_score', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN rspamd_score REAL` },
                { name: 'rspamd_action', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN rspamd_action TEXT` },
                { name: 'rspamd_symbols', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN rspamd_symbols TEXT` },
                { name: 'rspamd_error', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN rspamd_error TEXT` },
                { name: 'security_checked_at', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN security_checked_at TEXT` },
                { name: 'reply_suggestion_text', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN reply_suggestion_text TEXT` },
                { name: 'reply_suggestion_status', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN reply_suggestion_status TEXT` },
                { name: 'reply_suggestion_error', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN reply_suggestion_error TEXT` },
                { name: 'reply_suggestion_updated_at', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN reply_suggestion_updated_at TEXT` },
                { name: 'bcc_json', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN bcc_json TEXT` },
                { name: 'snoozed_until', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN snoozed_until TEXT` },
                { name: 'scheduled_send_at', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN scheduled_send_at TEXT` },
                { name: 'draft_attachment_paths_json', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN draft_attachment_paths_json TEXT` },
                { name: 'post_process_done', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN post_process_done INTEGER NOT NULL DEFAULT 1` },
                { name: 'reply_parent_message_id', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN reply_parent_message_id INTEGER` },
                { name: 'done_local', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN done_local INTEGER NOT NULL DEFAULT 0` },
                { name: 'sent_imap_sync_failed', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN sent_imap_sync_failed INTEGER NOT NULL DEFAULT 0` },
                { name: 'seen_sync_pending', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN seen_sync_pending INTEGER NOT NULL DEFAULT 0` },
            ];
            for (const col of extraMsg) {
                if (!mcn.has(col.name)) {
                    console.log(`Adding ${col.name} to email_messages...`);
                    db.exec(col.sql);
                    mcn = readMsgCols2();
                }
            }
            const trashSnap = [
                { name: 'trash_prev_archived', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN trash_prev_archived INTEGER` },
                { name: 'trash_prev_is_spam', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN trash_prev_is_spam INTEGER` },
                { name: 'trash_prev_folder_kind', sql: `ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN trash_prev_folder_kind TEXT` },
            ];
            for (const col of trashSnap) {
                if (!mcn.has(col.name)) {
                    console.log(`Adding ${col.name} to email_messages...`);
                    db.exec(col.sql);
                    mcn = readMsgCols2();
                }
            }
            if (!getSyncInfo('done_local_handled_backfill_v1')) {
                const backfill = db
                    .prepare(
                        `UPDATE ${EMAIL_MESSAGES_TABLE} SET done_local = 1
                         WHERE (archived = 1 OR is_spam = 1 OR soft_deleted = 1)
                           AND COALESCE(done_local, 0) = 0`,
                    )
                    .run();
                if (backfill.changes > 0) {
                    console.log(`Backfilled done_local for ${backfill.changes} handled messages`);
                }
                setSyncInfo('done_local_handled_backfill_v1', '1');
            }
            if (!getSyncInfo('email_spam_status_backfill_v1')) {
                db.prepare(
                    `UPDATE ${EMAIL_MESSAGES_TABLE}
                     SET spam_status = CASE WHEN COALESCE(is_spam, 0) = 1 THEN 'spam' ELSE 'clean' END
                     WHERE spam_status IS NULL
                        OR spam_status = ''
                        OR (COALESCE(is_spam, 0) = 1 AND COALESCE(spam_status, 'clean') <> 'spam')`,
                ).run();
                setSyncInfo('email_spam_status_backfill_v1', '1');
            }
            if (!getSyncInfo('email_assigned_to_integrity_v1')) {
                ensureAssignedToReferentialIntegrity(conn);
                setSyncInfo('email_assigned_to_integrity_v1', '1');
            }
        }

        const wfTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_WORKFLOWS_TABLE);
        if (wfTable) {
            const wc = db.prepare(`PRAGMA table_info(${EMAIL_WORKFLOWS_TABLE})`).all() as { name: string }[];
            const wn = new Set(wc.map((c) => c.name));
            if (!wn.has('graph_json')) {
                console.log('Adding graph_json to email_workflows...');
                db.exec(`ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN graph_json TEXT`);
            }
            if (!wn.has('cron_expr')) {
                console.log('Adding cron_expr to email_workflows...');
                db.exec(`ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN cron_expr TEXT`);
            }
            if (!wn.has('schedule_account_id')) {
                console.log('Adding schedule_account_id to email_workflows...');
                db.exec(`ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN schedule_account_id INTEGER REFERENCES ${EMAIL_ACCOUNTS_TABLE}(id) ON DELETE SET NULL`);
            }
            if (!wn.has('execution_mode')) {
                console.log('Adding execution_mode to email_workflows...');
                db.exec(`ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'graph'`);
            }
            if (!wn.has('engine_version')) {
                console.log('Adding engine_version to email_workflows...');
                db.exec(`ALTER TABLE ${EMAIL_WORKFLOWS_TABLE} ADD COLUMN engine_version INTEGER NOT NULL DEFAULT 1`);
            }
        }

        const teamTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_TEAM_MEMBERS_TABLE);
        if (teamTable) {
            const tc = db.prepare(`PRAGMA table_info(${EMAIL_TEAM_MEMBERS_TABLE})`).all() as { name: string }[];
            if (!tc.some((c) => c.name === 'signature_html')) {
                console.log('Adding signature_html to email_team_members...');
                db.exec(`ALTER TABLE ${EMAIL_TEAM_MEMBERS_TABLE} ADD COLUMN signature_html TEXT`);
            }
        }

        const ensureMigrationTable = (tableName: string, createTableSql: string, tableIndexes: string[]) => {
            const exists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
            if (!exists) {
                console.log(`Table ${tableName} not found, creating...`);
                conn.exec(createTableSql);
                for (const indexSql of tableIndexes) {
                    if (indexSql.includes(tableName)) {
                        conn.exec(indexSql);
                    }
                }
            }
        };
        ensureMigrationTable(EMAIL_ACCOUNT_SIGNATURES_TABLE, createEmailAccountSignaturesTable, []);
        ensureMigrationTable(EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE, createEmailAccountMailSettingsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_account_mail_settings_prefix ON ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}(ticket_prefix);`,
        ]);
        ensureMigrationTable(EMAIL_WORKFLOW_RUN_STEPS_TABLE, createEmailWorkflowRunStepsTable, [
            `CREATE INDEX IF NOT EXISTS idx_wf_run_steps_run ON ${EMAIL_WORKFLOW_RUN_STEPS_TABLE}(run_id);`,
        ]);
        ensureMigrationTable(WORKFLOW_KNOWLEDGE_BASES_TABLE, createWorkflowKnowledgeBasesTable, []);
        ensureMigrationTable(WORKFLOW_KNOWLEDGE_CHUNKS_TABLE, createWorkflowKnowledgeChunksTable, [
            `CREATE INDEX IF NOT EXISTS idx_wf_kb_chunks_kb ON ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE}(knowledge_base_id);`,
        ]);
        ensureMigrationTable(WORKFLOW_DELAYED_JOBS_TABLE, createWorkflowDelayedJobsTable, [
            `CREATE INDEX IF NOT EXISTS idx_wf_delayed_execute ON ${WORKFLOW_DELAYED_JOBS_TABLE}(status, execute_at);`,
        ]);
        ensureMigrationTable(EMAIL_WORKFLOW_VERSIONS_TABLE, createEmailWorkflowVersionsTable, [
            `CREATE INDEX IF NOT EXISTS idx_wf_versions_wf ON ${EMAIL_WORKFLOW_VERSIONS_TABLE}(workflow_id);`,
        ]);
        ensureMigrationTable(EMAIL_SPAM_LIST_ENTRIES_TABLE, createEmailSpamListEntriesTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_spam_list_lookup ON ${EMAIL_SPAM_LIST_ENTRIES_TABLE}(account_id, list_type, pattern_type, pattern);`,
        ]);
        ensureMigrationTable(EMAIL_SPAM_LEARNING_EVENTS_TABLE, createEmailSpamLearningEventsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_spam_learning_msg ON ${EMAIL_SPAM_LEARNING_EVENTS_TABLE}(message_id);`,
            `CREATE INDEX IF NOT EXISTS idx_email_spam_learning_account ON ${EMAIL_SPAM_LEARNING_EVENTS_TABLE}(account_id, created_at);`,
        ]);
        ensureMigrationTable(EMAIL_SPAM_FEATURE_STATS_TABLE, createEmailSpamFeatureStatsTable, []);
        ensureMigrationTable(EMAIL_SPAM_DECISIONS_TABLE, createEmailSpamDecisionsTable, [
            `CREATE INDEX IF NOT EXISTS idx_email_spam_decisions_msg ON ${EMAIL_SPAM_DECISIONS_TABLE}(message_id, created_at);`,
        ]);

        const kbChunkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(WORKFLOW_KNOWLEDGE_CHUNKS_TABLE);
        if (kbChunkTable) {
            const kc = db.prepare(`PRAGMA table_info(${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE})`).all() as { name: string }[];
            const kn = new Set(kc.map((c) => c.name));
            if (!kn.has('embedding_json')) {
                console.log('Adding embedding_json to workflow_knowledge_chunks...');
                db.exec(`ALTER TABLE ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} ADD COLUMN embedding_json TEXT`);
            }
        }

        const attTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_MESSAGE_ATTACHMENTS_TABLE);
        if (!attTable) {
            console.log('Creating email_message_attachments table...');
            db.exec(createEmailMessageAttachmentsTable);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_email_attach_message ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}(message_id);`);
        } else {
            const attCols = db.prepare(`PRAGMA table_info(${EMAIL_MESSAGE_ATTACHMENTS_TABLE})`).all() as { name: string }[];
            const acn = new Set(attCols.map((c) => c.name));
            if (!acn.has('content_sha256')) {
                console.log('Adding content_sha256 to email_message_attachments...');
                db.exec(`ALTER TABLE ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} ADD COLUMN content_sha256 TEXT`);
            }
            db.exec(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_email_att_msg_sha ON ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}(message_id, content_sha256) WHERE content_sha256 IS NOT NULL AND content_sha256 != ''`,
            );
        }

        db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_email_msg_pop3_uidl ON ${EMAIL_MESSAGES_TABLE}(account_id, folder_id, pop3_uidl) WHERE pop3_uidl IS NOT NULL AND pop3_uidl != ''`,
        );
        db.exec(
            `CREATE INDEX IF NOT EXISTS idx_email_messages_spam_status ON ${EMAIL_MESSAGES_TABLE}(account_id, spam_status)`,
        );

        const pop3UidlCol = (db.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_TABLE})`).all() as { name: string }[]).some(
            (c) => c.name === 'pop3_uidl',
        );
        if (pop3UidlCol) {
            db.exec(`
              UPDATE ${EMAIL_MESSAGES_TABLE} SET pop3_uidl = 'legacy-pop3-' || id
              WHERE pop3_uidl IS NULL AND uid >= 0
                AND folder_id IN (SELECT id FROM ${EMAIL_FOLDERS_TABLE} WHERE path = 'INBOX')
                AND account_id IN (SELECT id FROM ${EMAIL_ACCOUNTS_TABLE} WHERE COALESCE(protocol,'imap') = 'pop3')
            `);
        }

        const fwdDedup = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE);
        if (!fwdDedup) {
            console.log('Creating email_workflow_forward_dedup table...');
            db.exec(createEmailWorkflowForwardDedupTable);
        }

        runMailRoadmapMigrations(conn);

        setupEmailFtsIndex();
        migrateEmailFtsSearchV2();
        migrateEmailFtsSearchV3();
        migrateAttachmentTextSearch();

        // Migration: Add snoozed_until column to tasks table if it doesn't exist
        const taskColsForSnooze = db.prepare(`PRAGMA table_info(${TASKS_TABLE})`).all();
        const hasSnoozedUntil = taskColsForSnooze.some((col: any) => col.name === 'snoozed_until');

        if (!hasSnoozedUntil) {
            console.log('Adding snoozed_until column to tasks table...');
            db.exec(`ALTER TABLE ${TASKS_TABLE} ADD COLUMN snoozed_until TEXT`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_snoozed_until ON ${TASKS_TABLE}(snoozed_until);`);
            console.log('Migration completed: Added snoozed_until column to tasks table');
        }

        // Migration: Normalize priority values to English (High/Medium/Low)
        db.prepare(`UPDATE ${TASKS_TABLE} SET priority = 'High'   WHERE priority = 'Hoch'`).run();
        db.prepare(`UPDATE ${TASKS_TABLE} SET priority = 'Medium' WHERE priority = 'Mittel'`).run();
        db.prepare(`UPDATE ${TASKS_TABLE} SET priority = 'Low'    WHERE priority = 'Niedrig'`).run();

        const aiPromptsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(EMAIL_AI_PROMPTS_TABLE);
        if (aiPromptsTable) {
            const promptCols = db.prepare(`PRAGMA table_info(${EMAIL_AI_PROMPTS_TABLE})`).all() as { name: string }[];
            const promptColNames = new Set(promptCols.map((c) => c.name));
            if (!promptColNames.has('profile_id')) {
                console.log('Adding profile_id to email_ai_prompts...');
                db.exec(
                    `ALTER TABLE ${EMAIL_AI_PROMPTS_TABLE} ADD COLUMN profile_id INTEGER REFERENCES ${EMAIL_AI_PROFILES_TABLE}(id) ON DELETE SET NULL`,
                );
            }
        }

        // Add more migrations here as needed

    } catch (error) {
        console.error('Error running migrations:', error);
    }
}


export function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
}

// --- Custom Fields Functions ---

// Get all custom field definitions
export function getAllCustomFields() {
    const stmt = getDb().prepare(`
        SELECT * FROM ${CUSTOMER_CUSTOM_FIELDS_TABLE}
        ORDER BY display_order ASC, name ASC
    `);
    return stmt.all();
}

// Get active custom field definitions
export function getActiveCustomFields() {
    console.log(`🔍 [SQLite] getActiveCustomFields() called`);
    const stmt = getDb().prepare(`
        SELECT * FROM ${CUSTOMER_CUSTOM_FIELDS_TABLE}
        WHERE active = 1
        ORDER BY display_order ASC, name ASC
    `);
    const result = stmt.all();
    console.log(`🔍 [SQLite] Found ${result.length} active custom fields`);
    return result;
}

// Get a single custom field by ID
export function getCustomFieldById(id: number) {
    const stmt = getDb().prepare(`
        SELECT * FROM ${CUSTOMER_CUSTOM_FIELDS_TABLE}
        WHERE id = ?
    `);
    return stmt.get(id);
}

// Create a new custom field
export function createCustomField(fieldData: any) {
    const now = new Date().toISOString();
    const stmt = getDb().prepare(`
        INSERT INTO ${CUSTOMER_CUSTOM_FIELDS_TABLE} (
            name, label, type, required, options, default_value,
            placeholder, description, display_order, active,
            created_at, updated_at
        ) VALUES (
            @name, @label, @type, @required, @options, @default_value,
            @placeholder, @description, @display_order, @active,
            @now, @now
        )
    `);

    // Convert boolean to integer for SQLite
    const required = fieldData.required ? 1 : 0;
    const active = fieldData.active !== undefined ? (fieldData.active ? 1 : 0) : 1;

    // Convert options to JSON string if it's an object/array
    const options = fieldData.options ?
        (typeof fieldData.options === 'string' ? fieldData.options : JSON.stringify(fieldData.options)) :
        null;

    const result = stmt.run({
        ...fieldData,
        required,
        active,
        options,
        now
    });

    if (result.lastInsertRowid) {
        return getCustomFieldById(Number(result.lastInsertRowid));
    }
    return null;
}

// Update an existing custom field
export function updateCustomField(id: number, fieldData: any) {
    const now = new Date().toISOString();
    const existingField = getCustomFieldById(id);

    if (!existingField) {
        throw new Error(`Custom field with ID ${id} not found`);
    }    // Build update assignments dynamically based on provided data
    const updateAssignments: string[] = [];
    const params: any = { id, now };

    // Handle each field that might be updated
    if (fieldData.name !== undefined) {
        updateAssignments.push('name = @name');
        params.name = fieldData.name;
    }

    if (fieldData.label !== undefined) {
        updateAssignments.push('label = @label');
        params.label = fieldData.label;
    }

    if (fieldData.type !== undefined) {
        updateAssignments.push('type = @type');
        params.type = fieldData.type;
    }

    if (fieldData.required !== undefined) {
        updateAssignments.push('required = @required');
        params.required = fieldData.required ? 1 : 0;
    }

    if (fieldData.options !== undefined) {
        updateAssignments.push('options = @options');
        params.options = typeof fieldData.options === 'string' ?
            fieldData.options : JSON.stringify(fieldData.options);
    }

    if (fieldData.default_value !== undefined) {
        updateAssignments.push('default_value = @default_value');
        params.default_value = fieldData.default_value;
    }

    if (fieldData.placeholder !== undefined) {
        updateAssignments.push('placeholder = @placeholder');
        params.placeholder = fieldData.placeholder;
    }

    if (fieldData.description !== undefined) {
        updateAssignments.push('description = @description');
        params.description = fieldData.description;
    }

    if (fieldData.display_order !== undefined) {
        updateAssignments.push('display_order = @display_order');
        params.display_order = fieldData.display_order;
    }

    if (fieldData.active !== undefined) {
        updateAssignments.push('active = @active');
        params.active = fieldData.active ? 1 : 0;
    }

    // Always update the updated_at timestamp
    updateAssignments.push('updated_at = @now');

    if (updateAssignments.length === 0) {
        return existingField; // Nothing to update
    }

    const stmt = getDb().prepare(`
        UPDATE ${CUSTOMER_CUSTOM_FIELDS_TABLE}
        SET ${updateAssignments.join(', ')}
        WHERE id = @id
    `);

    const result = stmt.run(params);

    if (result.changes > 0) {
        return getCustomFieldById(id);
    }
    return existingField;
}

// Delete a custom field
export function deleteCustomField(id: number) {
    // First delete all values associated with this field
    const deleteValuesStmt = getDb().prepare(`
        DELETE FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}
        WHERE field_id = ?
    `);
    deleteValuesStmt.run(id);

    // Then delete the field itself
    const deleteFieldStmt = getDb().prepare(`
        DELETE FROM ${CUSTOMER_CUSTOM_FIELDS_TABLE}
        WHERE id = ?
    `);
    const result = deleteFieldStmt.run(id);

    return result.changes > 0;
}

// Get custom field values for a specific customer
export function getCustomFieldValuesForCustomer(customerId: number) {
    const stmt = getDb().prepare(`
        SELECT cfv.id, cfv.customer_id, cfv.field_id, cfv.value,
               cf.name, cf.label, cf.type, cf.required, cf.options,
               cf.default_value, cf.placeholder, cf.description
        FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE} cfv
        JOIN ${CUSTOMER_CUSTOM_FIELDS_TABLE} cf ON cfv.field_id = cf.id
        WHERE cfv.customer_id = ? AND cf.active = 1
        ORDER BY cf.display_order ASC, cf.name ASC
    `);
    return stmt.all(customerId);
}

// Batch load custom field values for multiple customers (optimized)
export function getCustomFieldValuesForAllCustomers(): Map<number, CustomFieldValueRecord[]> {
    console.log(`🔍 [SQLite] getCustomFieldValuesForAllCustomers() called - This is the EXPENSIVE operation!`);
    const startTime = Date.now();
    
    const stmt = getDb().prepare(`
        SELECT cfv.id, cfv.customer_id, cfv.field_id, cfv.value,
               cf.name, cf.label, cf.type, cf.required, cf.options,
               cf.default_value, cf.placeholder, cf.description
        FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE} cfv
        JOIN ${CUSTOMER_CUSTOM_FIELDS_TABLE} cf ON cfv.field_id = cf.id
        WHERE cf.active = 1
        ORDER BY cfv.customer_id, cf.display_order ASC, cf.name ASC
    `);
    
    const allValues = stmt.all() as CustomFieldValueRecord[];
    console.log(`🔍 [SQLite] Loaded ${allValues.length} custom field values in ${Date.now() - startTime}ms`);
    
    const valuesByCustomer = new Map<number, CustomFieldValueRecord[]>();
    
    for (const value of allValues) {
        if (!valuesByCustomer.has(value.customer_id)) {
            valuesByCustomer.set(value.customer_id, []);
        }
        valuesByCustomer.get(value.customer_id)!.push(value);
    }
    
    console.log(`🔍 [SQLite] Processed custom fields for ${valuesByCustomer.size} customers`);
    return valuesByCustomer;
}

export function getCustomFieldValuesForCustomers(customerIds: number[]): Map<number, CustomFieldValueRecord[]> {
    const uniqueIds = Array.from(new Set(
        customerIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
    ));

    if (uniqueIds.length === 0) {
        return new Map();
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const stmt = getDb().prepare(`
        SELECT cfv.id, cfv.customer_id, cfv.field_id, cfv.value,
               cf.name, cf.label, cf.type, cf.required, cf.options,
               cf.default_value, cf.placeholder, cf.description
        FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE} cfv
        JOIN ${CUSTOMER_CUSTOM_FIELDS_TABLE} cf ON cfv.field_id = cf.id
        WHERE cf.active = 1
          AND cfv.customer_id IN (${placeholders})
        ORDER BY cfv.customer_id, cf.display_order ASC, cf.name ASC
    `);

    const values = stmt.all(...uniqueIds) as CustomFieldValueRecord[];
    const valuesByCustomer = new Map<number, CustomFieldValueRecord[]>();

    for (const value of values) {
        if (!valuesByCustomer.has(value.customer_id)) {
            valuesByCustomer.set(value.customer_id, []);
        }
        valuesByCustomer.get(value.customer_id)!.push(value);
    }

    return valuesByCustomer;
}

// Set a custom field value for a customer
export function setCustomFieldValue(customerId: number, fieldId: number, value: any) {
    const now = new Date().toISOString();

    // Check if the field exists
    const field = getCustomFieldById(fieldId);
    if (!field) {
        throw new Error(`Custom field with ID ${fieldId} not found`);
    }

    // Check if the customer exists
    const customer = getCustomerById(customerId);
    if (!customer) {
        throw new Error(`Customer with ID ${customerId} not found`);
    }

    // Convert value to string for storage
    const stringValue = value !== null && value !== undefined ?
        (typeof value === 'object' ? JSON.stringify(value) : String(value)) :
        null;

    // Use upsert pattern (INSERT OR REPLACE)
    const stmt = getDb().prepare(`
        INSERT INTO ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE} (
            customer_id, field_id, value, created_at, updated_at
        ) VALUES (
            @customer_id, @field_id, @value, @now, @now
        )
        ON CONFLICT(customer_id, field_id) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
    `);

    const result = stmt.run({
        customer_id: customerId,
        field_id: fieldId,
        value: stringValue,
        now
    });

    return result.changes > 0;
}

// Delete a custom field value
export function deleteCustomFieldValue(customerId: number, fieldId: number) {
    const stmt = getDb().prepare(`
        DELETE FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}
        WHERE customer_id = ? AND field_id = ?
    `);
    const result = stmt.run(customerId, fieldId);

    return result.changes > 0;
}

// Delete all custom field values for a customer
export function deleteAllCustomFieldValuesForCustomer(customerId: number) {
    const stmt = getDb().prepare(`
        DELETE FROM ${CUSTOMER_CUSTOM_FIELD_VALUES_TABLE}
        WHERE customer_id = ?
    `);
    const result = stmt.run(customerId);

    return result.changes > 0;
}

// --- Sync Info ---
export function getSyncInfo(key: string): string | null {
    const stmt = getDb().prepare(`SELECT value FROM ${SYNC_INFO_TABLE} WHERE key = ?`);
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value ?? null;
}

export function setSyncInfo(key: string, value: string): void {
    const stmt = getDb().prepare(`
        INSERT INTO ${SYNC_INFO_TABLE} (key, value, lastUpdated)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            lastUpdated = excluded.lastUpdated
    `);
    stmt.run(key, value);
}

export function deleteSyncInfo(key: string): void {
    getDb().prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`).run(key);
}

/** Atomically claim a sync_info key (returns false if key already exists). */
export function tryClaimSyncInfo(key: string, value: string): boolean {
    const r = getDb()
        .prepare(
            `INSERT OR IGNORE INTO ${SYNC_INFO_TABLE} (key, value, lastUpdated) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        )
        .run(key, value);
    return r.changes === 1;
}

// Define interfaces for custom field types
interface CustomFieldDefinition {
    id: number;
    name: string;
    label: string;
    type: string;
    required: number;
    options?: string;
    default_value?: string;
    placeholder?: string;
    description?: string;
    display_order: number;
    active: number;
    created_at: string;
    updated_at: string;
}

interface CustomFieldValueRecord {
    id: number;
    customer_id: number;
    field_id: number;
    value: string | null;
    created_at: string;
    updated_at: string;
    name?: string;
    label?: string;
    type?: string;
    required?: number;
    options?: string;
    default_value?: string;
    placeholder?: string;
    description?: string;
}

// --- Customer Operations ---

interface CustomerPageOptions {
    includeCustomFields?: boolean;
    limit?: number;
    offset?: number;
    query?: string;
    status?: string | null;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
}

interface CustomerPageResult {
    items: any[];
    total: number;
}

const CUSTOMER_LIST_MAX_LIMIT = 500;

function getCustomerOrderSql(sortBy: string | undefined, sortDirection: 'asc' | 'desc' | undefined, hasQuery: boolean): string {
    const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
    switch (sortBy) {
        case 'fullName':
            return `ORDER BY name ${direction}, firstName ${direction}, id ASC`;
        case 'customerNumber':
            return `ORDER BY customerNumber ${direction}, id ASC`;
        case 'company':
            return `ORDER BY company ${direction}, id ASC`;
        case 'email':
            return `ORDER BY email ${direction}, id ASC`;
        case 'contactPhone':
            return `ORDER BY phone ${direction}, mobile ${direction}, id ASC`;
        case 'status':
            return `ORDER BY status ${direction}, id ASC`;
        case 'jtlCustomerNumber':
            return `ORDER BY jtl_kKunde ${direction}, id ASC`;
        default:
            return hasQuery
                ? `ORDER BY
                    CASE
                        WHEN customerNumber LIKE @prefixTerm THEN 1
                        WHEN name LIKE @prefixTerm THEN 2
                        WHEN firstName LIKE @prefixTerm THEN 3
                        WHEN company LIKE @prefixTerm THEN 4
                        WHEN email LIKE @prefixTerm THEN 5
                        ELSE 6
                    END,
                    name ASC`
                : 'ORDER BY name ASC';
    }
}

function normalizeListLimit(limit: unknown, fallback: number, max: number = CUSTOMER_LIST_MAX_LIMIT): number {
    const numericLimit = Number(limit);
    if (!Number.isFinite(numericLimit)) {
        return fallback;
    }
    return Math.min(max, Math.max(1, Math.floor(numericLimit)));
}

function normalizeListOffset(offset: unknown): number {
    const numericOffset = Number(offset);
    if (!Number.isFinite(numericOffset)) {
        return 0;
    }
    return Math.max(0, Math.floor(numericOffset));
}

function buildCustomFieldsObject(fieldValues: CustomFieldValueRecord[] = []): Record<string, any> {
    const customFields: Record<string, any> = {};

    fieldValues.forEach((field: CustomFieldValueRecord) => {
        let parsedValue: any = field.value;
        if (field.type === 'number' && parsedValue !== null) {
            parsedValue = parseFloat(parsedValue);
        } else if (field.type === 'boolean' && parsedValue !== null) {
            parsedValue = parsedValue === 'true' || parsedValue === '1';
        }

        if (field.name) {
            customFields[field.name] = parsedValue;
        }
    });

    return customFields;
}

function attachCustomFieldsForPage(customers: any[]): any[] {
    if (customers.length === 0) {
        return customers;
    }

    const customFieldValuesByCustomer = getCustomFieldValuesForCustomers(
        customers.map((customer: any) => Number(customer.id))
    );

    return customers.map((customer: any) => ({
        ...customer,
        customFields: buildCustomFieldsObject(customFieldValuesByCustomer.get(Number(customer.id)) || []),
    }));
}

// Lightweight function for dropdown population - no custom fields
export function getCustomersForDropdown(): any[] {
    const stmt = getDb().prepare(`
        SELECT id, name, firstName, company, customerNumber 
        FROM ${CUSTOMERS_TABLE} 
        ORDER BY name
        LIMIT 100
    `);
    return stmt.all().map((customer: any) => ({
        id: customer.id,
        name: customer.name || customer.firstName || customer.company || 'Unknown',
        customerNumber: customer.customerNumber
    }));
}

// Search customers with limit for autocomplete/combobox
export function searchCustomers(query: string = '', limit: number = 20): any[] {
    const startTime = Date.now();
    const safeLimit = normalizeListLimit(limit, 20, 50);
    const trimmedQuery = query.trim();

    let sql = `
        SELECT id, name, firstName, company, customerNumber, email
        FROM ${CUSTOMERS_TABLE}
    `;

    const params: any[] = [];

    if (trimmedQuery !== '') {
        sql += ` WHERE (
            name LIKE ? OR
            firstName LIKE ? OR
            company LIKE ? OR
            customerNumber LIKE ? OR
            email LIKE ? OR
            CAST(jtl_kKunde AS TEXT) LIKE ?
        )`;
        const searchTerm = `%${trimmedQuery}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (trimmedQuery === '') {
        sql += ` ORDER BY name ASC LIMIT ?`;
        params.push(safeLimit);
    } else {
        sql += ` ORDER BY
        CASE 
            WHEN name LIKE ? THEN 1
            WHEN firstName LIKE ? THEN 2
            WHEN company LIKE ? THEN 3
            WHEN customerNumber LIKE ? THEN 4
            WHEN email LIKE ? THEN 5
            ELSE 6
        END,
        name ASC
        LIMIT ?`;
        const startTerm = `${trimmedQuery}%`;
        params.push(startTerm, startTerm, startTerm, startTerm, startTerm, safeLimit);
    }

    if (isDevelopment) {
        console.debug(`🔍 [SQLite] Executing customer search SQL with ${params.length} parameters`);
    }
    const stmt = getDb().prepare(sql);
    const results = stmt.all(...params);
    const loadTime = Date.now() - startTime;
    
    if (isDevelopment) {
        console.debug(`🔍 [SQLite] searchCustomers() found ${results.length} customers in ${loadTime}ms`);
    }
    
    return results.map((customer: any) => ({
        id: customer.id,
        name: customer.name || customer.firstName || customer.company || 'Unknown',
        customerNumber: customer.customerNumber,
        email: customer.email
    }));
}

export function getCustomersPage(options: CustomerPageOptions = {}): CustomerPageResult {
    const includeCustomFields = Boolean(options.includeCustomFields);
    const limit = normalizeListLimit(options.limit, 50);
    const offset = normalizeListOffset(options.offset);
    const query = (options.query ?? '').trim();
    const status = options.status && options.status !== 'all' ? options.status : null;
    const params: Record<string, unknown> = {
        limit,
        offset,
    };
    const whereParts: string[] = [];

    if (status) {
        whereParts.push(status === 'Active' ? '(status = @status OR status IS NULL)' : 'status = @status');
        params.status = status;
    }

    if (query) {
        whereParts.push(`(
            name LIKE @searchTerm OR
            firstName LIKE @searchTerm OR
            company LIKE @searchTerm OR
            customerNumber LIKE @searchTerm OR
            email LIKE @searchTerm OR
            phone LIKE @searchTerm OR
            mobile LIKE @searchTerm OR
            CAST(jtl_kKunde AS TEXT) LIKE @searchTerm
        )`);
        params.searchTerm = `%${query}%`;
        params.prefixTerm = `${query}%`;
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const orderSql = getCustomerOrderSql(options.sortBy, options.sortDirection, Boolean(query));
    const columns = `
        id, jtl_kKunde, customerNumber, name, firstName, company, email,
        phone, mobile, street, COALESCE(zipCode, '') AS zip, city, country, status, notes, affiliateLink,
        jtl_dateCreated
    `;

    const totalRow = getDb().prepare(`
        SELECT COUNT(*) as total
        FROM ${CUSTOMERS_TABLE}
        ${whereSql}
    `).get(params) as { total?: number } | undefined;

    const rows = getDb().prepare(`
        SELECT ${columns}
        FROM ${CUSTOMERS_TABLE}
        ${whereSql}
        ${orderSql}
        LIMIT @limit OFFSET @offset
    `).all(params);

    return {
        items: includeCustomFields ? attachCustomFieldsForPage(rows) : rows,
        total: Number(totalRow?.total ?? 0),
    };
}

export function getAllCustomers(includeCustomFields: boolean = false): any[] {
    if (isDevelopment) {
        console.debug(`🔍 [SQLite] getAllCustomers() called with includeCustomFields=${includeCustomFields}`);
    }
    
    const startTime = Date.now();
    const stmt = getDb().prepare(`SELECT * FROM ${CUSTOMERS_TABLE} ORDER BY name`);
    const customers = stmt.all();
    if (isDevelopment) {
        console.debug(`🔍 [SQLite] Loaded ${customers.length} customers in ${Date.now() - startTime}ms`);
    }

    // Skip custom field loading if not needed
    if (!includeCustomFields) {
        if (isDevelopment) {
            console.debug(`🔍 [SQLite] Skipping custom fields, returning ${customers.length} customers`);
        }
        return customers;
    }

    if (isDevelopment) {
        console.debug(`🔍 [SQLite] Loading custom fields for ${customers.length} customers...`);
    }
    // Get all active custom fields
    const activeFields = getActiveCustomFields() as CustomFieldDefinition[];

    if (activeFields.length === 0) {
        return customers; // No custom fields to process
    }

    // Batch load all custom field values in a single query
    const customFieldValuesByCustomer = getCustomFieldValuesForAllCustomers();

    // For each customer, attach custom field values from the batch-loaded data
    return customers.map((customer: any) => {
        if (!customer || typeof customer.id === 'undefined') {
            return customer; // Skip if customer is invalid
        }

        const customFieldValues = customFieldValuesByCustomer.get(customer.id) || [];

        // Create a customFields object with field name as key and value as value
        const customFields: Record<string, any> = {};
        customFieldValues.forEach((field: CustomFieldValueRecord) => {
            // Parse value based on field type
            let parsedValue: any = field.value;
            if (field.type === 'number' && parsedValue !== null) {
                parsedValue = parseFloat(parsedValue);
            } else if (field.type === 'boolean' && parsedValue !== null) {
                parsedValue = parsedValue === 'true' || parsedValue === '1';
            } else if (field.type === 'date' && parsedValue !== null) {
                // Keep as string for date fields
            } else if (field.type === 'select' && parsedValue !== null) {
                // Keep as string for select fields
            }

            if (field.name) {
                customFields[field.name] = parsedValue;
            }
        });

        return {
            ...customer,
            customFields
        };
    });
}

// Add a function to get a single customer by ID
export function getCustomerById(id: number | string): any {
    const stmt = getDb().prepare(`
        SELECT id, jtl_kKunde, customerNumber, name, firstName, company, email, phone, mobile,
               street, city, country, status, notes, affiliateLink,
               jtl_dateCreated, jtl_blocked, dateAdded, lastModifiedLocally, lastSynced,
               COALESCE(zipCode, '') AS zip
        FROM ${CUSTOMERS_TABLE}
        WHERE id = ?
    `);
    const customer = stmt.get(id) as { id: number; [key: string]: any };

    if (!customer) {
        return null;
    }

    // Get custom field values for this customer
    const customFieldValues = getCustomFieldValuesForCustomer(customer.id) as CustomFieldValueRecord[];

    // Create a customFields object with field name as key and value as value
    const customFields: Record<string, any> = {};
    customFieldValues.forEach((field: CustomFieldValueRecord) => {
        // Parse value based on field type
        let parsedValue: any = field.value;
        if (field.type === 'number' && parsedValue !== null) {
            parsedValue = parseFloat(parsedValue);
        } else if (field.type === 'boolean' && parsedValue !== null) {
            parsedValue = parsedValue === 'true' || parsedValue === '1';
        } else if (field.type === 'date' && parsedValue !== null) {
            // Keep as string for date fields
        } else if (field.type === 'select' && parsedValue !== null) {
            // Keep as string for select fields
        }

        if (field.name) {
            customFields[field.name] = parsedValue;
        }
    });

    const customerWithCustomFields = {
        ...customer,
        customFields
    };

    return customerWithCustomFields;
}

// Example: Upsert using raw SQL (adapt based on actual JTL fields)
export function upsertCustomer(customerData: any): void {
    const stmt = getDb().prepare(`
        INSERT INTO ${CUSTOMERS_TABLE} (
            jtl_kKunde, name, firstName, company, email, phone, mobile,
            street, zipCode, city, country, jtl_dateCreated, jtl_blocked,
            lastSynced
        ) VALUES (
            @jtl_kKunde, @name, @firstName, @company, @email, @phone, @mobile,
            @street, @zip, @city, @country, @jtl_dateCreated, @jtl_blocked,
            CURRENT_TIMESTAMP
        ) ON CONFLICT(jtl_kKunde) DO UPDATE SET
            name = excluded.name,
            firstName = excluded.firstName,
            company = excluded.company,
            email = excluded.email,
            phone = excluded.phone,
            mobile = excluded.mobile,
            street = excluded.street,
            zipCode = excluded.zip, -- Use excluded.zip to update zipCode column
            city = excluded.city,
            country = excluded.country,
            jtl_dateCreated = excluded.jtl_dateCreated,
            jtl_blocked = excluded.jtl_blocked,
            lastSynced = CURRENT_TIMESTAMP,
            lastModifiedLocally = CASE WHEN
                name != excluded.name OR
                firstName != excluded.firstName OR
                company != excluded.company OR
                email != excluded.email OR
                phone != excluded.phone OR
                mobile != excluded.mobile OR
                street != excluded.street OR
                zipCode != excluded.zip OR -- Compare zipCode column with incoming excluded.zip
                city != excluded.city OR
                country != excluded.country OR
                jtl_dateCreated != excluded.jtl_dateCreated OR
                jtl_blocked != excluded.jtl_blocked
            THEN CURRENT_TIMESTAMP ELSE lastModifiedLocally END;
    `);
    stmt.run(customerData);
}

// Add a function to create a new customer
export function createCustomer(customerData: any): any {
    const now = new Date().toISOString();

    // Extract custom fields from customer data
    const { customFields, ...standardCustomerData } = customerData;

    // Conditionally include jtl_kKunde in the insert statement
    const columns = [
        'name', 'firstName', 'company', 'email', 'phone', 'mobile',
        'street', 'zipCode', 'city', 'country', 'status', 'notes',
        'affiliateLink', 'lastModifiedLocally'
    ];
    const valuesPlaceholders = [
        '@name', '@firstName', '@company', '@email', '@phone', '@mobile',
        '@street', '@zip', '@city', '@country', '@status', '@notes',
        '@affiliateLink', '@now'
    ];

    const dataToInsert: any = {
        ...standardCustomerData,
        now: now,
        status: standardCustomerData.status || 'Active'
    };

    if (standardCustomerData.jtl_kKunde !== undefined && standardCustomerData.jtl_kKunde !== null) {
        columns.unshift('jtl_kKunde');
        valuesPlaceholders.unshift('@jtl_kKunde');
        dataToInsert.jtl_kKunde = standardCustomerData.jtl_kKunde;
    }

    // Use a transaction to ensure all operations succeed or fail together
    const db = getDb();
    db.prepare('BEGIN TRANSACTION').run();

    try {
        // Insert the customer
        const stmt = db.prepare(`
            INSERT INTO ${CUSTOMERS_TABLE} (
                ${columns.join(', ')}
            ) VALUES (
                ${valuesPlaceholders.join(', ')}
            )
        `);

        const result = stmt.run(dataToInsert);
        const newCustomerId = Number(result.lastInsertRowid);

        // If we have custom fields, save them
        if (customFields && typeof customFields === 'object') {
            const activeFields = getActiveCustomFields() as CustomFieldDefinition[];
            const fieldMap = new Map(activeFields.map((field: CustomFieldDefinition) => [field.name, field.id]));

            // For each custom field, save its value
            Object.entries(customFields).forEach(([fieldName, fieldValue]) => {
                const fieldId = fieldMap.get(fieldName);
                if (fieldId !== undefined) {
                    setCustomFieldValue(newCustomerId, fieldId, fieldValue);
                }
            });
        }

        // Commit the transaction
        db.prepare('COMMIT').run();

        void import('./workflow/workflow-trigger-dispatch')
          .then((m) =>
            m.dispatchCustomerCreatedWorkflow({
              customerId: newCustomerId,
              name: String(dataToInsert.name ?? 'Kunde'),
              email: dataToInsert.email ? String(dataToInsert.email) : null,
            }),
          )
          .catch((e) => console.debug('[workflow] customer_created', e));

        void import('./email/email-crm-store')
          .then((m) => m.backfillCustomerLinksForMessages({ limit: 200 }))
          .catch(() => undefined);

        // Return the newly created customer with custom fields
        return getCustomerById(newCustomerId);
    } catch (error) {
        // If anything fails, roll back the transaction
        db.prepare('ROLLBACK').run();
        console.error('Error creating customer:', error);
        throw error;
    }
}

export function updateCustomer(id: number, customerData: any): any {
    const now = new Date().toISOString();

    // Extract custom fields from customer data
    const { customFields, zip, ...otherCustomerData } = customerData;

    const updateFieldKeys = Object.keys(otherCustomerData)
        .filter(key => key !== 'id' && key !== 'jtl_kKunde'); // Don't update primary keys

    const updateAssignments = updateFieldKeys.map(key => `${key} = @${key}`);

    if (zip !== undefined) {
        updateAssignments.push(`zipCode = @zip`);
    }

    // Add lastModifiedLocally timestamp
    updateAssignments.push(`lastModifiedLocally = @now`);

    // Use a transaction to ensure all operations succeed or fail together
    const db = getDb();
    db.prepare('BEGIN TRANSACTION').run();

    try {
        // Update the customer record
        const query = `
            UPDATE ${CUSTOMERS_TABLE}
            SET ${updateAssignments.join(', ')}
            WHERE id = @id
        `;

        const stmt = db.prepare(query);
        const paramsToRun: any = {
            ...otherCustomerData,
            id: id,
            now: now
        };
        if (zip !== undefined) {
            paramsToRun.zip = zip;
        }
        const result = stmt.run(paramsToRun);

        // If we have custom fields, update them
        if (customFields && typeof customFields === 'object') {
            const activeFields = getActiveCustomFields() as CustomFieldDefinition[];
            const fieldMap = new Map(activeFields.map((field: CustomFieldDefinition) => [field.name, field.id]));

            // For each custom field, update its value
            Object.entries(customFields).forEach(([fieldName, fieldValue]) => {
                const fieldId = fieldMap.get(fieldName);
                if (fieldId !== undefined) {
                    setCustomFieldValue(id, fieldId, fieldValue);
                }
            });
        }

        // Commit the transaction
        db.prepare('COMMIT').run();

        if (result.changes > 0) {
            return getCustomerById(id);
        }
        return null;
    } catch (error) {
        // If anything fails, roll back the transaction
        db.prepare('ROLLBACK').run();
        console.error('Error updating customer:', error);
        throw error;
    }
}

export function deleteCustomer(id: number): boolean {
    // Use a transaction to ensure all operations succeed or fail together
    const db = getDb();
    db.prepare('BEGIN TRANSACTION').run();

    try {
        // Delete custom field values first (though the foreign key would handle this)
        deleteAllCustomFieldValuesForCustomer(id);

        // Then delete the customer
        const stmt = db.prepare(`DELETE FROM ${CUSTOMERS_TABLE} WHERE id = ?`);
        const result = stmt.run(id);

        // Commit the transaction
        db.prepare('COMMIT').run();

        return result.changes > 0;
    } catch (error) {
        // If anything fails, roll back the transaction
        db.prepare('ROLLBACK').run();
        console.error('Error deleting customer:', error);
        throw error;
    }
}

// --- Product Operations ---

export function getAllProducts(): Product[] {
    const stmt = getDb().prepare(`SELECT * FROM ${PRODUCTS_TABLE} ORDER BY name`);
    return stmt.all() as Product[];
}

export function getProductById(id: number): Product | null {
    const stmt = getDb().prepare(`SELECT * FROM ${PRODUCTS_TABLE} WHERE id = ?`);
    const result = stmt.get(id);
    return result ? result as Product : null;
}

export function searchProducts(query: string = '', limit: number = 20): Product[] {
    const startTime = Date.now();
    const safeLimit = normalizeListLimit(limit, 20, 500);

    const trimmedQuery = query.trim();
    const lowerQuery = trimmedQuery.toLowerCase();
    const likePattern = `%${lowerQuery}%`;
    const prefixPattern = `${lowerQuery}%`;

    let stmt;
    let results;

    if (!trimmedQuery) {
        // If no query, return recent/active products
        stmt = getDb().prepare(`
            SELECT * FROM ${PRODUCTS_TABLE}
            WHERE isActive = 1
            ORDER BY name
            LIMIT @limit
        `);
        results = stmt.all({ limit: safeLimit });
    } else {
        // Search by name, description, or SKU (cArtNr)
        stmt = getDb().prepare(`
            SELECT * FROM ${PRODUCTS_TABLE}
            WHERE (
                LOWER(name) LIKE @likePattern OR
                LOWER(description) LIKE @likePattern OR
                LOWER(sku) LIKE @likePattern OR
                (sku IS NOT NULL AND LOWER(sku) = @lowerQuery)
            )
            AND isActive = 1
            ORDER BY
                CASE
                    WHEN LOWER(name) LIKE @prefixPattern THEN 1
                    WHEN LOWER(sku) LIKE @prefixPattern THEN 2
                    WHEN LOWER(description) LIKE @prefixPattern THEN 3
                    ELSE 4
                END,
                name
            LIMIT @limit
        `);
        results = stmt.all({ likePattern, lowerQuery, prefixPattern, limit: safeLimit });
    }

    if (isDevelopment) {
        console.debug(`🔍 [SQLite] searchProducts() returned ${results.length} products in ${Date.now() - startTime}ms`);
    }
    return results as Product[];
}

// For creating products manually within the app
export function createProduct(productData: Omit<Product, 'id' | 'dateCreated' | 'lastModified' | 'lastSynced' | 'jtl_kArtikel' | 'jtl_dateCreated'>): Database.RunResult {
    const now = new Date().toISOString();
    const stmt = getDb().prepare(`
        INSERT INTO ${PRODUCTS_TABLE} (
            name, sku, description, price, isActive, dateCreated, lastModified, lastModifiedLocally
        ) VALUES (
            @name, @sku, @description, @price, @isActive, @now, @now, @now
        )
    `);
    // Ensure isActive is passed as 0 or 1
    const isActiveInt = productData.isActive ? 1 : 0;
    return stmt.run({ ...productData, isActive: isActiveInt, now: now });
}

// For updating products manually within the app
export function updateProduct(id: number, productData: Partial<Omit<Product, 'id' | 'dateCreated' | 'lastModified' | 'lastSynced' | 'jtl_kArtikel' | 'jtl_dateCreated'>>): Database.RunResult {
    const now = new Date().toISOString();
    let updateFields = Object.keys(productData)
                           .map(key => `${key} = @${key}`)
                           .join(', ');
    // Add lastModified and lastModifiedLocally updates
    updateFields += `, lastModified = @now, lastModifiedLocally = @now`;

    const stmt = getDb().prepare(`
        UPDATE ${PRODUCTS_TABLE}
        SET ${updateFields}
        WHERE id = @id
    `);

    // Ensure isActive is converted if present
    const dataToRun: any = { ...productData, id: id, now: now };
    if (productData.isActive !== undefined) {
        dataToRun.isActive = productData.isActive ? 1 : 0;
    }

    return stmt.run(dataToRun);
}

export function deleteProduct(id: number): Database.RunResult {
    // Consider checking if the product is linked in deal_products if ON DELETE RESTRICT is used
    const stmtCheck = getDb().prepare(`SELECT 1 FROM ${DEAL_PRODUCTS_TABLE} WHERE product_id = ? LIMIT 1`);
    const isInDeal = stmtCheck.get(id);

    if (isInDeal) {
        // Consider throwing an error or returning a specific status
        console.error(`Attempted to delete product ${id} which is still linked to deals.`);
        throw new Error(`Product is still linked to one or more deals and cannot be deleted.`);
    }

    const stmt = getDb().prepare(`DELETE FROM ${PRODUCTS_TABLE} WHERE id = ?`);
    return stmt.run(id);
}

// Upsert for SYNCING from JTL (adjust mapping based on sync-service)
export function upsertProduct(productData: any): void {
    const now = new Date().toISOString();
    const stmt = getDb().prepare(`
        INSERT INTO ${PRODUCTS_TABLE} (
            jtl_kArtikel, sku, name, description, price, isActive,
            jtl_dateCreated, dateCreated, lastModified, lastSynced
        ) VALUES (
            @jtl_kArtikel, @sku, @name, @description, @price, @isActive,
            @jtl_dateCreated, @now, @now, @now
        ) ON CONFLICT(jtl_kArtikel) DO UPDATE SET
            sku = excluded.sku,
            name = excluded.name,
            description = excluded.description,
            price = excluded.price,
            isActive = excluded.isActive,
            jtl_dateCreated = excluded.jtl_dateCreated,
            lastModified = @now, -- Update lastModified on sync update
            lastSynced = @now   -- Update lastSynced timestamp
            -- lastModifiedLocally is NOT updated here, only by manual edits
        WHERE jtl_kArtikel = @jtl_kArtikel;
    `);
    // Ensure isActive is 0 or 1 if coming as boolean
    const isActiveInt = typeof productData.isActive === 'boolean' ? (productData.isActive ? 1 : 0) : productData.isActive;
    stmt.run({ ...productData, isActive: isActiveInt, now: now });
}

// --- Deal-Product Link Operations ---

export function addProductToDeal(dealId: number, productId: number, quantity: number, price: number): Database.RunResult {
    const now = new Date().toISOString();
    const stmt = getDb().prepare(`
        INSERT INTO ${DEAL_PRODUCTS_TABLE} (
            deal_id, product_id, quantity, price_at_time_of_adding, dateAdded
        ) VALUES (
            @deal_id, @product_id, @quantity, @price_at_time_of_adding, @dateAdded
        ) ON CONFLICT(deal_id, product_id) DO UPDATE SET
            quantity = quantity + @quantity, -- Or just set to @quantity? Decide policy. Currently adds.
            price_at_time_of_adding = @price_at_time_of_adding -- Update price if re-added or on conflict
    `);
    return stmt.run({
        deal_id: dealId,
        product_id: productId,
        quantity: quantity,
        price_at_time_of_adding: price, // Changed priceAtTime to price
        dateAdded: now
    });
}

export function removeProductFromDeal(dealId: number, productId: number): Database.RunResult {
    const stmt = getDb().prepare(`
        DELETE FROM ${DEAL_PRODUCTS_TABLE}
        WHERE deal_id = ? AND product_id = ?
    `);
    return stmt.run(dealId, productId);
}

// Updated function to handle both quantity and price updates
export function updateDealProduct(dealProductId: number, quantity: number, price: number): Database.RunResult {
    if (quantity <= 0) {
        // If quantity is zero or less, remove the product link entirely
        // This requires deal_id and product_id, not just dealProductId.
        // For now, let's assume quantity > 0 from frontend validation, or handle removal separately.
        // To properly remove, we'd need to fetch the deal_id and product_id using dealProductId first,
        // or change the IPC call to send deal_id and product_id for removal.
        // For simplicity in this update, we'll just update if quantity > 0.
        // A more robust solution would be to call a remove function if quantity <= 0.
        // For now, we'll rely on frontend to send quantity > 0 for updates.
        // If quantity is 0, the frontend should call removeProductFromDealById (new function below)
        throw new Error("Quantity must be greater than 0 to update. Use remove to delete.");
    }
    const stmt = getDb().prepare(`
        UPDATE ${DEAL_PRODUCTS_TABLE}
        SET quantity = @quantity, price_at_time_of_adding = @price
        WHERE id = @deal_product_id
    `);
    return stmt.run({
        quantity: quantity,
        price: price,
        deal_product_id: dealProductId
    });
}

// New function to remove by deal_product_id (primary key of deal_products table)
export function removeProductFromDealById(dealProductId: number): Database.RunResult {
    const stmt = getDb().prepare(`
        DELETE FROM ${DEAL_PRODUCTS_TABLE}
        WHERE id = ?
    `);
    return stmt.run(dealProductId);
}


// Old function, can be deprecated or modified if direct deal_id/product_id manipulation is still needed elsewhere
export function updateProductQuantityInDeal(dealId: number, productId: number, newQuantity: number): Database.RunResult {
    if (newQuantity <= 0) {
        return removeProductFromDeal(dealId, productId);
    } else {
        const stmt = getDb().prepare(`
            UPDATE ${DEAL_PRODUCTS_TABLE}
            SET quantity = ?
            WHERE deal_id = ? AND product_id = ?
        `);
        return stmt.run(newQuantity, dealId, productId);
    }
}

// Gets products associated with a specific deal, joining with the products table
export function getProductsForDeal(dealId: number): (DealProduct & Product)[] {
    const stmt = getDb().prepare(`
        SELECT
            dp.id as deal_product_id, -- Alias to avoid clash with product.id
            dp.deal_id,
            dp.product_id,
            dp.quantity,
            dp.price_at_time_of_adding,
            dp.dateAdded,
            p.*  -- Select all columns from products table
        FROM ${DEAL_PRODUCTS_TABLE} dp
        JOIN ${PRODUCTS_TABLE} p ON dp.product_id = p.id
        WHERE dp.deal_id = ?
        ORDER BY p.name
    `);
    return stmt.all(dealId) as (DealProduct & Product)[];
}

/**
 * Calculate the total value of a deal based on its associated products
 * @param dealId The ID of the deal
 * @returns The total value of the deal
 */
export function calculateDealValue(dealId: number): number {
  try {
    const stmt = getDb().prepare(`
      SELECT SUM(dp.quantity * dp.price_at_time_of_adding) as total_value
      FROM ${DEAL_PRODUCTS_TABLE} dp
      WHERE dp.deal_id = ?
    `);
    const result = stmt.get(dealId) as { total_value?: number };
    return result?.total_value || 0;
  } catch (error) {
    console.error(`Error calculating deal value for deal ${dealId}:`, error);
    return 0;
  }
}

/**
 * Update a deal's value based on its calculation method
 * @param dealId The ID of the deal
 * @returns Success status and error message if applicable
 */
export function updateDealValueBasedOnCalculationMethod(dealId: number): { success: boolean; error?: string } {
  try {
    // Get the deal's calculation method
    const dealStmt = getDb().prepare(`
      SELECT value_calculation_method
      FROM ${DEALS_TABLE}
      WHERE id = ?
    `);
    const deal = dealStmt.get(dealId) as { value_calculation_method?: string };

    if (!deal) {
      return { success: false, error: 'Deal not found' };
    }

    // If the calculation method is dynamic, update the value
    if (deal.value_calculation_method === 'dynamic') {
      const totalValue = calculateDealValue(dealId);

      const updateStmt = getDb().prepare(`
        UPDATE ${DEALS_TABLE}
        SET value = ?, last_modified = ?
        WHERE id = ?
      `);

      const now = new Date().toISOString();
      updateStmt.run(totalValue, now, dealId);
    }

    return { success: true };
  } catch (error) {
    console.error(`Error updating deal value for deal ${dealId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Calendar Event Operations ---

// Define a type for the data coming from the frontend/going to the DB
interface CalendarEventData {
    id?: number; // Optional for creation
    title: string;
    description?: string;
    start_date: string; // ISO String
    end_date: string; // ISO String
    all_day: number; // 0 or 1
    color_code?: string;
    event_type?: string;
    recurrence_rule?: string; // Store as JSON string
    task_id?: number | null; // Optional link to a task row
}

export function getAllCalendarEvents(startDate?: string, endDate?: string): any[] { // Return type matches structure from DB
    let query = `SELECT * FROM ${CALENDAR_EVENTS_TABLE}`;
    const params: any[] = [];

    if (startDate || endDate) {
        query += ' WHERE';
        if (startDate) {
            query += ' start_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            if (startDate) query += ' AND';
            query += ' end_date <= ?';
            params.push(endDate);
        }
    }

    query += ' ORDER BY start_date';

    const stmt = getDb().prepare(query);
    const events = params.length > 0 ? stmt.all(...params) : stmt.all();

    // Parse recurrence_rule JSON for any events
    return events.map((event: any) => {
        if (event.recurrence_rule && typeof event.recurrence_rule === 'string') {
            try {
                event.recurrence_rule = JSON.parse(event.recurrence_rule);
            } catch (e) {
                console.warn(`Could not parse recurrence_rule for event ${event.id}:`, e);
            }
        }
        return event;
    });
}

export function createCalendarEvent(eventData: any): Database.RunResult {
    console.log('Creating calendar event with data:', eventData);
    try {
        const now = new Date().toISOString();

        // Prepare a clean object with only the required fields
        const cleanData: Record<string, any> = {
            title: String(eventData.title || ''),
            description: String(eventData.description || ''),
            start_date: String(eventData.start_date || now),
            end_date: String(eventData.end_date || now),
            all_day: eventData.all_day ? 1 : 0,  // Convert boolean to integer for SQLite
            color_code: String(eventData.color_code || '#3174ad'),
            event_type: String(eventData.event_type || ''),
            recurrence_rule: null, // Always include recurrence_rule parameter with default null
            task_id: eventData.task_id ?? null,
            now: now
        };

        // Handle recurrence_rule if it exists and isn't null
        if (eventData.recurrence_rule) {
            cleanData.recurrence_rule = typeof eventData.recurrence_rule === 'string'
                ? eventData.recurrence_rule
                : JSON.stringify(eventData.recurrence_rule);
        }

        console.log('Sanitized data for SQLite:', cleanData);

        const stmt = getDb().prepare(`
            INSERT INTO ${CALENDAR_EVENTS_TABLE} (
                title, description, start_date, end_date, all_day,
                color_code, event_type, recurrence_rule, task_id, created_at, updated_at
            ) VALUES (
                @title, @description, @start_date, @end_date, @all_day,
                @color_code, @event_type, @recurrence_rule, @task_id, @now, @now
            )
        `);

        return stmt.run(cleanData);
    } catch (error) {
        console.error('Error creating calendar event:', error);
        throw error;
    }
}

export function updateCalendarEvent(id: number, eventData: Partial<Omit<CalendarEventData, 'id'>>): Database.RunResult {
    console.log('Updating calendar event with data:', id, eventData);
    try {
        const now = new Date().toISOString();
        const cleanData: Record<string, any> = { ...eventData, id, now };

        // Convert boolean to integer for SQLite
        if (typeof eventData.all_day === 'boolean') {
            cleanData.all_day = eventData.all_day ? 1 : 0;
        }

        // Handle recurrence_rule if it exists
        if (eventData.recurrence_rule !== undefined) {
            if (eventData.recurrence_rule === null) {
                cleanData.recurrence_rule = null;
            } else {
                cleanData.recurrence_rule = typeof eventData.recurrence_rule === 'string'
                    ? eventData.recurrence_rule
                    : JSON.stringify(eventData.recurrence_rule);
            }
        }

        if (eventData.task_id !== undefined) {
            cleanData.task_id = eventData.task_id;
        }

        // Convert all strings and numbers explicitly
        Object.keys(cleanData).forEach(key => {
            if (typeof cleanData[key] === 'string' || typeof cleanData[key] === 'number') {
                cleanData[key] = String(cleanData[key]);
            }
        });

        console.log('Sanitized data for SQLite update:', cleanData);

        const keysToUpdate = Object.keys(eventData);
        let updateFields = keysToUpdate
                               .map(key => `${key} = @${key}`)
                               .join(', ');

        // Ensure updated_at is always updated
        updateFields += `, updated_at = @now`;

        const stmt = getDb().prepare(`
            UPDATE ${CALENDAR_EVENTS_TABLE}
            SET ${updateFields}
            WHERE id = @id
        `);

        return stmt.run(cleanData);
    } catch (error) {
        console.error(`Error updating calendar event ${id}:`, error);
        throw error;
    }
}

export function deleteCalendarEvent(id: number): Database.RunResult {
    const stmt = getDb().prepare(`DELETE FROM ${CALENDAR_EVENTS_TABLE} WHERE id = ?`);
    return stmt.run(id);
}

// --- Deal Operations ---
export function getAllDeals(
  limit: number = 100,
  offset: number = 0,
  filter: { stage?: string; query?: string; customer_id?: number } = {}
): any[] {
  let sql = `
    SELECT d.*, c.name as customer_name
    FROM ${DEALS_TABLE} d
    LEFT JOIN ${CUSTOMERS_TABLE} c ON d.customer_id = c.id
    WHERE 1=1
  `;

  const params: any[] = [];

  if (filter.customer_id != null) {
    sql += ` AND d.customer_id = ?`;
    params.push(filter.customer_id);
  }

  // Add stage filter if provided
  if (filter.stage) {
    sql += ` AND d.stage = ?`;
    params.push(filter.stage);
  }

  // Add search query filter if provided
  if (filter.query && filter.query.trim() !== '') {
    sql += ` AND (d.name LIKE ? OR c.name LIKE ?)`;
    const searchTerm = `%${filter.query}%`;
    params.push(searchTerm, searchTerm);
  }

  sql += ` ORDER BY d.created_date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
}

export function getDealById(dealId: number): any {
  const stmt = getDb().prepare(`
    SELECT d.*, c.name as customer_name
    FROM ${DEALS_TABLE} d
    LEFT JOIN ${CUSTOMERS_TABLE} c ON d.customer_id = c.id
    WHERE d.id = ?
  `);
  return stmt.get(dealId);
}

export function createDeal(dealData: any): { success: boolean; id?: number; error?: string } {
  try {
    // Prepare timestamp
    const now = new Date().toISOString();

    // Create deal with mandatory fields
    const stmt = getDb().prepare(`
      INSERT INTO ${DEALS_TABLE} (
        customer_id, name, value, value_calculation_method, stage, notes, expected_close_date, created_date, last_modified
      ) VALUES (
        @customer_id, @name, @value, @value_calculation_method, @stage, @notes, @expected_close_date, @created_date, @last_modified
      )
    `);

    const result = stmt.run({
      customer_id: dealData.customer_id,
      name: dealData.name,
      value: dealData.value || 0,
      value_calculation_method: dealData.value_calculation_method || 'static',
      stage: dealData.stage || 'Interessent',
      notes: dealData.notes || '',
      expected_close_date: dealData.expected_close_date || null,
      created_date: now,
      last_modified: now
    });

    const newDealId = result.lastInsertRowid as number;

    try {
      createActivityLog({
        customer_id: dealData.customer_id,
        deal_id: newDealId,
        activity_type: 'deal_created',
        title: `Deal erstellt: ${dealData.name}`,
      });
    } catch (e) {
      console.error('Failed to log deal creation activity:', e);
    }

    return { success: true, id: newDealId };
  } catch (error) {
    console.error('Error creating deal:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function updateDeal(dealId: number, dealData: any): { success: boolean; error?: string } {
  try {
    // Update last_modified timestamp
    dealData.last_modified = new Date().toISOString();

    // Filter out invalid columns and customer_name
    const validColumns = ['name', 'value', 'value_calculation_method', 'stage', 'notes', 'expected_close_date', 'last_modified'];
    const fields = Object.keys(dealData)
      .filter(key => validColumns.includes(key) && dealData[key] !== undefined)
      .map(key => `${key} = @${key}`)
      .join(', ');

    if (!fields.length) {
      return { success: false, error: 'No fields to update' };
    }

    const stmt = getDb().prepare(`
      UPDATE ${DEALS_TABLE}
      SET ${fields}
      WHERE id = @id
    `);

    const result = stmt.run({
      id: dealId,
      ...dealData
    });

    return { success: result.changes > 0, error: result.changes === 0 ? 'Deal not found' : undefined };
  } catch (error) {
    console.error(`Error updating deal ${dealId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function updateDealStage(dealId: number, newStage: string): { success: boolean; error?: string } {
  try {
    // Get old stage for activity log
    const deal = getDb().prepare(`SELECT stage, customer_id FROM ${DEALS_TABLE} WHERE id = ?`).get(dealId) as any;
    const oldStage = deal?.stage;

    const now = new Date().toISOString();

    const stmt = getDb().prepare(`
      UPDATE ${DEALS_TABLE}
      SET stage = ?, last_modified = ?
      WHERE id = ?
    `);

    const result = stmt.run(newStage, now, dealId);

    if (result.changes > 0 && deal) {
      try {
        createActivityLog({
          customer_id: deal.customer_id,
          deal_id: dealId,
          activity_type: 'stage_change',
          title: `Deal-Phase geändert: ${oldStage} → ${newStage}`,
          metadata: JSON.stringify({ old_stage: oldStage, new_stage: newStage }),
        });
      } catch (e) {
        console.error('Failed to log stage change activity:', e);
      }
      void import('./workflow/workflow-trigger-dispatch')
        .then((m) =>
          m.fireDealStageChangedWorkflows(
            dealId,
            Number(deal.customer_id),
            String(oldStage ?? ''),
            newStage,
          ),
        )
        .catch((e) => console.warn('[workflow] deal stage trigger', e));
    }

    return { success: result.changes > 0, error: result.changes === 0 ? 'Deal not found' : undefined };
  } catch (error) {
    console.error(`Error updating deal stage for ${dealId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function getTasksForDeal(dealId: number): any[] {
  // Returns all tasks for the customer associated with this deal
  const stmt = getDb().prepare(`
    SELECT t.*, c.name as customer_name
    FROM ${TASKS_TABLE} t
    LEFT JOIN ${CUSTOMERS_TABLE} c ON t.customer_id = c.id
    WHERE t.customer_id = (SELECT customer_id FROM ${DEALS_TABLE} WHERE id = ?)
    ORDER BY t.due_date ASC
  `);
  return stmt.all(dealId);
}

export function deleteDeal(dealId: number): { success: boolean; error?: string } {
  try {
    const db = getDb();
    // Remove associated products first to avoid orphaned rows
    db.prepare(`DELETE FROM ${DEAL_PRODUCTS_TABLE} WHERE deal_id = ?`).run(dealId);
    const result = db.prepare(`DELETE FROM ${DEALS_TABLE} WHERE id = ?`).run(dealId);
    return { success: result.changes > 0, error: result.changes === 0 ? 'Deal not found' : undefined };
  } catch (error) {
    console.error(`Error deleting deal ${dealId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Deal Operations for Customer ---
export function getDealsForCustomer(customerId: number): any[] {
    // This assumes a 'deals' table with a customer_id field
    const stmt = getDb().prepare(`
        SELECT * FROM deals
        WHERE customer_id = ?
        ORDER BY created_date DESC
    `);
    return stmt.all(customerId);
}

// --- Task Operations ---
export function getAllTasks(
  limit: number = 100,
  offset: number = 0,
  filter: { completed?: boolean; priority?: string; query?: string } = {}
): any[] {
  let sql = `
    SELECT t.*, c.name as customer_name
    FROM ${TASKS_TABLE} t
    LEFT JOIN ${CUSTOMERS_TABLE} c ON t.customer_id = c.id
    WHERE 1=1
  `;

  const params: any[] = [];

  // Add completed filter if provided
  if (filter.completed !== undefined) {
    sql += ` AND t.completed = ?`;
    params.push(filter.completed ? 1 : 0);
  }

  // Add priority filter if provided
  if (filter.priority) {
    sql += ` AND t.priority = ?`;
    params.push(filter.priority);
  }

  // Add search query filter if provided
  if (filter.query && filter.query.trim() !== '') {
    sql += ` AND (t.title LIKE ? OR c.name LIKE ? OR t.description LIKE ?)`;
    const searchTerm = `%${filter.query}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  sql += ` ORDER BY t.due_date ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
}

export function getTaskById(taskId: number): any {
  const stmt = getDb().prepare(`
    SELECT t.*, c.name as customer_name
    FROM ${TASKS_TABLE} t
    LEFT JOIN ${CUSTOMERS_TABLE} c ON t.customer_id = c.id
    WHERE t.id = ?
  `);
  return stmt.get(taskId);
}

export function createTask(taskData: any): { success: boolean; id?: number; error?: string } {
  try {
    const customerId = Number(taskData?.customer_id);
    const title = String(taskData?.title ?? '').trim();
    const priority = String(taskData?.priority ?? 'Medium').trim() || 'Medium';

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return { success: false, error: 'Bitte wählen Sie einen gültigen Kunden aus.' };
    }

    if (!title) {
      return { success: false, error: 'Bitte geben Sie einen Aufgabentitel ein.' };
    }

    const customerExists = getDb()
      .prepare(`SELECT id FROM ${CUSTOMERS_TABLE} WHERE id = ? LIMIT 1`)
      .get(customerId);

    if (!customerExists) {
      return { success: false, error: `Kunde ${customerId} wurde nicht gefunden.` };
    }

    // Prepare timestamp
    const now = new Date().toISOString();

    // Create task with mandatory fields
    const stmt = getDb().prepare(`
      INSERT INTO ${TASKS_TABLE} (
        customer_id, title, description, due_date, priority, completed,
        calendar_event_id, created_date, last_modified
      ) VALUES (
        @customer_id, @title, @description, @due_date, @priority, @completed,
        @calendar_event_id, @created_date, @last_modified
      )
    `);

    const result = stmt.run({
      customer_id: customerId,
      title,
      description: taskData.description || '',
      due_date: taskData.due_date || '',
      priority,
      completed: taskData.completed ? 1 : 0,
      calendar_event_id: taskData.calendar_event_id ?? null,
      created_date: now,
      last_modified: now
    });

    const newTaskId = result.lastInsertRowid as number;

    try {
      createActivityLog({
        customer_id: customerId,
        task_id: newTaskId,
        activity_type: 'task_created',
        title: `Aufgabe erstellt: ${title}`,
      });
    } catch (e) {
      console.error('Failed to log task creation activity:', e);
    }

    return { success: true, id: newTaskId };
  } catch (error) {
    console.error('Error creating task:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function updateTask(taskId: number, taskData: any): { success: boolean; error?: string } {
  try {
    // Update last_modified timestamp
    taskData.last_modified = new Date().toISOString();

    // Convert boolean completed to integer if provided
    if (taskData.completed !== undefined) {
      taskData.completed = taskData.completed ? 1 : 0;
    }

    // Build dynamic update query based on provided fields
    const fields = Object.keys(taskData)
      .filter(key => key !== 'id' && taskData[key] !== undefined)
      .map(key => `${key} = @${key}`)
      .join(', ');

    if (!fields.length) {
      return { success: false, error: 'No fields to update' };
    }

    const stmt = getDb().prepare(`
      UPDATE ${TASKS_TABLE}
      SET ${fields}
      WHERE id = @id
    `);

    const result = stmt.run({
      id: taskId,
      ...taskData
    });

    return { success: result.changes > 0, error: result.changes === 0 ? 'Task not found' : undefined };
  } catch (error) {
    console.error(`Error updating task ${taskId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function updateTaskCompletion(taskId: number, completed: boolean): { success: boolean; error?: string } {
  try {
    const task = getDb().prepare(`SELECT customer_id, title FROM ${TASKS_TABLE} WHERE id = ?`).get(taskId) as any;
    const now = new Date().toISOString();

    const stmt = getDb().prepare(`
      UPDATE ${TASKS_TABLE}
      SET completed = ?, last_modified = ?
      WHERE id = ?
    `);

    const result = stmt.run(completed ? 1 : 0, now, taskId);

    if (result.changes > 0 && task && completed) {
      try {
        createActivityLog({
          customer_id: task.customer_id,
          task_id: taskId,
          activity_type: 'task_completed',
          title: `Aufgabe erledigt: ${task.title}`,
        });
      } catch (e) {
        console.error('Failed to log task completion activity:', e);
      }
    }

    return { success: result.changes > 0, error: result.changes === 0 ? 'Task not found' : undefined };
  } catch (error) {
    console.error(`Error updating task completion for ${taskId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function deleteTask(taskId: number): { success: boolean; error?: string } {
  try {
    const stmt = getDb().prepare(`DELETE FROM ${TASKS_TABLE} WHERE id = ?`);
    const result = stmt.run(taskId);

    return { success: result.changes > 0, error: result.changes === 0 ? 'Task not found' : undefined };
  } catch (error) {
    console.error(`Error deleting task ${taskId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- Task Operations for Customer ---
export function getTasksForCustomer(customerId: number): any[] {
    // This assumes a 'tasks' table with a customer_id field
    const stmt = getDb().prepare(`
        SELECT * FROM tasks
        WHERE customer_id = ?
        ORDER BY due_date ASC
    `);
    return stmt.all(customerId);
}

// --- JTL Specific Entity Operations ---

// JTL Firmen
export function upsertJtlFirma(firma: { kFirma: number; cName: string }): void {
    const stmt = getDb().prepare(
        `INSERT INTO ${JTL_FIRMEN_TABLE} (kFirma, cName)
         VALUES (@kFirma, @cName)
         ON CONFLICT(kFirma) DO UPDATE SET cName = excluded.cName`
    );
    stmt.run(firma);
}

export function getAllJtlFirmen(): { kFirma: number; cName: string }[] {
    const stmt = getDb().prepare(`SELECT kFirma, cName FROM ${JTL_FIRMEN_TABLE} ORDER BY cName`);
    return stmt.all() as { kFirma: number; cName: string }[];
}

// JTL Warenlager
export function upsertJtlWarenlager(lager: { kWarenlager: number; cName: string }): void {
    const stmt = getDb().prepare(
        `INSERT INTO ${JTL_WARENLAGER_TABLE} (kWarenlager, cName)
         VALUES (@kWarenlager, @cName)
         ON CONFLICT(kWarenlager) DO UPDATE SET cName = excluded.cName`
    );
    stmt.run(lager);
}

export function getAllJtlWarenlager(): { kWarenlager: number; cName: string }[] {
    const stmt = getDb().prepare(`SELECT kWarenlager, cName FROM ${JTL_WARENLAGER_TABLE} ORDER BY cName`);
    return stmt.all() as { kWarenlager: number; cName: string }[];
}

// JTL Zahlungsarten
export function upsertJtlZahlungsart(zahlungsart: { kZahlungsart: number; cName: string }): void {
    const stmt = getDb().prepare(
        `INSERT INTO ${JTL_ZAHLUNGSARTEN_TABLE} (kZahlungsart, cName)
         VALUES (@kZahlungsart, @cName)
         ON CONFLICT(kZahlungsart) DO UPDATE SET cName = excluded.cName`
    );
    stmt.run(zahlungsart);
}

export function getAllJtlZahlungsarten(): { kZahlungsart: number; cName: string }[] {
    const stmt = getDb().prepare(`SELECT kZahlungsart, cName FROM ${JTL_ZAHLUNGSARTEN_TABLE} ORDER BY cName`);
    return stmt.all() as { kZahlungsart: number; cName: string }[];
}

// JTL Versandarten
export function upsertJtlVersandart(versandart: { kVersandart: number; cName: string }): void {
    const stmt = getDb().prepare(
        `INSERT INTO ${JTL_VERSANDARTEN_TABLE} (kVersandart, cName)
         VALUES (@kVersandart, @cName)
         ON CONFLICT(kVersandart) DO UPDATE SET cName = excluded.cName`
    );
    stmt.run(versandart);
}

export function getAllJtlVersandarten(): { kVersandart: number; cName: string }[] {
    const stmt = getDb().prepare(`SELECT kVersandart, cName FROM ${JTL_VERSANDARTEN_TABLE} ORDER BY cName`);
    return stmt.all() as { kVersandart: number; cName: string }[];
}

// --- Dashboard Operations ---

/**
 * Get dashboard statistics including customer counts, deal values, and task counts
 */
export function getDashboardStats(): {
    totalCustomers: number;
    newCustomersLastMonth: number;
    activeDealsCount: number;
    activeDealsValue: number;
    pendingTasksCount: number;
    dueTodayTasksCount: number;
    conversionRate: number;
} {
    try {
        const db = getDb();

        // Get total customers count
        const totalCustomersStmt = db.prepare(`SELECT COUNT(*) as count FROM ${CUSTOMERS_TABLE}`);
        const totalCustomersResult = totalCustomersStmt.get() as { count: number };
        const totalCustomers = totalCustomersResult.count;

        // Get new customers in the last month
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const oneMonthAgoStr = oneMonthAgo.toISOString();

        const newCustomersStmt = db.prepare(`
            SELECT COUNT(*) as count FROM ${CUSTOMERS_TABLE}
            WHERE dateAdded >= ?
        `);
        const newCustomersResult = newCustomersStmt.get(oneMonthAgoStr) as { count: number };
        const newCustomersLastMonth = newCustomersResult.count;

        // Get active deals count and value
        // Assuming 'active' deals are those not in 'Closed Won' or 'Closed Lost' stages
        const activeDealsStmt = db.prepare(`
            SELECT COUNT(*) as count, SUM(value) as total_value
            FROM ${DEALS_TABLE}
            WHERE stage NOT IN ('Closed Won', 'Closed Lost')
        `);
        const activeDealsResult = activeDealsStmt.get() as { count: number; total_value: number | null };
        const activeDealsCount = activeDealsResult.count;
        const activeDealsValue = activeDealsResult.total_value || 0;

        // Get pending tasks count
        const pendingTasksStmt = db.prepare(`
            SELECT COUNT(*) as count FROM ${TASKS_TABLE}
            WHERE completed = 0
        `);
        const pendingTasksResult = pendingTasksStmt.get() as { count: number };
        const pendingTasksCount = pendingTasksResult.count;

        // Get tasks due today
        const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD
        const dueTodayTasksStmt = db.prepare(`
            SELECT COUNT(*) as count FROM ${TASKS_TABLE}
            WHERE completed = 0 AND date(due_date) = ?
        `);
        const dueTodayTasksResult = dueTodayTasksStmt.get(today) as { count: number };
        const dueTodayTasksCount = dueTodayTasksResult.count;

        // Calculate conversion rate (closed won deals / total closed deals)
        const conversionRateStmt = db.prepare(`
            SELECT
                COUNT(CASE WHEN stage = 'Closed Won' THEN 1 END) as won,
                COUNT(CASE WHEN stage IN ('Closed Won', 'Closed Lost') THEN 1 END) as total
            FROM ${DEALS_TABLE}
        `);
        const conversionResult = conversionRateStmt.get() as { won: number; total: number };
        const conversionRate = conversionResult.total > 0
            ? (conversionResult.won / conversionResult.total) * 100
            : 0;

        return {
            totalCustomers,
            newCustomersLastMonth,
            activeDealsCount,
            activeDealsValue,
            pendingTasksCount,
            dueTodayTasksCount,
            conversionRate
        };
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        // Return default values on error
        return {
            totalCustomers: 0,
            newCustomersLastMonth: 0,
            activeDealsCount: 0,
            activeDealsValue: 0,
            pendingTasksCount: 0,
            dueTodayTasksCount: 0,
            conversionRate: 0
        };
    }
}

/**
 * Get recent customers with basic information
 */
export function getRecentCustomers(limit: number = 5): any[] {
    try {
        const stmt = getDb().prepare(`
            SELECT id, customerNumber, name, email, dateAdded, jtl_dateCreated
            FROM ${CUSTOMERS_TABLE}
            ORDER BY dateAdded DESC
            LIMIT ?
        `);
        return stmt.all(limit);
    } catch (error) {
        console.error('Error getting recent customers:', error);
        return [];
    }
}

/**
 * Get upcoming tasks with customer information
 */
export function getUpcomingTasks(limit: number = 5): any[] {
    try {
        const stmt = getDb().prepare(`
            SELECT t.id, t.title, t.priority, t.customer_id, t.due_date,
                   c.name as customer_name
            FROM ${TASKS_TABLE} t
            LEFT JOIN ${CUSTOMERS_TABLE} c ON t.customer_id = c.id
            WHERE t.completed = 0
            ORDER BY t.due_date ASC
            LIMIT ?
        `);
        return stmt.all(limit);
    } catch (error) {
        console.error('Error getting upcoming tasks:', error);
        return [];
    }
}

// --- Activity Log ---

export function createActivityLog(data: {
    customer_id?: number;
    deal_id?: number;
    task_id?: number;
    activity_type: string;
    title?: string;
    description?: string;
    metadata?: string;
}): { success: boolean; id?: number; error?: string } {
    try {
        const stmt = getDb().prepare(`
            INSERT INTO ${ACTIVITY_LOG_TABLE} (customer_id, deal_id, task_id, activity_type, title, description, metadata, created_at)
            VALUES (@customer_id, @deal_id, @task_id, @activity_type, @title, @description, @metadata, @created_at)
        `);
        const result = stmt.run({
            customer_id: data.customer_id ?? null,
            deal_id: data.deal_id ?? null,
            task_id: data.task_id ?? null,
            activity_type: data.activity_type,
            title: data.title ?? null,
            description: data.description ?? null,
            metadata: data.metadata ?? null,
            created_at: new Date().toISOString(),
        });
        return { success: true, id: result.lastInsertRowid as number };
    } catch (error) {
        console.error('Error creating activity log:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export function getActivityLogForCustomer(customerId: number, limit: number = 50, offset: number = 0): any[] {
    const stmt = getDb().prepare(`
        SELECT * FROM ${ACTIVITY_LOG_TABLE}
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `);
    return stmt.all(customerId, limit, offset);
}

export function getActivityLogForDeal(dealId: number, limit: number = 50, offset: number = 0): any[] {
    const stmt = getDb().prepare(`
        SELECT * FROM ${ACTIVITY_LOG_TABLE}
        WHERE deal_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `);
    return stmt.all(dealId, limit, offset);
}

export function getTimeline(customerId: number, filter?: string, limit: number = 50, offset: number = 0): any[] {
    let sql = `
        SELECT * FROM ${ACTIVITY_LOG_TABLE}
        WHERE customer_id = ?
    `;
    const params: any[] = [customerId];

    if (filter === 'tasks') {
        sql += ` AND activity_type IN ('task_created', 'task_completed')`;
    } else if (filter === 'deals') {
        sql += ` AND activity_type IN ('stage_change', 'deal_created')`;
    } else if (filter === 'communication') {
        sql += ` AND activity_type IN ('call', 'email', 'note')`;
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = getDb().prepare(sql);
    return stmt.all(...params);
}

// --- Follow-up Queue ---

export function getFollowUpQueueCounts(): {
    heute: number;
    ueberfaellig: number;
    dieseWoche: number;
    zurueckgestellt: number;
    stagnierend: number;
    highValueRisk: number;
} {
    const today = new Date().toISOString().slice(0, 10);
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowISO = new Date().toISOString();

    const stmt = getDb().prepare(`
        SELECT
            (SELECT COUNT(*) FROM ${TASKS_TABLE} WHERE completed = 0
                AND due_date IS NOT NULL AND due_date != ''
                AND substr(due_date, 1, 10) = ?
                AND (snoozed_until IS NULL OR snoozed_until <= ?)) as heute,
            (SELECT COUNT(*) FROM ${TASKS_TABLE} WHERE completed = 0
                AND due_date IS NOT NULL AND due_date != ''
                AND substr(due_date, 1, 10) < ?
                AND (snoozed_until IS NULL OR snoozed_until <= ?)) as ueberfaellig,
            (SELECT COUNT(*) FROM ${TASKS_TABLE} WHERE completed = 0
                AND due_date IS NOT NULL AND due_date != ''
                AND substr(due_date, 1, 10) >= ? AND substr(due_date, 1, 10) <= ?
                AND (snoozed_until IS NULL OR snoozed_until <= ?)) as dieseWoche,
            (SELECT COUNT(*) FROM ${TASKS_TABLE} WHERE completed = 0
                AND snoozed_until IS NOT NULL AND snoozed_until > ?) as zurueckgestellt,
            (SELECT COUNT(*) FROM ${DEALS_TABLE} WHERE
                stage NOT IN ('Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost')
                AND last_modified < ?) as stagnierend,
            (SELECT COUNT(*) FROM ${DEALS_TABLE} WHERE
                stage NOT IN ('Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost')
                AND value > 1000
                AND (
                    (expected_close_date IS NOT NULL AND expected_close_date != '' AND substr(expected_close_date, 1, 10) <= ?)
                    OR last_modified < ?
                )) as highValueRisk
    `);

    const row = stmt.get(
        today, nowISO,
        today, nowISO,
        today, weekFromNow, nowISO,
        nowISO,
        fourteenDaysAgo,
        weekFromNow, sevenDaysAgo
    ) as any;

    return {
        heute: row.heute ?? 0,
        ueberfaellig: row.ueberfaellig ?? 0,
        dieseWoche: row.dieseWoche ?? 0,
        zurueckgestellt: row.zurueckgestellt ?? 0,
        stagnierend: row.stagnierend ?? 0,
        highValueRisk: row.highValueRisk ?? 0,
    };
}

export function getFollowUpItems(
    queue: string,
    filters: { query?: string; priority?: string } = {},
    limit: number = 100,
    offset: number = 0
): any[] {
    const today = new Date().toISOString().slice(0, 10);
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowISO = new Date().toISOString();

    let sql = '';
    const params: any[] = [];

    if (queue === 'stagnierende_deals' || queue === 'high_value_risk') {
        // Deal-based queues
        sql = `
            SELECT
                d.id as item_id,
                'deal' as source_type,
                d.customer_id,
                c.name as customer_name,
                d.id as deal_id,
                d.name as deal_name,
                d.value as deal_value,
                d.stage as deal_stage,
                d.name as title,
                NULL as due_date,
                'Medium' as priority,
                d.last_modified as snoozed_until,
                0 as completed,
                (CAST(d.value AS REAL) / 1000.0 + MAX(0, julianday('now') - julianday(d.last_modified)) * 2) as priority_score,
                (SELECT MAX(al.created_at) FROM ${ACTIVITY_LOG_TABLE} al WHERE al.customer_id = d.customer_id) as last_contact_date
            FROM ${DEALS_TABLE} d
            LEFT JOIN ${CUSTOMERS_TABLE} c ON d.customer_id = c.id
            WHERE d.stage NOT IN ('Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost')
        `;

        if (queue === 'stagnierende_deals') {
            sql += ` AND d.last_modified < ?`;
            params.push(fourteenDaysAgo);
        } else {
            // high_value_risk
            sql += ` AND d.value > 1000 AND (
                (d.expected_close_date IS NOT NULL AND d.expected_close_date != '' AND substr(d.expected_close_date, 1, 10) <= ?)
                OR d.last_modified < ?
            )`;
            params.push(weekFromNow, sevenDaysAgo);
        }

        if (filters.query && filters.query.trim()) {
            sql += ` AND (d.name LIKE ? OR c.name LIKE ?)`;
            const term = `%${filters.query}%`;
            params.push(term, term);
        }

        sql += ` ORDER BY priority_score DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
    } else {
        // Task-based queues
        sql = `
            SELECT
                t.id as item_id,
                'task' as source_type,
                t.customer_id,
                c.name as customer_name,
                d.id as deal_id,
                d.name as deal_name,
                d.value as deal_value,
                d.stage as deal_stage,
                t.title,
                t.due_date,
                t.priority,
                t.snoozed_until,
                t.completed,
                (CASE t.priority WHEN 'High' THEN 30 WHEN 'Medium' THEN 15 ELSE 5 END
                 + CASE WHEN t.due_date IS NOT NULL AND t.due_date != '' THEN MAX(0, julianday('now') - julianday(t.due_date)) * 5 ELSE 0 END) as priority_score,
                (SELECT MAX(al.created_at) FROM ${ACTIVITY_LOG_TABLE} al WHERE al.customer_id = t.customer_id) as last_contact_date
            FROM ${TASKS_TABLE} t
            LEFT JOIN ${CUSTOMERS_TABLE} c ON t.customer_id = c.id
            LEFT JOIN ${DEALS_TABLE} d ON d.customer_id = t.customer_id AND d.stage NOT IN ('Gewonnen', 'Verloren', 'Closed Won', 'Closed Lost')
            WHERE t.completed = 0
        `;

        // Queue-specific filters
        if (queue === 'heute') {
            sql += ` AND t.due_date IS NOT NULL AND t.due_date != '' AND substr(t.due_date, 1, 10) = ?`;
            params.push(today);
            sql += ` AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)`;
            params.push(nowISO);
        } else if (queue === 'ueberfaellig') {
            sql += ` AND t.due_date IS NOT NULL AND t.due_date != '' AND substr(t.due_date, 1, 10) < ?`;
            params.push(today);
            sql += ` AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)`;
            params.push(nowISO);
        } else if (queue === 'diese_woche') {
            sql += ` AND t.due_date IS NOT NULL AND t.due_date != '' AND substr(t.due_date, 1, 10) >= ? AND substr(t.due_date, 1, 10) <= ?`;
            params.push(today, weekFromNow);
            sql += ` AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)`;
            params.push(nowISO);
        } else if (queue === 'zurueckgestellt') {
            sql += ` AND t.snoozed_until IS NOT NULL AND t.snoozed_until > ?`;
            params.push(nowISO);
        }

        // Additional filters
        if (filters.priority) {
            sql += ` AND t.priority = ?`;
            params.push(filters.priority);
        }

        if (filters.query && filters.query.trim()) {
            sql += ` AND (t.title LIKE ? OR c.name LIKE ? OR t.description LIKE ?)`;
            const term = `%${filters.query}%`;
            params.push(term, term, term);
        }

        if (queue === 'zurueckgestellt') {
            sql += ` GROUP BY t.id ORDER BY datetime(t.snoozed_until) ASC LIMIT ? OFFSET ?`;
        } else {
            sql += ` GROUP BY t.id ORDER BY priority_score DESC LIMIT ? OFFSET ?`;
        }
        params.push(limit, offset);
    }

    const stmt = getDb().prepare(sql);
    // Add reason field after query
    const items = stmt.all(...params);
    return (items as any[]).map(item => ({
        ...item,
        reason: getQueueReason(queue, item),
    }));
}

function getQueueReason(queue: string, item: any): string {
    if (queue === 'heute') return 'Heute fällig';
    if (queue === 'ueberfaellig') {
        const daysOverdue = item.due_date
            ? Math.floor((Date.now() - new Date(item.due_date).getTime()) / (1000 * 60 * 60 * 24))
            : 0;
        return daysOverdue > 1 ? `${daysOverdue} Tage überfällig` : '1 Tag überfällig';
    }
    if (queue === 'diese_woche') return 'Diese Woche fällig';
    if (queue === 'zurueckgestellt') {
        if (item.snoozed_until) {
            const wake = new Date(item.snoozed_until);
            if (!Number.isNaN(wake.getTime())) {
                return `Zurückgestellt bis ${wake.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
            }
        }
        return 'Zurückgestellt';
    }
    if (queue === 'stagnierende_deals') {
        const daysSince = item.snoozed_until
            ? Math.floor((Date.now() - new Date(item.snoozed_until).getTime()) / (1000 * 60 * 60 * 24))
            : 0;
        return `Deal stagniert (${daysSince} Tage)`;
    }
    if (queue === 'high_value_risk') return 'Hoher Wert, Abschluss gefährdet';
    return '';
}

export function snoozeTask(taskId: number, snoozedUntil: string): { success: boolean; error?: string } {
    try {
        const now = new Date().toISOString();
        const stmt = getDb().prepare(`
            UPDATE ${TASKS_TABLE}
            SET snoozed_until = ?, last_modified = ?
            WHERE id = ?
        `);
        const result = stmt.run(snoozedUntil, now, taskId);
        return { success: result.changes > 0, error: result.changes === 0 ? 'Task not found' : undefined };
    } catch (error) {
        console.error(`Error snoozing task ${taskId}:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// --- Saved Views ---

export function getSavedViews(): any[] {
    const stmt = getDb().prepare(`
        SELECT * FROM ${SAVED_VIEWS_TABLE}
        ORDER BY display_order ASC, created_at ASC
    `);
    return stmt.all();
}

export function createSavedView(data: { name: string; filters: string }): { success: boolean; id?: number; error?: string } {
    try {
        const stmt = getDb().prepare(`
            INSERT INTO ${SAVED_VIEWS_TABLE} (name, filters, created_at)
            VALUES (@name, @filters, @created_at)
        `);
        const result = stmt.run({
            name: data.name,
            filters: data.filters,
            created_at: new Date().toISOString(),
        });
        return { success: true, id: result.lastInsertRowid as number };
    } catch (error) {
        console.error('Error creating saved view:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export function deleteSavedView(id: number): { success: boolean; error?: string } {
    try {
        const stmt = getDb().prepare(`DELETE FROM ${SAVED_VIEWS_TABLE} WHERE id = ?`);
        const result = stmt.run(id);
        return { success: result.changes > 0, error: result.changes === 0 ? 'View not found' : undefined };
    } catch (error) {
        console.error(`Error deleting saved view ${id}:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

// --- Cleanup ---
export function closeDatabase() {
    if (db) {
        db.close();
        db = undefined;
        console.log('Database connection closed.');
    }
}

/** Re-open SQLite after a failed restore (main process still running). */
export function reopenDatabaseConnection(): void {
    if (db) {
        try {
            db.prepare('SELECT 1').get();
            return;
        } catch {
            try {
                db.close();
            } catch {
                /* already closed */
            }
            db = undefined;
        }
    }
    initializeDatabase();
    // Optional Knex cleanup
    // if (knex) {
    //   await knex.destroy();
    //   console.log('Knex connection destroyed.');
    // }
}
