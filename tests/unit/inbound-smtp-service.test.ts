/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import * as nodemailer from 'nodemailer';

import {
  createRelayRateLimiter,
  startInboundSmtpService,
  type InboundSmtpService,
  type InboundSmtpServiceOptions,
} from '../../packages/server/src/inbound-smtp-service';
import type {
  SmtpRelayConfig,
  SmtpRelayRoutingAccount,
} from '../../packages/server/src/db/postgres-relay-port';
import type {
  RelaySubmissionInput,
  RelaySubmissionResult,
} from '../../packages/server/src/relay-submission';

jest.setTimeout(20_000);

const WS = '11111111-1111-4111-8111-111111111111';
const RELAY_ID = 'relay-1';
const CREDENTIAL_ID = 'cred-1';
const GOOD_AUTH = { user: 'erp-user', pass: 'relay-secret' };

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'relay-tls');
const TLS_KEY = readFileSync(path.join(FIXTURES_DIR, 'key.pem'));
const TLS_CERT = readFileSync(path.join(FIXTURES_DIR, 'cert.pem'));

// --- Fakes -------------------------------------------------------------------

function routingAccount(): SmtpRelayRoutingAccount {
  return {
    id: 100,
    workspace_id: WS,
    source_sqlite_id: 100,
    display_name: 'Sales',
    email_address: 'sales@acme.test',
    protocol: 'imap',
    smtp_host: 'smtp.acme.test',
    smtp_port: 587,
    smtp_tls: true,
    smtp_username: 'sales-smtp-user',
    smtp_use_imap_auth: false,
    smtp_keytar_account_key: null,
    smtp_password_secret_id: 'secret-sales',
    imap_username: 'sales-imap-user',
    keytar_account_key: null,
    imap_password_secret_id: null,
    oauth_provider: null,
    oauth_refresh_keytar_key: null,
    oauth_refresh_secret_id: null,
  } as unknown as SmtpRelayRoutingAccount;
}

function relayConfig(overrides: Partial<SmtpRelayConfig> = {}): SmtpRelayConfig {
  return {
    trackingMode: 'off',
    trackingSubjectPatterns: null,
    allowHeaderOverride: false,
    maxRecipients: 50,
    maxMessageBytes: 26_214_400,
    rateLimitPerMin: 1_000,
    allowArbitraryRecipients: false,
    followupWorkflowId: null,
    ...overrides,
  };
}

