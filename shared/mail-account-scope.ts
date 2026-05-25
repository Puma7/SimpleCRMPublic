/** Postfach-Kontext: ein Konto oder alle Konten (Shared Inbox). */
export type MailAccountScope = number | 'all'

export function isAllAccountsScope(
  scope: MailAccountScope | null | undefined,
): scope is 'all' {
  return scope === 'all'
}

export function scopeRequiresAccountId(scope: MailAccountScope | null): scope is number {
  return typeof scope === 'number' && Number.isFinite(scope)
}

/** Konto für Entwurf/Senden bei Shared Inbox („Alle Konten“). */
export function resolveComposeAccountId(
  scope: MailAccountScope | null,
  opts: { messageAccountId?: number; firstAccountId?: number },
): number | null {
  if (opts.messageAccountId != null) return opts.messageAccountId
  if (scope === 'all') return opts.firstAccountId ?? null
  if (typeof scope === 'number') return scope
  return null
}
