export type SignatureTemplateContext = {
  accountDisplayName?: string | null
  userName?: string | null
  userEmail?: string | null
  customerName?: string | null
  customerFirstName?: string | null
  customerEmail?: string | null
}

/** Resolves account/user placeholders; customer fields stay empty unless provided. */
export function buildSignatureTemplateContext(input: {
  accountDisplayName?: string | null
  accountEmail?: string | null
  teamMemberDisplayName?: string | null
  customerName?: string | null
  customerFirstName?: string | null
  customerEmail?: string | null
}): SignatureTemplateContext {
  const accountDisplayName = (input.accountDisplayName ?? '').trim()
  const accountEmail = (input.accountEmail ?? '').trim()
  const teamName = (input.teamMemberDisplayName ?? '').trim()
  return {
    accountDisplayName,
    userName: teamName || accountDisplayName || '',
    userEmail: accountEmail,
    customerName: input.customerName ?? '',
    customerFirstName: input.customerFirstName ?? '',
    customerEmail: input.customerEmail ?? '',
  }
}

export function interpolateSignatureTemplate(
  html: string,
  ctx: SignatureTemplateContext,
): string {
  let out = html
    .replace(/\{\{account\.display_name\}\}/g, ctx.accountDisplayName ?? '')
    .replace(/\{\{user\.name\}\}/g, ctx.userName ?? '')
    .replace(/\{\{user\.email\}\}/g, ctx.userEmail ?? '')
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
    .replace(/\{\{customer\.name\}\}/g, ctx.customerName ?? '')
    .replace(/\{\{customer\.firstName\}\}/g, firstName)
    .replace(/\{\{customer\.email\}\}/g, ctx.customerEmail ?? '')
}
