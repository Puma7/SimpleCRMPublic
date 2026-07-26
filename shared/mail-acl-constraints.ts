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

/**
 * Sentinel values that never match real categories/tags. Used when intersecting
 * two non-empty allowlists yields an empty set — otherwise `[]` would mean
 * "no filter" and incorrectly widen access.
 */
export const DENY_ALL_CATEGORY_ALLOW_ID = -1
export const DENY_ALL_TAG_ALLOW_VALUE = '\u0000deny_all'

export const DENY_ALL_MAIL_BINDING_CONSTRAINTS: MailBindingVisibilityConstraints = Object.freeze({
  assignmentMode: null,
  categoryAllowIds: Object.freeze([DENY_ALL_CATEGORY_ALLOW_ID] as number[]),
  categoryExcludeIds: Object.freeze([] as number[]),
  tagAllowValues: Object.freeze([DENY_ALL_TAG_ALLOW_VALUE] as string[]),
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

/**
 * Intersect two authority constraint sets. Empty allowlist intersection must
 * stay deny-all (never collapse to "no filter").
 */
export function mergeAuthorityConstraints(
  left: MailBindingVisibilityConstraints | null,
  right: MailBindingVisibilityConstraints,
): MailBindingVisibilityConstraints {
  if (!left) return right
  const leftMode = left.assignmentMode && left.assignmentMode !== 'any' ? left.assignmentMode : null
  const rightMode = right.assignmentMode && right.assignmentMode !== 'any' ? right.assignmentMode : null
  const assignmentMode = leftMode ?? rightMode
  const categoryAllowIds = intersectAllowNumbers(left.categoryAllowIds, right.categoryAllowIds)
  const categoryExcludeIds = [...new Set([...left.categoryExcludeIds, ...right.categoryExcludeIds])].sort((a, b) => a - b)
  const tagAllowValues = intersectAllowStrings(left.tagAllowValues, right.tagAllowValues)
  const tagExcludeValues = [...new Set([...left.tagExcludeValues, ...right.tagExcludeValues])].sort()
  return {
    assignmentMode,
    categoryAllowIds,
    categoryExcludeIds,
    tagAllowValues,
    tagExcludeValues,
  }
}

function intersectAllowNumbers(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  if (left.length > 0 && right.length > 0) {
    const intersection = left.filter((id) => right.includes(id))
    return intersection.length > 0
      ? [...intersection].sort((a, b) => a - b)
      : [DENY_ALL_CATEGORY_ALLOW_ID]
  }
  if (left.length > 0) return [...left].sort((a, b) => a - b)
  if (right.length > 0) return [...right].sort((a, b) => a - b)
  return []
}

function intersectAllowStrings(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  if (left.length > 0 && right.length > 0) {
    const intersection = left.filter((tag) => right.includes(tag))
    return intersection.length > 0
      ? [...intersection].sort()
      : [DENY_ALL_TAG_ALLOW_VALUE]
  }
  if (left.length > 0) return [...left].sort()
  if (right.length > 0) return [...right].sort()
  return []
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
