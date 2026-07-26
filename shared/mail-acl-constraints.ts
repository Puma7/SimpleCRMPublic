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
