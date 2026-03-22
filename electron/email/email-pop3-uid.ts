import crypto from 'crypto';

/**
 * Stable synthetic UID for POP3 rows (disjoint from typical IMAP UIDs and from draft negatives).
 * Same UIDL always maps to the same integer.
 */
export function pop3SyntheticUid(uidl: string): number {
  const h = crypto.createHash('sha256').update(uidl, 'utf8').digest();
  const n = h.readUInt32BE(0) ^ h.readUInt32BE(4) ^ h.readUInt32BE(8);
  // Keep in 1..999_999_999 to stay well below 2^31 and avoid clashing with drafts.
  return 1 + (n % 999_999_999);
}
