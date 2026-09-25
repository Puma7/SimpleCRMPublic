export type SignatureTemplateContext = {
  accountDisplayName?: string | null
  userName?: string | null
  userEmail?: string | null
  userPublicName?: string | null
  customerName?: string | null
  customerFirstName?: string | null
  customerEmail?: string | null
}

/** Resolves account/user placeholders; customer fields stay empty unless provided. */
export function buildSignatureTemplateContext(input: {
  accountDisplayName?: string | null
  accountEmail?: string | null
  teamMemberDisplayName?: string | null
  userPublicName?: string | null
  userDisplayName?: string | null
  customerName?: string | null
  customerFirstName?: string | null
  customerEmail?: string | null
}): SignatureTemplateContext {
  const accountDisplayName = (input.accountDisplayName ?? '').trim()
  const accountEmail = (input.accountEmail ?? '').trim()
  const teamName = (input.teamMemberDisplayName ?? '').trim()
  const userDisplayName = (input.userDisplayName ?? '').trim()
  const userPublicName = (input.userPublicName ?? '').trim()
  // {{user.publicName}} identifies the *sending* user, which only the client
  // knows. When no user context is given (server pre-interpolation, previews),
  // leave the token untouched so a later client pass can fill it — otherwise
  // the account/team name would wrongly win in shared account signatures.
  const hasUserContext = input.userPublicName != null || input.userDisplayName != null
  return {
    accountDisplayName,
    userName: teamName || accountDisplayName || '',
    userEmail: accountEmail,
    userPublicName: hasUserContext
      ? (userPublicName || userDisplayName || teamName || accountDisplayName || '')
      : undefined,
    customerName: input.customerName ?? '',
    customerFirstName: input.customerFirstName ?? '',
    customerEmail: input.customerEmail ?? '',
  }
}

// Platzhalterwerte (Kunden-, Konto-, Nutzernamen) sind Daten, kein Markup:
// escapen, damit sie in der Signatur-HTML weder Tags noch Attribute bilden.
// Eingesetzt per Callback, damit '$&' o. ae. im Wert kein Ersetzungsmuster ist.
function escapeSignatureValue(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function interpolateSignatureTemplate(
  html: string,
  ctx: SignatureTemplateContext,
): string {
  let out = html.replace(/\{\{account\.display_name\}\}/g, () => escapeSignatureValue(ctx.accountDisplayName))
  // Only substitute {{user.publicName}} when a sender context is present;
  // otherwise leave it for a subsequent pass that knows the sending user.
  if (ctx.userPublicName != null) {
    out = out.replace(/\{\{user\.publicName\}\}/g, () => escapeSignatureValue(ctx.userPublicName))
  }
  out = out
    .replace(/\{\{user\.name\}\}/g, () => escapeSignatureValue(ctx.userName))
    .replace(/\{\{user\.email\}\}/g, () => escapeSignatureValue(ctx.userEmail))
  const hasCustomer =
    (ctx.customerName ?? '').trim() ||
    (ctx.customerFirstName ?? '').trim() ||
    (ctx.customerEmail ?? '').trim()
  if (!hasCustomer) return out
  const firstName =
    (ctx.customerFirstName ?? '').trim() ||
    (ctx.customerName ?? '').trim().split(/\s+/)[0] ||
    ''
  return out
    .replace(/\{\{customer\.name\}\}/g, () => escapeSignatureValue(ctx.customerName))
    .replace(/\{\{customer\.firstName\}\}/g, () => escapeSignatureValue(firstName))
    .replace(/\{\{customer\.email\}\}/g, () => escapeSignatureValue(ctx.customerEmail))
}
