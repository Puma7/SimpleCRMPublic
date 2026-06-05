export type ReadReceiptAddressJson = {
  value?: Array<{
    address?: string | null;
  }> | null;
};

export function parseDispositionNotificationTo(rawHeaders: string | null | undefined): string | null {
  if (!rawHeaders) return null;
  const lines = rawHeaders.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const match = line.match(/^Disposition-Notification-To:\s*(.*)/i);
    if (!match) continue;

    let value = match[1]!.trim();
    while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) {
      i += 1;
      value += ` ${lines[i]!.trim()}`;
    }
    return value || null;
  }
  return null;
}

export function domainTrusted(trustedCsv: string | null | undefined, senderDomain: string): boolean {
  if (!trustedCsv?.trim()) return false;
  const normalizedSenderDomain = senderDomain.trim().toLowerCase();
  if (!normalizedSenderDomain) return false;
  return trustedCsv
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedSenderDomain);
}

export function extractDispositionNotificationEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/) ?? value.match(/([\w.+-]+@[\w.-]+\.\w+)/);
  return match ? match[1]!.trim().toLowerCase() : null;
}

export function senderEmailFromAddressJson(fromJson: string | null | undefined): string {
  if (!fromJson) return '';
  try {
    const parsed = JSON.parse(fromJson) as ReadReceiptAddressJson;
    return (parsed.value?.[0]?.address ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function dispositionNotificationMatchesSender(
  dispositionNotificationTo: string | null | undefined,
  fromJson: string | null | undefined,
): boolean {
  const dispositionAddress = extractDispositionNotificationEmail(dispositionNotificationTo);
  const senderAddress = senderEmailFromAddressJson(fromJson);
  if (!dispositionAddress || !senderAddress) return false;
  return dispositionAddress === senderAddress;
}