function makeRelayPort(config: SmtpRelayConfig) {
  return {
    verifyCredential: jest.fn(async (input: { username: string; password: string }) => (
      input.username === GOOD_AUTH.user && input.password === GOOD_AUTH.pass
        ? { workspaceId: WS, relayId: RELAY_ID, credentialId: CREDENTIAL_ID }
        : null
    )),
    resolveRoutingAccount: jest.fn(async (input: { fromAddress: string }) => (
      input.fromAddress.toLowerCase() === 'sales@acme.test' ? routingAccount() : null
    )),
    loadRelayConfig: jest.fn(async () => config),
    // Per-message revalidation (relay still enabled AND credential un-revoked).
    // Defaults to the same config; individual tests override to simulate a relay
    // disabled or a credential revoked mid-session.
    revalidateSession: jest.fn(async () => config as SmtpRelayConfig | null),
  };
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

function rfc822(body = '<p>Bitte begleichen Sie die offene Rechnung.</p>'): string {
  return [
    'From: Buchhaltung <sales@acme.test>',
    'To: Kunde <kunde@example.com>',
    'Message-ID: <erp-123@erp.local>',
    'Subject: Rechnung 42',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

// --- Harness -------------------------------------------------------------------

let service: InboundSmtpService | undefined;
const transports: nodemailer.Transporter[] = [];

async function startService(overrides: {
  config?: SmtpRelayConfig;
  submitResult?: RelaySubmissionResult;
  service?: Partial<InboundSmtpServiceOptions>;
} = {}) {
  const config = overrides.config ?? relayConfig();
  const relayPort = makeRelayPort(config);
  const submitRelay = jest.fn(async (_input: RelaySubmissionInput): Promise<RelaySubmissionResult> => (
    overrides.submitResult ?? { ok: true, messageId: 501, tracked: false }
  ));
  service = await startInboundSmtpService({
    relayPort,
    submitRelay,
    bindHost: '127.0.0.1',
    portSubmission: 0,
    portSmtps: 0,
    tlsKey: TLS_KEY,
    tlsCert: TLS_CERT,
    socketTimeoutMs: 5_000,
    log: silentLog,
    ...(overrides.service ?? {}),
  });
  return { relayPort, submitRelay, ports: service.ports };
}

function makeTransport(input: {
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  requireTLS?: boolean;
  ignoreTLS?: boolean;
}): nodemailer.Transporter {
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: input.port,
    secure: input.secure,
    auth: input.auth ?? GOOD_AUTH,
    ...(input.requireTLS === undefined ? {} : { requireTLS: input.requireTLS }),
    ...(input.ignoreTLS === undefined ? {} : { ignoreTLS: input.ignoreTLS }),
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
  });
  transports.push(transport);
  return transport;
}

afterEach(async () => {
  for (const transport of transports.splice(0)) transport.close();
  await service?.stop();
  service = undefined;
});

// --- Tests ---------------------------------------------------------------------

describe('startInboundSmtpService', () => {
  it('relays a message over implicit TLS (465) with valid credentials and allowed From', async () => {
    const { submitRelay, ports } = await startService();
    expect(ports.smtps).toBeGreaterThan(0);
    expect(ports.submission).toBeGreaterThan(0);
    expect(ports.smtps).not.toBe(ports.submission);

    const transport = makeTransport({ port: ports.smtps, secure: true });
    const raw = rfc822();
    const info = await transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com', 'zweiter@example.com'] },
      raw,
    });

    expect(info.response).toMatch(/^250 OK: relayed as 501/);
    expect(info.rejected).toHaveLength(0);
    expect(submitRelay).toHaveBeenCalledTimes(1);
    const input = submitRelay.mock.calls[0]![0] as RelaySubmissionInput;
    expect(input.workspaceId).toBe(WS);
    expect(input.relayId).toBe(RELAY_ID);
    expect(input.credentialId).toBe(CREDENTIAL_ID);
    expect(input.accountId).toBe(100);
    expect(input.envelopeFrom).toBe('sales@acme.test');
    expect(input.recipients).toEqual(['kunde@example.com', 'zweiter@example.com']);
    expect(Buffer.isBuffer(input.rfc822)).toBe(true);
    expect(input.rfc822.toString('utf8')).toContain('Subject: Rechnung 42');
    expect(input.rfc822.toString('utf8')).toContain('offene Rechnung');
  });

  it('rejects a bad password with 535', async () => {
    const { submitRelay, ports } = await startService();
    const transport = makeTransport({
      port: ports.smtps,
      secure: true,
      auth: { user: GOOD_AUTH.user, pass: 'wrong-password' },
    });

    await expect(transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    })).rejects.toMatchObject({ responseCode: 535 });
    expect(submitRelay).not.toHaveBeenCalled();
  });

  it('rejects a disallowed envelope From with 550 at MAIL FROM', async () => {
    const { relayPort, submitRelay, ports } = await startService();
    const transport = makeTransport({ port: ports.smtps, secure: true });

    await expect(transport.sendMail({
      envelope: { from: 'spoofed@evil.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    })).rejects.toMatchObject({ responseCode: 550 });
    expect(relayPort.resolveRoutingAccount).toHaveBeenCalledWith({
      workspaceId: WS,
      relayId: RELAY_ID,
      fromAddress: 'spoofed@evil.test',
    });
    expect(submitRelay).not.toHaveBeenCalled();
  });

  it('rejects with 550 when the relay is disabled or the credential is revoked mid-session', async () => {
    const { relayPort, submitRelay, ports } = await startService();
    // Simulate an admin disabling the relay / revoking this credential AFTER the
    // session already authenticated: revalidateSession now returns null.
    relayPort.revalidateSession.mockResolvedValue(null);
    const transport = makeTransport({ port: ports.smtps, secure: true });

    await expect(transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    })).rejects.toMatchObject({ responseCode: 550 });
    // Revalidation is keyed on the exact credential of the session, not just the relay.
    expect(relayPort.revalidateSession).toHaveBeenCalledWith({
      workspaceId: WS,
      relayId: RELAY_ID,
      credentialId: CREDENTIAL_ID,
    });
    // The routing account is never resolved and nothing is submitted.
    expect(relayPort.resolveRoutingAccount).not.toHaveBeenCalled();
    expect(submitRelay).not.toHaveBeenCalled();
  });

  it('rejects recipients over the relay limit with 452', async () => {
    const { submitRelay, ports } = await startService({
      config: relayConfig({ maxRecipients: 1 }),
    });
    const transport = makeTransport({ port: ports.smtps, secure: true });

    const info = await transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['erster@example.com', 'zweiter@example.com'] },
      raw: rfc822(),
    });

    expect(info.accepted).toEqual(['erster@example.com']);
    expect(info.rejected).toEqual(['zweiter@example.com']);
    const rejectedError = (info as unknown as {
      rejectedErrors?: Array<{ responseCode?: number }>;
    }).rejectedErrors?.[0];
    expect(rejectedError?.responseCode).toBe(452);
    expect(submitRelay).toHaveBeenCalledTimes(1);
    expect((submitRelay.mock.calls[0]![0] as RelaySubmissionInput).recipients)
      .toEqual(['erster@example.com']);
  });

  it('rejects an oversized message with 552', async () => {
    const { submitRelay, ports } = await startService({
      config: relayConfig({ maxMessageBytes: 1_024 }),
    });
    const transport = makeTransport({ port: ports.smtps, secure: true });

    await expect(transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(`<p>${'x'.repeat(8_192)}</p>`),
    })).rejects.toMatchObject({ responseCode: 552 });
    expect(submitRelay).not.toHaveBeenCalled();
  });

  it('relays over STARTTLS on the submission port (587 semantics)', async () => {
    const { submitRelay, ports } = await startService();
    const transport = makeTransport({
      port: ports.submission,
      secure: false,
      requireTLS: true,
    });

    const info = await transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    });

    expect(info.response).toMatch(/^250 OK: relayed as 501/);
    expect(submitRelay).toHaveBeenCalledTimes(1);
  });

  it('does not allow AUTH on the submission port before STARTTLS', async () => {
    const { relayPort, submitRelay, ports } = await startService();
    const transport = makeTransport({
      port: ports.submission,
      secure: false,
      ignoreTLS: true,
    });

    await expect(transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    })).rejects.toBeTruthy();
    expect(relayPort.verifyCredential).not.toHaveBeenCalled();
    expect(submitRelay).not.toHaveBeenCalled();
  });

  it('maps a non-retryable pipeline failure to 550', async () => {
    const { ports } = await startService({
      submitResult: {
        ok: false,
        code: 'from_mismatch',
        message: 'Header-From ist fuer dieses Relay nicht freigegeben',
        retryable: false,
      },
    });
    const transport = makeTransport({ port: ports.smtps, secure: true });

    await expect(transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    })).rejects.toMatchObject({ responseCode: 550 });
  });

  it('maps a retryable pipeline failure to 451', async () => {
    const { ports } = await startService({
      submitResult: {
        ok: false,
        code: 'relay_failed',
        message: 'SMTP upstream\nist gerade nicht erreichbar',
        retryable: true,
      },
    });
    const transport = makeTransport({ port: ports.smtps, secure: true });

    const failure = await transport.sendMail({
      envelope: { from: 'sales@acme.test', to: ['kunde@example.com'] },
      raw: rfc822(),
    }).then(() => null, (error: Error & { responseCode?: number }) => error);

    expect(failure?.responseCode).toBe(451);
    // Multi-line pipeline messages must be collapsed to a single response line.
    expect(failure?.message).toContain('SMTP upstream ist gerade nicht erreichbar');
  });
});

describe('createRelayRateLimiter', () => {
  it('consumes per-minute tokens and refills over time via the injected clock', () => {
    let nowMs = 0;
    const limiter = createRelayRateLimiter(() => nowMs);

    expect(limiter.tryConsume('cred-1', 2)).toBe(true);
    expect(limiter.tryConsume('cred-1', 2)).toBe(true);
    expect(limiter.hasCapacity('cred-1', 2)).toBe(false);
    expect(limiter.tryConsume('cred-1', 2)).toBe(false);

    // Other credentials keep their own bucket.
    expect(limiter.tryConsume('cred-2', 2)).toBe(true);

    // Half a minute refills half the budget (1 of 2 tokens).
    nowMs += 30_000;
    expect(limiter.hasCapacity('cred-1', 2)).toBe(true);
    expect(limiter.tryConsume('cred-1', 2)).toBe(true);
    expect(limiter.tryConsume('cred-1', 2)).toBe(false);

    // A non-positive limit means "unlimited".
    expect(limiter.tryConsume('cred-3', 0)).toBe(true);
  });
});
