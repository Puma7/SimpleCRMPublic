import { isIP } from 'node:net';

/**
 * Collapses a client address to the unit an attacker gets cheaply for
 * in-process rate limits: IPv4 stays per address, IPv6 is grouped per /64
 * (one end-site subnet), so rotating interface identifiers inside a /64 does
 * not mint fresh buckets. IPv4-mapped IPv6 addresses count as their IPv4
 * address. Unparseable input is returned lower-cased so it still gets a
 * stable bucket.
 */
export function rateLimitClientKey(ip: string | null | undefined): string {
  const value = ip?.trim().toLowerCase() ?? '';
  if (!value) return 'unknown';
  const address = value.split('%')[0]!;
  if (isIP(address) === 4) return address;
  const hextets = ipv6Hextets(address);
  if (!hextets) return value;
  if (hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff) {
    return `${hextets[6]! >>> 8}.${hextets[6]! & 0xff}.${hextets[7]! >>> 8}.${hextets[7]! & 0xff}`;
  }
  return `${hextets.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
}

function ipv6Hextets(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  const dottedTail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  let normalized = address;
  if (dottedTail) {
    if (isIP(dottedTail[2]!) !== 4) return null;
    const octets = dottedTail[2]!.split('.').map(Number);
    normalized = `${dottedTail[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = splitHextets(halves[0]!);
  const right = splitHextets(halves[1] ?? '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing > 0 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function splitHextets(value: string): number[] | null {
  if (!value) return [];
  const parts = value.split(':');
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}
