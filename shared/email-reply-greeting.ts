export type ReplyGreetingCustomer = {
  salutation?: string | null
  name?: string | null
  firstName?: string | null
}

export type ReplyGreetingFromAddress = {
  name?: string | null
  address?: string | null
}

function parseFromName(fromJson: string | null | undefined): string | null {
  if (!fromJson?.trim()) return null
  try {
    const parsed = JSON.parse(fromJson) as {
      value?: { name?: string; address?: string }[]
      name?: string
      address?: string
    }
    const v = parsed?.value?.[0]
    const name = v?.name?.trim() || parsed?.name?.trim()
    return name || null
  } catch {
    return null
  }
}

function lastNameFromFullName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1]! : parts[0] ?? name
}

function greetingFromSalutation(salutation: string, lastName: string): string | null {
  const s = salutation.trim()
  const ln = lastName.trim()
  if (!ln) return null
  const lower = s.toLowerCase()
  if (lower.includes('herr')) return `Sehr geehrter Herr ${ln},`
  if (lower.includes('frau')) return `Sehr geehrte Frau ${ln},`
  if (s) return `Guten Tag ${s} ${ln},`.replace(/\s+/g, ' ')
  return null
}

/** Plain-text greeting line for reply compose (German). */
export function buildReplyGreeting(input: {
  customer?: ReplyGreetingCustomer | null
  fromJson?: string | null
}): string {
  const customer = input.customer
  if (customer) {
    const lastName =
      (customer.name?.trim() ? lastNameFromFullName(customer.name) : '') ||
      customer.firstName?.trim() ||
      ''
    if (customer.salutation?.trim() && lastName) {
      const fromSal = greetingFromSalutation(customer.salutation, lastName)
      if (fromSal) return fromSal
    }
    if (customer.name?.trim()) {
      return `Guten Tag ${customer.name.trim()},`
    }
    if (customer.firstName?.trim()) {
      return `Guten Tag ${customer.firstName.trim()},`
    }
  }
  const fromName = parseFromName(input.fromJson)
  if (fromName) {
    const last = lastNameFromFullName(fromName)
    const lower = fromName.toLowerCase()
    if (lower.includes('herr')) return `Sehr geehrter Herr ${last},`
    if (lower.includes('frau')) return `Sehr geehrte Frau ${last},`
    return `Guten Tag ${fromName},`
  }
  return 'Guten Tag,'
}

export function replyGreetingPlainToHtml(greeting: string): string {
  const trimmed = greeting.trim()
  if (!trimmed) return ''
  return `<p>${trimmed}</p>`
}

/** Avoid duplicating greeting when AI draft already starts with one. */
export function aiDraftLikelyIncludesGreeting(text: string): boolean {
  const t = text.trim().toLowerCase()
  return (
    t.startsWith('sehr geehrte') ||
    t.startsWith('sehr geehrter') ||
    t.startsWith('guten tag') ||
    t.startsWith('hallo') ||
    t.startsWith('liebe') ||
    t.startsWith('lieber')
  )
}
