import {
  extractEmailAddressesFromRecipientField,
  recipientFieldFromJson,
} from './email-recipient-parse';

function addressesFromJson(json: string | null | undefined): string[] {
  const field = recipientFieldFromJson(json);
  return extractEmailAddressesFromRecipientField(field);
}

/** Parse Reply-To / List-Post from stored RFC822 headers (best-effort). */
export function replyAddressesFromRawHeaders(rawHeaders: string | null | undefined): string[] {
  if (!rawHeaders?.trim()) return [];
  const out: string[] = [];
  const replyTo = rawHeaders.match(/^Reply-To:\s*(.+)$/im);
  if (replyTo?.[1]) {
    out.push(...extractEmailAddressesFromRecipientField(replyTo[1].trim()));
  }
  const listPost = rawHeaders.match(/^List-Post:\s*<?mailto:([^>\s;]+)>?/im);
  if (listPost?.[1]) {
    out.push(listPost[1].trim());
  }
  return out;
}

function uniquePreserveOrder(addrs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addrs) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Build To/Cc for „Allen antworten“ from an original message. */
export function buildReplyAllRecipients(
  message: {
    from_json: string | null | undefined;
    to_json: string | null | undefined;
    cc_json: string | null | undefined;
    raw_headers?: string | null;
  },
  ownEmails: string[],
): { to: string; cc: string } {
  const own = new Set(ownEmails.map((e) => e.toLowerCase().trim()).filter(Boolean));
  const replyToAddrs = replyAddressesFromRawHeaders(message.raw_headers ?? null);
  const fromAddrs = addressesFromJson(message.from_json);
  const toAddrs = addressesFromJson(message.to_json);
  const ccAddrs = addressesFromJson(message.cc_json);

  const primaryCandidates = [...replyToAddrs, ...fromAddrs];
  const primary =
    primaryCandidates.find((a) => !own.has(a.toLowerCase())) ??
    toAddrs.find((a) => !own.has(a.toLowerCase())) ??
    primaryCandidates[0] ??
    '';

  const ccCandidates = uniquePreserveOrder([...toAddrs, ...ccAddrs]).filter(
    (a) => !own.has(a.toLowerCase()) && a.toLowerCase() !== primary.toLowerCase(),
  );

  return {
    to: primary,
    cc: ccCandidates.join(', '),
  };
}

/** Primary address for a single reply (Reply-To preferred over From). */
export function primaryReplyRecipient(message: {
  from_json: string | null | undefined;
  raw_headers?: string | null;
}): string {
  const replyTo = replyAddressesFromRawHeaders(message.raw_headers ?? null);
  if (replyTo[0]) return replyTo[0];
  return addressesFromJson(message.from_json)[0] ?? '';
}
