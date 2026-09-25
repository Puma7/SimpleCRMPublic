/**
 * Trust rules for `Authentication-Results` header fields (RFC 8601).
 *
 * Any sender can add `Authentication-Results:` lines to a message. RFC 8601 §5
 * therefore lets a reader use only fields whose authserv-id names a server it
 * trusts; the receiving MTA is expected to remove incoming fields that claim its
 * own authserv-id. SimpleCRM trusts exactly one authserv-id per mail account:
 *
 * - the configured value (server: `email_accounts.trusted_authserv_id`), or
 * - by default the domain of the account's incoming mail server (IMAP host, for
 *   POP3 accounts the POP3 host): the host without its first label, e.g.
 *   `imap.example.com` -> `example.com`. The full host is kept when it has only
 *   two labels, is an IP literal, or when the remainder would only be a short
 *   country-code suffix such as `co.uk` or `com.au` (at most three characters
 *   followed by a two-letter TLD).
 *
 * An authserv-id is trusted when it equals that value or is a subdomain of it.
 * Only `Authentication-Results:` fields count; `ARC-Authentication-Results:` is
 * ignored because the ARC chain is not validated here. The topmost trusted field
 * wins (the receiving side prepends), later ones never fill in missing keys.
 */

const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeHostLike(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '') ?? '';
  return normalized.length > 0 ? normalized : null;
}

/** Default trusted authserv-id for an incoming mail server host (see module comment). */
export function defaultTrustedAuthservId(incomingHost: string | null | undefined): string | null {
  const host = normalizeHostLike(incomingHost);
  if (!host) return null;
  if (IPV4_PATTERN.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  if (labels.length < 3) return host;
  const rest = labels.slice(1);
  if (rest.length === 2 && rest[0]!.length <= 3 && rest[1]!.length === 2) return host;
  return rest.join('.');
}

/**
 * Validates a configured authserv-id (a host or domain name). Returns the
 * normalized value, `null` for "use the default", or an error message.
 */
export function normalizeTrustedAuthservIdSetting(
  value: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const normalized = normalizeHostLike(value);
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > 253 || !HOSTNAME_PATTERN.test(normalized)) {
    return { ok: false, message: 'authserv-id muss ein Host- oder Domainname sein (z. B. mx.example.com)' };
  }
  return { ok: true, value: normalized };
}

/** The configured authserv-id when set, otherwise the default for the incoming host. */
export function resolveTrustedAuthservId(input: {
  configured?: string | null;
  incomingHost?: string | null;
}): string | null {
  const configured = normalizeTrustedAuthservIdSetting(input.configured);
  if (configured.ok && configured.value) return configured.value;
  return defaultTrustedAuthservId(input.incomingHost);
}

/** Incoming server of an account: POP3 accounts use the POP3 host (falling back to the IMAP host). */
export function incomingMailHost(account: {
  protocol?: string | null;
  imapHost?: string | null;
  pop3Host?: string | null;
}): string | null {
  const imapHost = account.imapHost?.trim() || null;
  if (account.protocol === 'pop3') return account.pop3Host?.trim() || imapHost;
  return imapHost;
}

/**
 * authserv-id of one `Authentication-Results` field body (the part after the
 * colon): the first token, optionally quoted, before the version or `;`.
 * Returns null when the field has none (e.g. `spf=pass ...` without an id).
 */
export function authservIdOfAuthenticationResults(fieldBody: string): string | null {
  const withoutComments = fieldBody.replace(/^\s*(?:\([^)]*\)\s*)*/, '');
  const match = withoutComments.match(/^"([^"]*)"|^([^\s;()]+)/);
  const token = (match?.[1] ?? match?.[2] ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!token || token.includes('=')) return null;
  return token;
}

export function isTrustedAuthservId(authservId: string | null, trusted: string | null): boolean {
  if (!authservId || !trusted) return false;
  const id = authservId.toLowerCase();
  const base = trusted.toLowerCase();
  return id === base || id.endsWith(`.${base}`);
}

/** Unfolded `Authentication-Results:` field bodies in header order (no ARC variants). */
export function extractAuthenticationResultsFields(rawHeaders: string | null): string[] {
  if (!rawHeaders?.trim()) return [];
  const lines = rawHeaders.replace(/\r\n/g, '\n').split('\n');
  const fields: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (/^Authentication-Results:/i.test(line)) {
      if (current) fields.push(current.trim());
      current = line.replace(/^Authentication-Results:\s*/i, '');
    } else if (current !== null && /^[ \t]/.test(line)) {
      current += ` ${line.trim()}`;
    } else {
      if (current) fields.push(current.trim());
      current = null;
    }
  }
  if (current) fields.push(current.trim());
  return fields;
}

/** Topmost `Authentication-Results` field body whose authserv-id is trusted, or null. */
export function selectTrustedAuthenticationResults(
  rawHeaders: string | null,
  trustedAuthservId: string | null,
): string | null {
  if (!trustedAuthservId) return null;
  for (const field of extractAuthenticationResultsFields(rawHeaders)) {
    if (isTrustedAuthservId(authservIdOfAuthenticationResults(field), trustedAuthservId)) return field;
  }
  return null;
}
