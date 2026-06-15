export function scheduledSendDraftIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const value = payload.draftId;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value);
  }
  return undefined;
}

export function scheduledSendJobKey(workspaceId: string, draftId: number | string): string | undefined {
  const workspaceKey = String(workspaceId).trim();
  const draftKey = String(draftId).trim();
  if (!workspaceKey || !draftKey) return undefined;
  return `mail.send.scheduled:${workspaceKey}:${draftKey}`;
}
