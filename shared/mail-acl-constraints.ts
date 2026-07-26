/**
 * Optional visibility filters attached to a mail ACL binding.
 * AND-combined with the binding's account/folder/message resource scope.
 */

export type MailAssignmentMode =
  | 'any'
  | 'assigned_to_me'
  | 'assigned_to_my_groups'
  | 'unassigned';

export type MailAclConstraintKind = 'assignment' | 'category' | 'tag'
export type MailAclConstraintMode = 'allow' | 'exclude' | 'filter'

export type MailBindingVisibilityConstraints = Readonly<{
  /** null / 'any' = no assignment filter */
  assignmentMode: MailAssignmentMode | null
  categoryAllowIds: readonly number[]
  categoryExcludeIds: readonly number[]
  /** Tags are free-text in the schema (no tag catalog IDs). */
  tagAllowValues: readonly string[]
  tagExcludeValues: readonly string[]
}>

export const EMPTY_MAIL_BINDING_CONSTRAINTS: MailBindingVisibilityConstraints = Object.freeze({
  assignmentMode: null,
  categoryAllowIds: Object.freeze([] as number[]),
  categoryExcludeIds: Object.freeze([] as number[]),
  tagAllowValues: Object.freeze([] as string[]),
  tagExcludeValues: Object.freeze([] as string[]),
})

export function hasMailBindingConstraints(
  constraints: MailBindingVisibilityConstraints | null | undefined,
): boolean {
  if (!constraints) return false
  if (constraints.assignmentMode && constraints.assignmentMode !== 'any') return true
  if (constraints.categoryAllowIds.length > 0) return true
  if (constraints.categoryExcludeIds.length > 0) return true
  if (constraints.tagAllowValues.length > 0) return true
  if (constraints.tagExcludeValues.length > 0) return true
  return false
}

export function constraintsEqual(
  left: MailBindingVisibilityConstraints | null | undefined,
  right: MailBindingVisibilityConstraints | null | undefined,
): boolean {
  const a = left ?? EMPTY_MAIL_BINDING_CONSTRAINTS
  const b = right ?? EMPTY_MAIL_BINDING_CONSTRAINTS
  return (
    (a.assignmentMode ?? 'any') === (b.assignmentMode ?? 'any')
    && sameNumberSet(a.categoryAllowIds, b.categoryAllowIds)
    && sameNumberSet(a.categoryExcludeIds, b.categoryExcludeIds)
    && sameStringSet(a.tagAllowValues, b.tagAllowValues)
    && sameStringSet(a.tagExcludeValues, b.tagExcludeValues)
  )
}

/**
 * True when `candidate` never admits mail that `authority` would hide.
 * Used to block non-admin re-delegation from widening visibility filters.
 */
export function isConstraintsAtLeastAsRestrictive(
  candidate: MailBindingVisibilityConstraints | null | undefined,
  authority: MailBindingVisibilityConstraints | null | undefined,
): boolean {
  if (!hasMailBindingConstraints(authority)) return true
  if (!hasMailBindingConstraints(candidate) || !candidate || !authority) return false

  const authMode = authority.assignmentMode && authority.assignmentMode !== 'any'
    ? authority.assignmentMode
    : null
  const candMode = candidate.assignmentMode && candidate.assignmentMode !== 'any'
    ? candidate.assignmentMode
    : null
  if (authMode && candMode !== authMode) return false

  if (authority.categoryAllowIds.length > 0) {
    if (candidate.categoryAllowIds.length === 0) return false
    if (!isSubsetNumbers(candidate.categoryAllowIds, authority.categoryAllowIds)) return false
  }
  if (!isSubsetNumbers(authority.categoryExcludeIds, candidate.categoryExcludeIds)) return false

  if (authority.tagAllowValues.length > 0) {
    if (candidate.tagAllowValues.length === 0) return false
    if (!isSubsetStrings(candidate.tagAllowValues, authority.tagAllowValues)) return false
  }
  if (!isSubsetStrings(authority.tagExcludeValues, candidate.tagExcludeValues)) return false

  return true
}

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((value) => set.has(value))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((value) => set.has(value))
}

function isSubsetNumbers(subset: readonly number[], of: readonly number[]): boolean {
  const set = new Set(of)
  return subset.every((value) => set.has(value))
}

function isSubsetStrings(subset: readonly string[], of: readonly string[]): boolean {
  const set = new Set(of)
  return subset.every((value) => set.has(value))
}
