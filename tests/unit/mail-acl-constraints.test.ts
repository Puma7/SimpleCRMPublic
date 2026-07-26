import {
  constraintsEqual,
  hasMailBindingConstraints,
  messageMatchesConstraints,
  type MailScopeActorContext,
} from '../../packages/server/src/mail-access/types';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import type { MailAccessGrant, MailAccessPort } from '../../packages/server/src/mail-access/types';

const ACTOR: MailScopeActorContext = {
  userId: 'user-a',
  groupMemberUserIds: ['user-a', 'user-b'],
};

describe('mail ACL visibility constraints', () => {
  test('hasMailBindingConstraints detects active filters', () => {
    expect(hasMailBindingConstraints(null)).toBe(false);
    expect(hasMailBindingConstraints({
      assignmentMode: null,
      categoryAllowIds: [],
      categoryExcludeIds: [],
      tagAllowValues: [],
      tagExcludeValues: [],
    })).toBe(false);
    expect(hasMailBindingConstraints({
      assignmentMode: 'assigned_to_me',
      categoryAllowIds: [],
      categoryExcludeIds: [],
      tagAllowValues: [],
      tagExcludeValues: [],
    })).toBe(true);
  });

  test('messageMatchesConstraints ANDs assignment, category and tag rules', () => {
    const facts = {
      assignedToUserId: 'user-a',
      assignedTo: null,
      categoryIds: [10, 11],
      tags: ['Shop-X'],
    };
    expect(messageMatchesConstraints(facts, {
      assignmentMode: 'assigned_to_me',
      categoryAllowIds: [10],
      categoryExcludeIds: [],
      tagAllowValues: ['Shop-X'],
      tagExcludeValues: ['Rechnung'],
    }, ACTOR)).toBe(true);

    expect(messageMatchesConstraints(facts, {
      assignmentMode: 'assigned_to_me',
      categoryAllowIds: [10],
      categoryExcludeIds: [],
      tagAllowValues: ['Shop-X'],
      tagExcludeValues: ['Shop-X'],
    }, ACTOR)).toBe(false);

    expect(messageMatchesConstraints(facts, {
      assignmentMode: 'unassigned',
      categoryAllowIds: [],
      categoryExcludeIds: [],
      tagAllowValues: [],
      tagExcludeValues: [],
    }, ACTOR)).toBe(false);
  });

  test('constraintsEqual is order-insensitive for id sets', () => {
    expect(constraintsEqual(
      {
        assignmentMode: null,
        categoryAllowIds: [2, 1],
        categoryExcludeIds: [],
        tagAllowValues: ['b', 'a'],
        tagExcludeValues: [],
      },
      {
        assignmentMode: null,
        categoryAllowIds: [1, 2],
        categoryExcludeIds: [],
        tagAllowValues: ['a', 'b'],
        tagExcludeValues: [],
      },
    )).toBe(true);
  });

  test('MailAccessService resolveScope attaches clauses when grants have constraints', async () => {
    const grants: MailAccessGrant[] = [{
      bindingId: 1,
      resourceType: 'account',
      accountId: 7,
      folderId: null,
      messageId: null,
      constraints: {
        assignmentMode: 'assigned_to_me',
        categoryAllowIds: [],
        categoryExcludeIds: [],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
    }];
    const port: MailAccessPort = {
      async resolveGrants() {
        return grants;
      },
      async resolveScopeActorContext() {
        return ACTOR;
      },
    };
    const service = new MailAccessService(port);
    const scope = await service.resolveScope({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      actor: {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-a',
        isOwner: false,
        isAdmin: false,
      },
      permission: 'mail.metadata.read',
    });
    expect(scope.kind).toBe('restricted');
    if (scope.kind !== 'restricted') return;
    expect(scope.clauses).toHaveLength(1);
    expect(scope.clauses?.[0]?.constraints?.assignmentMode).toBe('assigned_to_me');
    expect(scope.actor?.userId).toBe('user-a');
  });
});
