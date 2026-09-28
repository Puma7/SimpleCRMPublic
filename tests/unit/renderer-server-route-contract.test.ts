/**
 * @jest-environment node
 */
/**
 * Vertragstest: Jede HTTP-Zuordnung des Renderer-Transports (Server-Edition)
 * trifft eine Route, die der Server tatsächlich bedient. Die Anfrage geht
 * durch den echten Dispatcher (`createServerApi().handle`), über den im
 * Fastify-Adapter alle HTTP-Routen laufen. Gezählt wird nur „Route/Methode
 * gibt es nicht“ (404 `not_found` bzw. 405 `method_not_allowed`); jede andere
 * Antwort oder ein erreichter Port heißt: ein Handler hat die Anfrage angenommen.
 */
import { AllowedInvokeChannels, IPCChannels, type InvokeChannel } from '../../shared/ipc/channels';
import { buildHttpInvocation, hasHttpInvocation, type HttpInvocationSpec } from '../../src/services/transport/channel-http-registry';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type { HttpMethod, ServerApiPorts } from '../../packages/server/src/api/types';
import { throwingPorts } from '../setup/server-api-probe';
import { HTTP_TRANSPORT_UNSUPPORTED_CHANNELS } from '../setup/http-transport-unsupported-channels';

const PRINCIPAL = {
  userId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  role: 'owner',
  sessionId: 's-contract',
} as const;

type Outcome = 'routed' | 'no_route' | 'no_method';
type ProbeSpec = { method: HttpMethod; path: string; query?: Record<string, unknown>; body?: unknown };

const api = createServerApi(throwingPorts() as ServerApiPorts);

