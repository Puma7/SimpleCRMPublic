export type SignatureTemplateContext = {
  accountDisplayName?: string | null
  userName?: string | null
  userEmail?: string | null
  customerName?: string | null
  customerFirstName?: string | null
  customerEmail?: string | null
}

export function interpolateSignatureTemplate(
  html: string,
  ctx: SignatureTemplateContext,
): string {
  const firstName =
    (ctx.customerFirstName ?? '').trim() ||
    (ctx.customerName ?? '').trim().split(/\s+/)[0] ||
    ''
  return html
    .replace(/\{\{account\.display_name\}\}/g, ctx.accountDisplayName ?? '')
    .replace(/\{\{user\.name\}\}/g, ctx.userName ?? '')
    .replace(/\{\{user\.email\}\}/g, ctx.userEmail ?? '')
    .replace(/\{\{customer\.name\}\}/g, ctx.customerName ?? '')
    .replace(/\{\{customer\.firstName\}\}/g, firstName)
    .replace(/\{\{customer\.email\}\}/g, ctx.customerEmail ?? '')
}
