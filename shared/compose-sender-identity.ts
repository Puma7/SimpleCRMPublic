export type ComposeTeamMemberIdentity = {
  id: string
  display_name: string
}

export function resolveComposeTeamMemberId(
  members: ComposeTeamMemberIdentity[],
  input: {
    assignedTo?: string | null
    userId?: string | null
    username?: string | null
    displayName?: string | null
  },
): string | null {
  if (members.length === 0) return null

  const findById = (value?: string | null) => {
    const normalized = value?.trim().toLocaleLowerCase()
    return normalized
      ? members.find((member) => member.id.trim().toLocaleLowerCase() === normalized)
      : undefined
  }
  const assigned = findById(input.assignedTo)
  if (assigned) return assigned.id

  const authenticated = findById(input.userId) ?? findById(input.username)
  if (authenticated) return authenticated.id

  const displayName = input.displayName?.trim().toLocaleLowerCase()
  const byDisplayName = displayName
    ? members.find((member) => member.display_name.trim().toLocaleLowerCase() === displayName)
    : undefined
  return byDisplayName?.id ?? members[0]!.id
}