async function probe(spec: ProbeSpec): Promise<Outcome> {
  // URL genau wie buildUrl() im Client bauen, dann wie der Fastify-Adapter zerlegen.
  const url = new URL(`https://crm.example.com${spec.path.startsWith('/') ? spec.path : `/${spec.path}`}`);
  for (const [key, value] of Object.entries(spec.query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  try {
    const res = await api.handle({
      method: spec.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: spec.body ?? {},
      headers: {},
      ip: '203.0.113.9',
      principal: { ...PRINCIPAL },
    } as never);
    const code = (res.body as { error?: { code?: unknown } } | undefined)?.error?.code;
    if (res.status === 404 && code === 'not_found') return 'no_route';
    if (res.status === 405 && code === 'method_not_allowed') return 'no_method';
    return 'routed';
  } catch {
    // PORT_REACHED oder ein Handler-Fehler: ein Handler hat die Anfrage angenommen.
    return 'routed';
  }
}

/** Feste Beispielwerte für Felder mit Formatvorgaben (Aufzählungen, Text-IDs, JSON). */
const SAMPLE_FIELDS: Record<string, unknown> = {
  archived: true,
  spam: true,
  done: true,
  seen: true,
  view: 'inbox',
  spamStatus: 'clean',
  status: 'clean',
  action: 'send',
  policy: 'blocked',
  direction: 'up',
  resourceType: 'account',
  resource: { type: 'account', id: 1, accountId: 1 },
  subjectType: 'user',
  imapHost: 'imap.example.com',
  smtpHost: 'smtp.example.com',
  pop3Host: 'pop3.example.com',
  host: 'mail.example.com',
  to: 'kunde@example.com',
  trustedAuthservId: 'mx.example.com',
  definitionJson: '{"version":1,"rules":[]}',
  secret: 'sample-secret',
  noticeId: 'notice-1',
  threadId: 'thread-1',
  aliasThreadId: 'thread-2',
  relayId: 'relay-1',
  teamMemberId: 'member-1',
  updates: [{ id: 1, parentId: null, sortOrder: 0 }],
  body: 'Notiz',
  tag: 'wichtig',
  html: '<p>Gruß</p>',
  signatureHtml: '<p>Gruß</p>',
  expectedCount: 1,
  pattern: 'spam@example.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  code: 'auth-code',
  content: '# Wissen\n\nText',
  currentPassword: 'Altes-Passwort-1!',
  newPassword: 'Neues-Passwort-1!',
  password: 'Passwort-123!',
  passphrase: 'Geheime-Passphrase-1',
  currentPassphrase: 'Alte-Passphrase-1',
  newPassphrase: 'Neue-Passphrase-1',
  armored: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nx\n-----END PGP PUBLIC KEY BLOCK-----',
  recipientEmails: ['kunde@example.com'],
  products: [{ kArtikel: 1, nAnzahl: 1 }],
  imapPort: 993,
  imapTls: true,
  port: 587,
  nextWeekWeekday: 1,
  smtpPort: 587,
  pop3Port: 995,
  pgpUserId: 'Kunde <kunde@example.com>',
  eveningMinute: 0,
  morningMinute: 0,
  confirmPhrase: 'ARCHIV',
  credentialId: 'credential-1',
  canonicalThreadId: 'thread-1',
  nextPassphrase: 'Naechste-Passphrase-1',
  eveningHour: 18,
  morningHour: 8,
  role: 'user',
};

/** Beispiel-Nutzlast: liefert je nach Feldname eine plausible Angabe. */
const samplePayload: Record<string, unknown> = new Proxy({}, {
  get(_target, key) {
    if (typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
    if (Object.prototype.hasOwnProperty.call(SAMPLE_FIELDS, key)) return SAMPLE_FIELDS[key];
    if (/Ids$/.test(key)) return [1];
    if (/^id$|Id$/.test(key)) return 1;
    if (/email/i.test(key)) return 'kontakt@example.com';
    if (/token|key|name|query|search|subject|text|folder|uri|url|value|label|title/i.test(key)) return 'sample';
    return undefined;
  },
});

const CANDIDATE_ARGS: unknown[][] = [[], [1], [samplePayload], ['sample'], [1, samplePayload], [samplePayload, samplePayload]];

const IMPORT_BUNDLE_JSON = JSON.stringify({
  version: 1,
  exportedAt: '2026-06-03T12:00:00.000Z',
  workflow: {
    name: 'Import',
    trigger: 'manual',
    priority: 5,
    enabled: false,
    definition_json: '{"version":1,"rules":[]}',
    graph_json: null,
    cron_expr: null,
    schedule_account_id: null,
    execution_mode: 'graph',
    engine_version: 1,
  },
});

/** Kanäle, für die die Standard-Argumente keine Anfrage bauen (Werte wie in renderer-transport.test.ts). */
const SAMPLE_ARGS: Partial<Record<InvokeChannel, unknown[]>> = {
  [IPCChannels.Email.CreateWorkflow]: [{
    name: 'Eingang', trigger: 'inbound', priority: 100, definitionJson: '{"version":1,"rules":[]}', enabled: true,
  }],
  [IPCChannels.Email.FireWebhookWorkflow]: [{ secret: 'secret-1', body: { test: true } }],
  [IPCChannels.Email.SaveTeamMember]: [{ id: 'agent-2', displayName: 'Agent Two', signatureHtml: null }],
  [IPCChannels.Email.ImportWorkflowBundle]: [{ json: IMPORT_BUNDLE_JSON }],
  [IPCChannels.Auth.SaveUser]: [{ username: 'agent@example.com', displayName: 'Agent', role: 'agent', passphrase: 'agent-passphrase-1' }],
  [IPCChannels.Auth.CreateInvite]: [{ username: 'agent@example.com', displayName: 'Agent', role: 'agent', expiresInDays: 7 }],
  [IPCChannels.Auth.DeleteUser]: [{ id: 'auth-user-2' }],
  [IPCChannels.Email.TestSmtp]: [{ host: 'smtp.example.com', port: 587, secure: false, user: 'service' }],
  [IPCChannels.Email.TestPop3]: [{ host: 'pop3.example.com', port: 995, tls: true, user: 'service' }],
  [IPCChannels.Email.SetSnoozeSettings]: [{
    eveningHour: 18, eveningMinute: 0, morningHour: 8, morningMinute: 0, nextWeekWeekday: 1, nextWeekHour: 8, nextWeekMinute: 0,
  }],
  [IPCChannels.Jtl.CreateOrder]: [{
    simpleCrmCustomerId: 1, kFirma: 1, kWarenlager: 1, kZahlungsart: 1, kVersandart: 1,
    products: [{ kArtikel: 1, nAnzahl: 1, fPreis: 10 }],
  }],
};

/**
 * Zuordnungen, die im Servermodus bewusst eine Fehlermeldung werfen statt eine
 * Anfrage zu bauen (Grund steht in der Meldung des Builders).
 */
const REJECTED_IN_SERVER_MODE: ReadonlySet<string> = new Set([
  // Software-Updates laufen im Servermodus über Docker/Compose (simplecrm update).
  IPCChannels.Maintenance.CheckForUpdates,
  IPCChannels.Maintenance.InstallUpdate,
]);

/**
 * Bekannte Lücken: Kanal → Grund. `desktop-only:` = Zuordnung nur der
 * Vollständigkeit halber, der Server hat bewusst keine Route. `BUG:` = die
 * Zuordnung oder die Server-Route ist falsch.
 */
const KNOWN_ROUTE_GAPS: Readonly<Record<string, string>> = {};

function specFor(channel: InvokeChannel): HttpInvocationSpec | null {
  const lists = SAMPLE_ARGS[channel] ? [SAMPLE_ARGS[channel]!] : CANDIDATE_ARGS;
  for (const args of lists) {
    try {
      return buildHttpInvocation(channel, args);
    } catch {
      // nächste Kandidaten-Argumente
    }
  }
  return null;
}

describe('Renderer-HTTP-Zuordnung gegen Server-Routen', () => {
  describe('Detektor', () => {
    test('unbekannte Route', async () => {
      expect(await probe({ method: 'GET', path: '/api/v1/definitely-not-a-route' })).toBe('no_route');
    });
    test('unbekannter Unterpfad eines Moduls', async () => {
      expect(await probe({ method: 'GET', path: '/api/v1/dashboard/stats-zzz' })).toBe('no_route');
    });
    test('falsche Methode', async () => {
      expect(await probe({ method: 'DELETE', path: '/api/v1/dashboard/stats' })).toBe('no_method');
    });
    test('bestehende Route', async () => {
      expect(await probe({ method: 'GET', path: '/api/v1/dashboard/stats' })).toBe('routed');
    });
  });

  const mapped = AllowedInvokeChannels.filter((channel) => !HTTP_TRANSPORT_UNSUPPORTED_CHANNELS.has(channel)
    && !REJECTED_IN_SERVER_MODE.has(channel));

  test('jede zugeordnete Anfrage lässt sich bauen', () => {
    expect(mapped.length).toBeGreaterThan(300);
    expect(mapped.every((channel) => hasHttpInvocation(channel))).toBe(true);
    const unbuildable = mapped.filter((channel) => specFor(channel) === null);
    expect(unbuildable).toEqual([]);
  });

  test('jede zugeordnete Anfrage trifft eine Server-Route; bekannte Lücken bleiben aktuell', async () => {
    const failures: { channel: string; method: string; path: string; outcome: Outcome }[] = [];
    for (const channel of mapped) {
      const spec = specFor(channel);
      if (!spec) continue;
      const outcome = await probe(spec as ProbeSpec);
      if (outcome !== 'routed') failures.push({ channel, method: spec.method, path: spec.path, outcome });
    }
    const unexpected = failures.filter((failure) => !(failure.channel in KNOWN_ROUTE_GAPS));
    expect(unexpected.map((f) => `${f.channel}: ${f.method} ${f.path} (${f.outcome})`)).toEqual([]);
    const stale = Object.keys(KNOWN_ROUTE_GAPS).filter((channel) => !failures.some((f) => f.channel === channel));
    expect(stale).toEqual([]);
  });
});
