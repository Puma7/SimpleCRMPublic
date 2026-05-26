import {
  extractEmailAddressesFromRecipientField,
  recipientFieldFromJson,
} from './email-recipient-parse';

function addressesFromJson(json: string | null | undefined): string[] {
  const field = recipientFieldFromJson(json);
  return extractEmailAddressesFromRecipientField(field);
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
    to_json?: string | null;
    cc_json?: string | null;
  },
  ownEmails: string[],
): { to: string; cc: string } {
  const own = new Set(ownEmails.map((e) => e.toLowerCase().trim()).filter(Boolean));
  const fromAddrs = addressesFromJson(message.from_json);
  const toAddrs = addressesFromJson(message.to_json);
  const ccAddrs = addressesFromJson(message.cc_json);

  const primary =
    fromAddrs.find((a) => !own.has(a)) ??
    toAddrs.find((a) => !own.has(a)) ??
    fromAddrs[0] ??
    '';

  const ccCandidates = uniquePreserveOrder([...toAddrs, ...ccAddrs]).filter(
    (a) => !own.has(a) && a.toLowerCase() !== primary.toLowerCase(),
  );

  return {
    to: primary,
    cc: ccCandidates.join(', '),
  };
}
