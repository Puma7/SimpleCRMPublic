import type Database from 'better-sqlite3';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_TEAM_MEMBERS_TABLE,
} from '../database-schema';

/**
 * NF17b: referential integrity for assigned_to on existing DBs (no table rebuild).
 * Fresh installs use FK in createEmailMessagesTable; upgrades get triggers + orphan cleanup.
 */
export function ensureAssignedToReferentialIntegrity(connection: Database.Database): void {
  const teamExists = connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(EMAIL_TEAM_MEMBERS_TABLE);
  const msgExists = connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(EMAIL_MESSAGES_TABLE);
  if (!teamExists || !msgExists) return;

  console.log('Ensuring email_messages.assigned_to referential integrity (NF17b)...');

  const cleared = connection
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET assigned_to = NULL
       WHERE assigned_to IS NOT NULL
         AND assigned_to NOT IN (SELECT id FROM ${EMAIL_TEAM_MEMBERS_TABLE})`,
    )
    .run();
  if (cleared.changes > 0) {
    console.log(`Cleared ${cleared.changes} orphaned assigned_to values`);
  }

  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS email_team_members_clear_assigned_ad
    AFTER DELETE ON ${EMAIL_TEAM_MEMBERS_TABLE}
    FOR EACH ROW
    BEGIN
      UPDATE ${EMAIL_MESSAGES_TABLE} SET assigned_to = NULL WHERE assigned_to = OLD.id;
    END;
  `);

  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS email_messages_assigned_to_valid_ins
    BEFORE INSERT ON ${EMAIL_MESSAGES_TABLE}
    FOR EACH ROW
    WHEN NEW.assigned_to IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${EMAIL_TEAM_MEMBERS_TABLE} WHERE id = NEW.assigned_to)
    BEGIN
      SELECT RAISE(ABORT, 'assigned_to must reference email_team_members');
    END;
  `);

  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS email_messages_assigned_to_valid_upd
    BEFORE UPDATE OF assigned_to ON ${EMAIL_MESSAGES_TABLE}
    FOR EACH ROW
    WHEN NEW.assigned_to IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${EMAIL_TEAM_MEMBERS_TABLE} WHERE id = NEW.assigned_to)
    BEGIN
      SELECT RAISE(ABORT, 'assigned_to must reference email_team_members');
    END;
  `);
}
