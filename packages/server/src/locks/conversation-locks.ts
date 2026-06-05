export type ConversationLockReason = 'reply' | 'forward' | 'edit';

export type SqlCommand = Readonly<{
  sql: string;
  params: readonly unknown[];
}>;

export const CONVERSATION_LOCK_HEARTBEAT_SECONDS = 30;
export const CONVERSATION_LOCK_TIMEOUT_SECONDS = 120;

export function acquireConversationLockCommand(input: {
  messageId: number;
  userId: string;
  workspaceId: string;
  reason: ConversationLockReason;
}): SqlCommand {
  return {
    sql: `INSERT INTO conversation_locks (message_id, user_id, workspace_id, reason)
VALUES ($1, $2, $3, $4)
ON CONFLICT (message_id) DO NOTHING
RETURNING message_id, user_id, workspace_id, acquired_at, last_heartbeat_at, reason, takeover_count;`,
    params: [input.messageId, input.userId, input.workspaceId, input.reason],
  };
}

export function getConversationLockCommand(input: {
  messageId: number;
  workspaceId: string;
}): SqlCommand {
  return {
    sql: `SELECT
  l.message_id,
  l.user_id,
  l.workspace_id,
  l.acquired_at,
  l.last_heartbeat_at,
  l.reason,
  l.takeover_count,
  u.display_name,
  u.email
FROM conversation_locks l
JOIN users u ON u.id = l.user_id AND u.workspace_id = l.workspace_id
WHERE l.message_id = $1 AND l.workspace_id = $2;`,
    params: [input.messageId, input.workspaceId],
  };
}

export function heartbeatConversationLockCommand(input: {
  messageId: number;
  userId: string;
  workspaceId: string;
}): SqlCommand {
  return {
    sql: `UPDATE conversation_locks
SET last_heartbeat_at = now()
WHERE message_id = $1 AND user_id = $2 AND workspace_id = $3
RETURNING message_id, user_id, workspace_id, acquired_at, last_heartbeat_at, reason, takeover_count;`,
    params: [input.messageId, input.userId, input.workspaceId],
  };
}

export function releaseConversationLockCommand(input: {
  messageId: number;
  userId: string;
  workspaceId: string;
  allowAdminOverride?: boolean;
}): SqlCommand {
  return {
    sql: `DELETE FROM conversation_locks
WHERE message_id = $1
  AND workspace_id = $2
  AND (user_id = $3 OR $4::boolean = true)
RETURNING message_id, user_id, workspace_id, acquired_at, last_heartbeat_at, reason, takeover_count;`,
    params: [input.messageId, input.workspaceId, input.userId, input.allowAdminOverride === true],
  };
}

export function cleanupStaleConversationLocksCommand(workspaceId: string): SqlCommand {
  return {
    sql: `DELETE FROM conversation_locks
WHERE workspace_id = $1
  AND last_heartbeat_at < now() - interval '2 minutes'
RETURNING message_id, user_id, workspace_id, acquired_at, last_heartbeat_at, reason, takeover_count;`,
    params: [workspaceId],
  };
}

export function forceTakeoverConversationLockCommand(input: {
  messageId: number;
  newUserId: string;
  workspaceId: string;
  reason: ConversationLockReason;
}): SqlCommand {
  return {
    sql: `WITH removed AS (
  DELETE FROM conversation_locks
  WHERE message_id = $1 AND workspace_id = $2
  RETURNING takeover_count
),
inserted AS (
  INSERT INTO conversation_locks (message_id, user_id, workspace_id, reason, takeover_count)
  VALUES ($1, $3, $2, $4, COALESCE((SELECT takeover_count + 1 FROM removed), 1))
  RETURNING message_id, user_id, workspace_id, acquired_at, last_heartbeat_at, reason, takeover_count
)
SELECT * FROM inserted;`,
    params: [input.messageId, input.workspaceId, input.newUserId, input.reason],
  };
}
