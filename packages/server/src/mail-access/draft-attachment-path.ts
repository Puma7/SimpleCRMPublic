/**
 * True only for a file directly inside this draft's own upload folder:
 * `<workspaceId>/compose-drafts/<draftId>/<exactly one segment>`. Such an upload
 * has no attachment row, so the send enforcers let the draft's mail.draft.edit
 * cover it instead of mail.attachment.read.
 *
 * The attachment sink resolves the stored path with the host's native path
 * rules, so a raw prefix check is not enough: on Windows `\` is a separator and
 * `..\..\<other workspace>\…` would escape the folder while passing a
 * `split('/')` check. Server-generated upload keys are always '/'-joined with a
 * sanitized file name, so anything that is not a plain single segment falls
 * back to the regular attachment ownership check.
 */
export function isDraftLocalAttachmentPath(
  storagePath: string,
  workspaceId: string,
  draftId: number | string,
): boolean {
  const prefix = `${workspaceId}/compose-drafts/${draftId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  const segment = storagePath.slice(prefix.length);
  return segment !== ''
    && segment !== '.'
    && segment !== '..'
    && !/[/\\:\0]/.test(segment);
}
