import { canEnforceAssignmentFilter } from '../../packages/server/src/mail-access/sql-scope';

describe('canEnforceAssignmentFilter', () => {
  const actor = { userId: 'user-a', groupMemberUserIds: ['user-a'] };
  const assignedConstraints = {
    assignmentMode: 'assigned_to_me' as const,
    categoryAllowIds: [10],
    categoryExcludeIds: [],
    tagAllowValues: [],
    tagExcludeValues: [],
  };

  test('fails closed when assignment mode is set without assignee columns', () => {
    expect(canEnforceAssignmentFilter(assignedConstraints, {
      accountId: 'email_messages.account_id',
      messageId: 'email_messages.id',
    }, actor)).toBe(false);
  });

  test('fails closed when actor context is missing', () => {
    expect(canEnforceAssignmentFilter(assignedConstraints, {
      accountId: 'email_messages.account_id',
      messageId: 'email_messages.id',
      assignedToUserId: 'email_messages.assigned_to_user_id',
    }, undefined)).toBe(false);
  });

  test('allows enforcement when assignee columns and actor are present', () => {
    expect(canEnforceAssignmentFilter(assignedConstraints, {
      accountId: 'email_messages.account_id',
      messageId: 'email_messages.id',
      assignedToUserId: 'email_messages.assigned_to_user_id',
    }, actor)).toBe(true);
  });

  test('is a no-op for unconstrained assignment mode', () => {
    expect(canEnforceAssignmentFilter({
      assignmentMode: null,
      categoryAllowIds: [10],
      categoryExcludeIds: [],
      tagAllowValues: [],
      tagExcludeValues: [],
    }, { messageId: 'email_messages.id' }, undefined)).toBe(true);
  });
});
