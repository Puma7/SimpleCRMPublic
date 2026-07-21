import type { SqlMigration } from './types';

/**
 * The message-level ACL binding FK (mail_acl_bindings_message_fk, created in 0038)
 * references the message's CURRENT (workspace_id, account_id, folder_id, id) with the
 * default ON UPDATE NO ACTION. But a message legitimately moves account/folder:
 * updateRelayedMessageContent reroutes a failed relay retry to the current account and
 * folder, and the SQLite importer rewrites account_id/folder_id on re-import conflict.
 * With NO ACTION the referenced composite key vanishes when the message moves, so the
 * FK rejects the update once a message-level binding exists — failing the whole
 * retry/import transaction.
 *
 * Recreate the constraint with ON UPDATE CASCADE so the per-message grant follows the
 * message to its new location (message_id stays fixed), keeping BOTH the SQL scope and
 * the in-memory grant matcher (which compares the message's current account/folder)
 * correct. 0038 is immutable (its source is checksum-pinned), so this ships as a
 * separate migration; Postgres has no ALTER CONSTRAINT for referential actions, so it
 * drops and recreates the FK. Folder/account bindings have NULL columns in this FK
 * (MATCH SIMPLE) and are untouched, so a folder grant does not follow a moved message.
 */
export const mailAclBindingMessageFkCascadeMigration: SqlMigration = {
  id: '0041_mail_acl_binding_message_fk_cascade',
  description: 'Cascade message account/folder key updates into message-level ACL bindings',
  upSql: [
    'ALTER TABLE mail_acl_bindings DROP CONSTRAINT IF EXISTS mail_acl_bindings_message_fk;',
    `ALTER TABLE mail_acl_bindings ADD CONSTRAINT mail_acl_bindings_message_fk
      FOREIGN KEY (workspace_id, account_id, folder_id, message_id)
      REFERENCES email_messages(workspace_id, account_id, folder_id, id)
      ON UPDATE CASCADE ON DELETE CASCADE;`,
  ],
  downSql: [
    'ALTER TABLE mail_acl_bindings DROP CONSTRAINT IF EXISTS mail_acl_bindings_message_fk;',
    `ALTER TABLE mail_acl_bindings ADD CONSTRAINT mail_acl_bindings_message_fk
      FOREIGN KEY (workspace_id, account_id, folder_id, message_id)
      REFERENCES email_messages(workspace_id, account_id, folder_id, id)
      ON DELETE CASCADE;`,
  ],
};
