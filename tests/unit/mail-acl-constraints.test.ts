import {
  constraintsEqual,
  DENY_ALL_CATEGORY_ALLOW_ID,
  DENY_ALL_TAG_ALLOW_VALUE,
  hasMailBindingConstraints,
  mergeAuthorityConstraints,
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
  test('deny-all tag sentinel is Postgres-safe text', () => {
    expect(DENY_ALL_TAG_ALLOW_VALUE.includes('\u0000')).toBe(false);
    expect(DENY_ALL_TAG_ALLOW_VALUE.length).toBeGreaterThan(0);
  });

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

  test('mergeAuthorityConstraints keeps deny-all for disjoint allowlists', () => {
    const merged = mergeAuthorityConstraints(
      {
        assignmentMode: null,
        categoryAllowIds: [1, 2],
        categoryExcludeIds: [],
        tagAllowValues: ['a'],
        tagExcludeValues: [],
      },
      {
        assignmentMode: null,
        categoryAllowIds: [3, 4],
        categoryExcludeIds: [],
        tagAllowValues: ['b'],
        tagExcludeValues: [],
      },
    );
    expect(merged.categoryAllowIds).toEqual([DENY_ALL_CATEGORY_ALLOW_ID]);
    expect(merged.tagAllowValues).toEqual([DENY_ALL_TAG_ALLOW_VALUE]);
    expect(hasMailBindingConstraints(merged)).toBe(true);
    expect(messageMatchesConstraints({
      assignedToUserId: null,
      assignedTo: null,
      categoryIds: [1, 3],
      tags: ['a', 'b'],
    }, merged, ACTOR)).toBe(false);
  });

  test('mergeAuthorityConstraints intersects overlapping allowlists', () => {
    const merged = mergeAuthorityConstraints(
      {
        assignmentMode: 'assigned_to_me',
        categoryAllowIds: [1, 2],
        categoryExcludeIds: [9],
        tagAllowValues: ['a', 'b'],
        tagExcludeValues: [],
      },
      {
        assignmentMode: null,
        categoryAllowIds: [2, 3],
        categoryExcludeIds: [8],
        tagAllowValues: ['b', 'c'],
        tagExcludeValues: ['x'],
      },
    );
    expect(merged.assignmentMode).toBe('assigned_to_me');
    expect(merged.categoryAllowIds).toEqual([2]);
    expect(merged.categoryExcludeIds).toEqual([8, 9]);
    expect(merged.tagAllowValues).toEqual(['b']);
    expect(merged.tagExcludeValues).toEqual(['x']);
  });

  test('mergeAuthorityConstraints denies conflicting assignment modes', () => {
    const merged = mergeAuthorityConstraints(
      {
        assignmentMode: 'assigned_to_me',
        categoryAllowIds: [],
        categoryExcludeIds: [],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
      {
        assignmentMode: 'unassigned',
        categoryAllowIds: [],
        categoryExcludeIds: [],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
    );
    expect(merged.categoryAllowIds).toEqual([DENY_ALL_CATEGORY_ALLOW_ID]);
    expect(merged.tagAllowValues).toEqual([DENY_ALL_TAG_ALLOW_VALUE]);
    expect(hasMailBindingConstraints(merged)).toBe(true);
  });

  test('deny-all category sentinel survives positive-id filtering', () => {
    const ids = [DENY_ALL_CATEGORY_ALLOW_ID, 0, 1, 2]
      .filter((id) => Number.isSafeInteger(id) && (id > 0 || id === DENY_ALL_CATEGORY_ALLOW_ID));
    expect(ids).toEqual([DENY_ALL_CATEGORY_ALLOW_ID, 1, 2]);
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
