import { isIP } from 'node:net';

/**
 * True for IP literals that outbound HTTP (webhooks, workflow HTTP node) must
 * never reach: private, loopback, link-local and other reserved ranges,
 * including IPv6 forms that carry such an IPv4 address. Hostnames (no IP
 * literal) return false; brackets around an IPv6 literal are accepted.
 * Shared by the server and desktop editions so both block the same ranges.
 */
export function isPrivateOrReservedIp(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(value);
  if (kind === 4) return isPrivateOrReservedIpv4(value);
  if (kind === 6) {
    const groups = expandIpv6(value);
    // isIP() accepted it but we can't read the groups → fail safe (block).
    return groups === null || isPrivateOrReservedIpv6(groups);
  }
  return false;
}

function isPrivateOrReservedIpv4(value: string): boolean {
  const [a, b, c] = value.split('.').map((part) => Number.parseInt(part, 10));
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  // IETF protocol assignments (incl. NAT64 discovery 192.0.0.170/171),
  // documentation (TEST-NET-1/2/3), 6to4 relay anycast, benchmarking
  // 198.18.0.0/15, multicast 224/4 and class E incl. broadcast 240/4.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

// Judges the 8 16-bit groups of an IPv6 address. Forms that carry an IPv4
// address the network may translate to (IPv4-mapped, NAT64, 6to4) are judged
// by that embedded IPv4, so e.g. 64:ff9b::a9fe:a9fe cannot reach the metadata
// service through a NAT64 gateway.
function isPrivateOrReservedIpv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embeddedIpv4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeroUpTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:0:0/96 IPv4-mapped.
  if (zeroUpTo5 && g5 === 0xffff) return isPrivateOrReservedIpv4(embeddedIpv4(g6, g7));
  // 64:ff9b::/96 NAT64 well-known prefix.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateOrReservedIpv4(embeddedIpv4(g6, g7));
  }
  // Rest of 0000::/8: ::, ::1, IPv4-compatible (::a.b.c.d), local-use NAT64
  // 64:ff9b:1::/48 and other IETF-reserved space.
  if (g0 < 0x100) return true;
  // 100::/64 discard-only.
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 2001::/32 Teredo (tunnels to arbitrary IPv4) and 2001:db8::/32 documentation.
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true;
  // 2002::/16 6to4 embeds the IPv4 in groups 1-2.
  if (g0 === 0x2002) return isPrivateOrReservedIpv4(embeddedIpv4(g1, g2));
  // fc00::/7 unique-local.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  return g0 >= 0xfe80;
}

function expandIpv6(value: string): number[] | null {
  let text = value.split('%', 1)[0] ?? '';
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const [a, b, c, d] = dotted[1].split('.').map((part) => Number.parseInt(part, 10));
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
