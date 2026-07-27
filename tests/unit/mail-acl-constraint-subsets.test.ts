import {
  EMPTY_MAIL_BINDING_CONSTRAINTS,
  isConstraintsAtLeastAsRestrictive,
} from '../../packages/server/src/mail-access/mail-acl-constraints';

const withMode = (mode: 'assigned_to_me' | 'assigned_to_my_groups' | 'unassigned' | null) => ({
  ...EMPTY_MAIL_BINDING_CONSTRAINTS,
  assignmentMode: mode,
});

/**
 * Re-Delegation darf den sichtbaren Bereich nie erweitern. Bei den relativen
 * Zuweisungsmodi gibt es aber genau eine echte Teilmengenbeziehung:
 * assigned_to_me liegt fuer JEDEN Betrachter in assigned_to_my_groups, weil der
 * Akteurskontext den Nutzer selbst immer in groupMemberUserIds fuehrt.
 */
describe('mail acl constraint subsets', () => {
  test('a personal filter is accepted under a group authority', () => {
    expect(isConstraintsAtLeastAsRestrictive(
      withMode('assigned_to_me'),
      withMode('assigned_to_my_groups'),
    )).toBe(true);
  });

  test('the reverse widens and stays forbidden', () => {
    expect(isConstraintsAtLeastAsRestrictive(
      withMode('assigned_to_my_groups'),
      withMode('assigned_to_me'),
    )).toBe(false);
  });

  test('unassigned is unrelated to both relative modes', () => {
    expect(isConstraintsAtLeastAsRestrictive(withMode('unassigned'), withMode('assigned_to_me'))).toBe(false);
    expect(isConstraintsAtLeastAsRestrictive(withMode('unassigned'), withMode('assigned_to_my_groups'))).toBe(false);
    expect(isConstraintsAtLeastAsRestrictive(withMode('assigned_to_me'), withMode('unassigned'))).toBe(false);
  });

  test('dropping the filter entirely still widens', () => {
    expect(isConstraintsAtLeastAsRestrictive(withMode(null), withMode('assigned_to_my_groups'))).toBe(false);
    // Ohne Autoritaets-Filter ist jeder Kandidat erlaubt.
    expect(isConstraintsAtLeastAsRestrictive(withMode('assigned_to_me'), withMode(null))).toBe(true);
  });

  test('the stricter mode does not smuggle wider category filters', () => {
    const authority = { ...withMode('assigned_to_my_groups'), categoryAllowIds: [5] };
    const widerCategories = { ...withMode('assigned_to_me'), categoryAllowIds: [5, 9] };
    const narrowerCategories = { ...withMode('assigned_to_me'), categoryAllowIds: [5] };

    expect(isConstraintsAtLeastAsRestrictive(widerCategories, authority)).toBe(false);
    expect(isConstraintsAtLeastAsRestrictive(narrowerCategories, authority)).toBe(true);
  });
});
