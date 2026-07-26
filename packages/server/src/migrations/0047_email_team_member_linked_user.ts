import type { SqlMigration } from './types';

/**
 * Explicit link from free-text mail team members (e.g. agent-2) to workspace users
 * so assigned_to_me / assigned_to_my_groups can resolve via assigned_to_user_id.
 */
export const emailTeamMemberLinkedUserMigration: SqlMigration = {
  id: '0047_email_team_member_linked_user',
  description: 'Add linked_user_id on email_team_members for assignment filters',
  upSql: [
    `ALTER TABLE email_team_members
      ADD COLUMN IF NOT EXISTS linked_user_id uuid REFERENCES users(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS email_team_members_linked_user_idx
      ON email_team_members (workspace_id, linked_user_id)
      WHERE linked_user_id IS NOT NULL`,
    `UPDATE email_team_members AS member
     SET linked_user_id = users.id
     FROM users
     WHERE users.workspace_id = member.workspace_id
       AND users.id::text = member.id
       AND member.linked_user_id IS NULL`,
  ],
  downSql: [
    `DROP INDEX IF EXISTS email_team_members_linked_user_idx`,
    `ALTER TABLE email_team_members DROP COLUMN IF EXISTS linked_user_id`,
  ],
};
