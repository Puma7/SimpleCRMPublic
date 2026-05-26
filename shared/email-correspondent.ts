/** Parse first mailbox from stored address JSON (`{ value: [{ address, name? }] }`). */
export function firstAddressFromJson(json: string | null): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { value?: { address?: string }[] };
    return (parsed?.value?.[0]?.address ?? '').trim();
  } catch {
    return '';
  }
}

/** Counterparty e-mail for history (inbound: From, sent: To). */
export function correspondentEmailForMessage(row: {
  from_json: string | null;
  to_json: string | null;
  folder_kind?: string | null;
}): string | null {
  const from = firstAddressFromJson(row.from_json);
  const to = firstAddressFromJson(row.to_json);
  let pick = '';
  if (row.folder_kind === 'sent') {
    pick = to || from;
  } else if (row.folder_kind === 'draft') {
    pick = to || from;
  } else {
    pick = from || to;
  }
  const normalized = pick.trim().toLowerCase();
  return normalized.includes('@') ? normalized : null;
}
