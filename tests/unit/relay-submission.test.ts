/**
 * @jest-environment node
 */
import { normalizeEmailAddress } from '@simplecrm/core';

import {
  createRelaySubmissionPipeline,
  parseRelayTrackingHeaderOverride,
  stripSimplecrmHeaders,
  type RelaySubmissionPersistInput,
  type RelaySubmissionStore,
} from '../../packages/server/src/relay-submission';
import type {
  SmtpRelayConfig,
  SmtpRelayRoutingAccount,
} from '../../packages/server/src/db/postgres-relay-port';
import type { ServerSmtpSendInput } from '../../packages/server/src/mail-smtp-send';

const WS = '11111111-1111-4111-8111-111111111111';
const TRACK_MARKER = '<img src="https://track.example/open.png" alt=""';

// --- Fixtures ----------------------------------------------------------------

function routingAccount(overrides: Partial<Record<string, unknown>> = {}): SmtpRelayRoutingAccount {
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
    ...overrides,
  } as unknown as SmtpRelayRoutingAccount;
}

function relayConfig(overrides: Partial<SmtpRelayConfig> = {}): SmtpRelayConfig {
  return {
    trackingMode: 'rule',
    trackingSubjectPatterns: 'Mahnung',
    allowHeaderOverride: true,
    maxRecipients: 50,
    maxMessageBytes: 26_214_400,
    rateLimitPerMin: 60,
    allowArbitraryRecipients: false,
    followupWorkflowId: 7,
    ...overrides,
  };
}

function erpMessage(input: {
  from?: string;
  to?: string | null;
  subject?: string;
  messageId?: string | null;
  extraHeaders?: readonly string[];
  body?: string;
} = {}): Buffer {
  const lines = [
    `From: ${input.from ?? 'Buchhaltung <sales@acme.test>'}`,
    ...(input.to === null ? [] : [`To: ${input.to ?? 'Kunde <kunde@example.com>'}`]),
    ...(input.messageId === null ? [] : [`Message-ID: ${input.messageId ?? '<erp-123@erp.local>'}`]),
    `Subject: ${input.subject ?? 'Mahnung 2'}`,
    ...(input.extraHeaders ?? []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    input.body ?? '<p>Sehr geehrter Kunde, bitte begleichen Sie die offene Rechnung.</p>',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

// --- Fakes ---------------------------------------------------------------------

type FakeSubmission = {
  submissionId: string;
  messageId: number;
  status: 'received' | 'relayed' | 'failed';
  smtpMessageIdHeader: string | null;
  dedupKey: string | null;
  trackingApplied: boolean;
  trackingRuleReason: string | null;
  recipientCount: number;
  errorText: string | null;
};

function makeStore() {
  const submissions: FakeSubmission[] = [];
  const persistInputs: RelaySubmissionPersistInput[] = [];
  let nextMessageId = 500;
  const store: RelaySubmissionStore = {
    persistMessage: jest.fn(async (input: RelaySubmissionPersistInput) => {
      persistInputs.push(input);
      const existing = submissions.find(
        (submission) => input.dedupKey !== null
          && submission.dedupKey === input.dedupKey,
      );
      if (existing?.status === 'relayed') {
        return { alreadyRelayed: true as const, messageId: existing.messageId };
      }
      if (existing) {
        existing.status = 'received';
        existing.smtpMessageIdHeader = input.messageIdHeader;
        existing.trackingApplied = input.trackingApplied;
        existing.trackingRuleReason = input.trackingRuleReason;
        existing.recipientCount = input.recipientCount;
        existing.errorText = null;
        return {
          alreadyRelayed: false as const,
          messageId: existing.messageId,
          submissionId: existing.submissionId,
        };
      }
      const messageId = nextMessageId;
      nextMessageId += 1;
      const submission: FakeSubmission = {
        submissionId: `sub-${messageId}`,
        messageId,
        status: 'received',
        smtpMessageIdHeader: input.messageIdHeader,
        dedupKey: input.dedupKey,
        trackingApplied: input.trackingApplied,
        trackingRuleReason: input.trackingRuleReason,
        recipientCount: input.recipientCount,
        errorText: null,
      };
      submissions.push(submission);
      return {
        alreadyRelayed: false as const,
        messageId,
        submissionId: submission.submissionId,
      };
    }),
    updateSubmission: jest.fn(async (input: {
      workspaceId: string;
      submissionId: string;
      status: 'relayed' | 'failed';
      trackingApplied: boolean;
      errorText: string | null;
    }) => {
      const submission = submissions.find((s) => s.submissionId === input.submissionId);
      if (!submission) throw new Error(`unknown submission ${input.submissionId}`);
      submission.status = input.status;
      submission.trackingApplied = input.trackingApplied;
      submission.errorText = input.errorText;
    }),
    enqueueFollowup: jest.fn(async () => ({ runId: 900 })),
    getSyncInfo: jest.fn(async (input: { workspaceId: string; keys: readonly string[] }) => {
      return new Map<string, string | null>(input.keys.map((key) => [key, null]));
    }),
  };
  return { store, submissions, persistInputs };
}

function makeRelayPort(input: {
  accounts?: readonly SmtpRelayRoutingAccount[];
  config?: SmtpRelayConfig | null;
} = {}) {
  const accounts = input.accounts ?? [routingAccount()];
  const config = input.config === undefined ? relayConfig() : input.config;
  return {
    resolveRoutingAccount: jest.fn(async (query: { fromAddress: string }) => {
      const target = normalizeEmailAddress(query.fromAddress);
      return accounts.find(
        (account) => normalizeEmailAddress(String(account.email_address)) === target,
      ) ?? null;
    }),
    loadRelayConfig: jest.fn(async () => config),
  };
}

function makeTracking() {
  return {
    prepareOutbound: jest.fn(async (input: { html: string | null }) => ({
      html: `${input.html ?? ''}${TRACK_MARKER}>`,
      trackingMessageId: 'tm-1',
      warning: null,
    })),
    recordSending: jest.fn(async () => undefined),
    recordSmtpAccepted: jest.fn(async () => undefined),
    recordSmtpFailed: jest.fn(async () => undefined),
  };
}

function makePipeline(overrides: {
  relayPort?: ReturnType<typeof makeRelayPort>;
  tracking?: ReturnType<typeof makeTracking> | null;
  smtpSend?: jest.Mock;
  sentCopyAppend?: jest.Mock;
  readSecret?: (input: unknown) => Promise<Buffer | null>;
} = {}) {
  const { store, submissions, persistInputs } = makeStore();
  const relayPort = overrides.relayPort ?? makeRelayPort();
  const tracking = overrides.tracking === undefined ? makeTracking() : overrides.tracking;
  const smtpSend = overrides.smtpSend
    ?? jest.fn(async (_input: ServerSmtpSendInput) => undefined);
  const sentCopyAppend = overrides.sentCopyAppend
    ?? jest.fn(async () => ({ ok: true as const, mailbox: 'Sent' }));
  const pipeline = createRelaySubmissionPipeline({
    store,
    relayPort,
    emailTracking: tracking,
    smtpSend: smtpSend as unknown as (input: ServerSmtpSendInput) => Promise<void>,
    sentCopyAppender: { append: sentCopyAppend as never },
    readSecret: (overrides.readSecret ?? (async () => Buffer.from('relay-smtp-pass', 'utf8'))) as never,
    now: () => new Date('2026-07-16T09:00:00.000Z'),
    log: () => undefined,
  });
  return { pipeline, store, submissions, persistInputs, relayPort, tracking, smtpSend, sentCopyAppend };
}

function submitInput(rfc822: Buffer, overrides: Partial<{
  workspaceId: string;
  relayId: string;
  credentialId: string;
  accountId: number;
  envelopeFrom: string;
  recipients: string[];
}> = {}) {
  return {
    workspaceId: WS,
    relayId: 'relay-1',
    credentialId: 'cred-1',
    envelopeFrom: 'sales@acme.test',
    recipients: ['kunde@example.com'],
    rfc822,
    ...overrides,
  };
}

function capturedRfc822(smtpSend: jest.Mock): string {
  expect(smtpSend).toHaveBeenCalledTimes(1);
  // The pipeline now hands sendSmtpMessage a Buffer (byte-preserving pass-
  // through). Decode via latin1 (1:1 byte<->char) so string assertions on the
  // ASCII envelope/headers keep working AND byte-for-byte comparisons hold.
  const rfc822 = (smtpSend.mock.calls[0]![0] as ServerSmtpSendInput).rfc822;
  return Buffer.isBuffer(rfc822) ? rfc822.toString('latin1') : rfc822;
}

// --- (a) tracked path ---------------------------------------------------------

describe('submitRelay tracked path', () => {
  test('subject rule match instruments html, relays, and enqueues the follow-up', async () => {
    const { pipeline, submissions, persistInputs, tracking, smtpSend, store, sentCopyAppend } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toEqual({ ok: true, messageId: 500, tracked: true });

    // Tracking was prepared against the persisted message + minted Message-ID.
    expect(tracking!.prepareOutbound).toHaveBeenCalledTimes(1);
    const prepareArgs = tracking!.prepareOutbound.mock.calls[0]![0] as {
      messageId: number;
      accountId: number;
      messageIdHeader: string;
      recipientCount: number;
      html: string | null;
    };
    expect(prepareArgs.messageId).toBe(500);
    expect(prepareArgs.accountId).toBe(100);
    expect(prepareArgs.recipientCount).toBe(1);
    expect(prepareArgs.html).toContain('bitte begleichen');
    // Tracked messages get OUR Message-ID, not the ERP's.
    expect(prepareArgs.messageIdHeader).not.toBe('<erp-123@erp.local>');
    expect(prepareArgs.messageIdHeader).toMatch(/^<.+@acme\.test>$/);

    // The outgoing message was rebuilt with the instrumented html + minted id.
    const outgoing = capturedRfc822(smtpSend);
    expect(outgoing).toContain(TRACK_MARKER);
    expect(outgoing).toContain(`Message-ID: ${prepareArgs.messageIdHeader}`);
    expect(outgoing).not.toContain('<erp-123@erp.local>');
    const sendArgs = smtpSend.mock.calls[0]![0] as ServerSmtpSendInput;
    expect(sendArgs.host).toBe('smtp.acme.test');
    expect(sendArgs.port).toBe(587);
    expect(sendArgs.user).toBe('sales-smtp-user');
    expect(sendArgs.password).toBe('relay-smtp-pass');
    expect(sendArgs.envelopeFrom).toBe('sales@acme.test');
    expect(sendArgs.recipients).toEqual(['kunde@example.com']);

    // Persisted with the minted header + rule reason; ends 'relayed'.
    expect(persistInputs[0]!.messageIdHeader).toBe(prepareArgs.messageIdHeader);
    expect(persistInputs[0]!.trackingRuleReason).toBe('subject_match');
    expect(submissions[0]!.status).toBe('relayed');
    expect(submissions[0]!.trackingApplied).toBe(true);

    // Transport events + sent copy.
    expect(tracking!.recordSending).toHaveBeenCalledTimes(1);
    expect(tracking!.recordSmtpAccepted).toHaveBeenCalledTimes(1);
    expect(tracking!.recordSmtpFailed).not.toHaveBeenCalled();
    // The Sent-copy gets the SAME rfc822 (Buffer) that went to the wire.
    const sentRfc822 = (smtpSend.mock.calls[0]![0] as ServerSmtpSendInput).rfc822;
    expect(sentCopyAppend).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, accountId: 100, rfc822: sentRfc822 }),
    );

    // Follow-up workflow enqueued with the persisted message + 'relay' trigger.
    expect(store.enqueueFollowup).toHaveBeenCalledTimes(1);
    expect(store.enqueueFollowup).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WS,
      workflowId: 7,
      messageId: 500,
      triggerName: 'relay',
    }));
  });

  test('X-SimpleCRM-Track: on header override forces tracking without subject match', async () => {
    const { pipeline, tracking, smtpSend, persistInputs } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(erpMessage({
      subject: 'Rechnungskopie',
      extraHeaders: ['X-SimpleCRM-Track: ON'],
    })));

    expect(result).toEqual(expect.objectContaining({ ok: true, tracked: true }));
    expect(tracking!.prepareOutbound).toHaveBeenCalledTimes(1);
    expect(persistInputs[0]!.trackingRuleReason).toBe('header_override');
    // Rebuilt message never carries the relay control header.
    expect(capturedRfc822(smtpSend)).not.toMatch(/x-simplecrm/i);
  });

  test('threading headers (In-Reply-To / References) are persisted with the message', async () => {
    const { pipeline, persistInputs } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(erpMessage({
      subject: 'Mahnung 2',
      extraHeaders: [
        'In-Reply-To: <original-msg@erp.local>',
        'References: <thread-1@erp.local> <original-msg@erp.local>',
      ],
    })));

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(persistInputs[0]!.inReplyTo).toBe('<original-msg@erp.local>');
    expect(persistInputs[0]!.referencesHeader).toBe(
      '<thread-1@erp.local> <original-msg@erp.local>',
    );
  });

  test('a Bcc-only (no To: header) tracked message does not expose the envelope recipient list', async () => {
    // Regression test: falling back to the SMTP envelope recipients for a
    // missing To: header would leak every Bcc'd recipient's address to every
    // other recipient in the rebuilt, visible To: header.
    const { pipeline, smtpSend } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(
      erpMessage({ subject: 'Mahnung 2', to: null }),
      { recipients: ['kunde-a@example.com', 'kunde-b@example.com'] },
    ));

    expect(result).toEqual(expect.objectContaining({ ok: true, tracked: true }));
    const outgoing = capturedRfc822(smtpSend);
    expect(outgoing).not.toContain('kunde-a@example.com');
    expect(outgoing).not.toContain('kunde-b@example.com');
    expect(outgoing).toContain('To: undisclosed-recipients:;');
  });
});

// --- (b) untracked pass-through ------------------------------------------------

describe('submitRelay untracked pass-through', () => {
  test('no rule match passes the original bytes through with X-SimpleCRM-* stripped', async () => {
    const relayPort = makeRelayPort({ config: relayConfig({ followupWorkflowId: null }) });
    const { pipeline, tracking, smtpSend, persistInputs, submissions, store } = makePipeline({ relayPort });

    const original = erpMessage({
      subject: 'Rechnungskopie 42',
      extraHeaders: [
        'X-SimpleCRM-Internal: erp-request-77',
        'X-SimpleCRM-Note: first line',
        ' folded second line',
      ],
    });
    const expected = erpMessage({ subject: 'Rechnungskopie 42' }).toString('utf8');

    const result = await pipeline.submitRelay(submitInput(original));

    expect(result).toEqual({ ok: true, messageId: 500, tracked: false });
    expect(tracking!.prepareOutbound).not.toHaveBeenCalled();

    const outgoing = capturedRfc822(smtpSend);
    expect(outgoing).toBe(expected);
    expect(outgoing).toContain('Message-ID: <erp-123@erp.local>');
    expect(outgoing).not.toMatch(/x-simplecrm/i);

    expect(persistInputs[0]!.messageIdHeader).toBe('<erp-123@erp.local>');
    expect(persistInputs[0]!.trackingApplied).toBe(false);
    expect(persistInputs[0]!.trackingRuleReason).toBe('no_match');
    expect(submissions[0]!.status).toBe('relayed');
    expect(submissions[0]!.trackingApplied).toBe(false);
    expect(store.enqueueFollowup).not.toHaveBeenCalled();
  });

  test('does NOT enqueue the follow-up for an untracked message even when one is configured', async () => {
    // Regression: the follow-up was enqueued whenever followupWorkflowId was
    // set, regardless of whether tracking was actually applied. The relay
    // template waits 14 days before it can read (absent) evidence, so untracked
    // traffic would pile up delayed jobs. Gate the enqueue on real tracking.
    const relayPort = makeRelayPort({ config: relayConfig({ trackingMode: 'off', followupWorkflowId: 7 }) });
    const { pipeline, store, submissions } = makePipeline({ relayPort });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Rechnung 42' })));

    expect(result).toEqual({ ok: true, messageId: 500, tracked: false });
    expect(submissions[0]!.status).toBe('relayed');
    // Follow-up workflow configured, but message untracked -> no run enqueued.
    expect(store.enqueueFollowup).not.toHaveBeenCalled();
  });

  test('passes through (does NOT rebuild) when tracking is requested but declined', async () => {
    // Rule matches so tracking is REQUESTED, but prepareOutbound fails open
    // (no HTML / policy disabled / HTML over limit) and returns no
    // trackingMessageId. The message must ship byte-preserved via pass-through,
    // NOT be rebuilt (which would drop the ERP's headers/encodings for nothing).
    const tracking = {
      prepareOutbound: jest.fn(async (input: { html: string | null }) => ({
        html: input.html ?? '', trackingMessageId: null, warning: null,
      })),
      recordSending: jest.fn(async () => undefined),
      recordSmtpAccepted: jest.fn(async () => undefined),
      recordSmtpFailed: jest.fn(async () => undefined),
    };
    const { pipeline, smtpSend, submissions } = makePipeline({ tracking });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toMatchObject({ ok: true, tracked: false });
    expect(tracking.prepareOutbound).toHaveBeenCalledTimes(1);
    const outgoing = capturedRfc822(smtpSend);
    expect(outgoing).not.toContain(TRACK_MARKER);
    // Pass-through keeps the ERP's original Message-ID (no rebuild -> no mint).
    expect(outgoing).toContain('Message-ID: <erp-123@erp.local>');
    expect(submissions[0]!.status).toBe('relayed');
  });

  test('a plus-tagged recipient does NOT collide with the base address in the dedup key', async () => {
    // Same Message-ID + body fanned out to kunde@ and kunde+shop@ (distinct
    // mailboxes on some domains) must relay independently — the dedup key uses
    // an exact mailbox, so it does NOT fold the plus-tag.
    const { pipeline, smtpSend, persistInputs } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });
    const message = erpMessage({ messageId: '<same@erp.local>', subject: 'Sammel' });

    await pipeline.submitRelay(submitInput(message, { recipients: ['kunde@example.com'] }));
    await pipeline.submitRelay(submitInput(message, { recipients: ['kunde+shop@example.com'] }));
    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(persistInputs[0]!.dedupKey).not.toBe(persistInputs[1]!.dedupKey);
  });

  test('preserves non-UTF-8 (ISO-8859-1 / 8bit) bytes exactly on pass-through', async () => {
    // Regression for the byte-integrity fix: an ERP 8BITMIME body with raw
    // ISO-8859-1 octets (0xFC = ü, 0xDF = ß) must reach the wire unchanged — a
    // UTF-8 round-trip would replace those invalid-as-UTF-8 bytes.
    const { pipeline, smtpSend } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });
    const raw = Buffer.concat([
      Buffer.from(
        'From: Buchhaltung <sales@acme.test>\r\n'
        + 'To: Kunde <kunde@example.com>\r\n'
        + 'Message-ID: <erp-iso@erp.local>\r\n'
        + 'Subject: Rechnung\r\n'
        + 'Content-Type: text/plain; charset=ISO-8859-1\r\n'
        + 'Content-Transfer-Encoding: 8bit\r\n\r\n',
        'latin1',
      ),
      Buffer.from([0x47, 0x72, 0xFC, 0xDF, 0x65]), // "Grüße"-ish 8-bit bytes
    ]);

    const result = await pipeline.submitRelay(submitInput(raw));
    expect(result).toMatchObject({ ok: true });

    const sent = (smtpSend.mock.calls[0]![0] as ServerSmtpSendInput).rfc822;
    expect(Buffer.isBuffer(sent)).toBe(true);
    const sentBuffer = sent as unknown as Buffer;
    // High bytes survive (a UTF-8 decode would have dropped/replaced them)...
    expect(sentBuffer.includes(0xFC)).toBe(true);
    expect(sentBuffer.includes(0xDF)).toBe(true);
    // ...and with a Message-ID present and no X-SimpleCRM headers, the bytes are
    // passed through verbatim.
    expect(sentBuffer.equals(raw)).toBe(true);
  });

  test('a pass-through message without a Message-ID gets one minted and prepended', async () => {
    const { pipeline, smtpSend, persistInputs } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ messageId: null })));

    expect(result).toEqual(expect.objectContaining({ ok: true, tracked: false }));
    const outgoing = capturedRfc822(smtpSend);
    const minted = persistInputs[0]!.messageIdHeader!;
    expect(minted).toMatch(/^<.+@acme\.test>$/);
    expect(outgoing.startsWith(`Message-ID: ${minted}\r\n`)).toBe(true);
  });

  test('a retried Message-ID-less submission dedupes on a stable content hash, not the minted wire id', async () => {
    // Regression test: previously the dedup fallback for a missing
    // Message-ID was the minted wire id itself, which is freshly random on
    // every attempt (Date.now() + random bytes) — so a genuine ERP retry of
    // byte-identical DATA (lost SMTP response, no Message-ID header) could
    // never be recognized as a duplicate and would resend.
    const { pipeline, smtpSend, persistInputs } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });
    const message = erpMessage({ messageId: null, subject: 'Rechnungskopie' });

    const first = await pipeline.submitRelay(submitInput(message));
    expect(first).toEqual(expect.objectContaining({ ok: true }));
    expect(smtpSend).toHaveBeenCalledTimes(1);

    const retry = await pipeline.submitRelay(submitInput(message));
    expect(retry).toEqual(expect.objectContaining({ ok: true }));
    expect(smtpSend).toHaveBeenCalledTimes(1);

    expect(persistInputs[0]!.dedupKey).toBe(persistInputs[1]!.dedupKey);
    // Wire ids minted for the pass-through header are still distinct...
    expect(persistInputs[0]!.messageIdHeader).not.toBe(persistInputs[1]!.messageIdHeader);
    // ...but the dedup key is NOT one of those minted wire ids.
    expect(persistInputs[0]!.dedupKey).not.toBe(persistInputs[0]!.messageIdHeader);
  });

  test('a Message-ID-less message to DIFFERENT envelope recipients is not deduped (Bcc split)', async () => {
    // Regression: an ERP sending a Bcc-only / undisclosed-recipients message
    // delivers byte-identical DATA in separate transactions, one per RCPT. A
    // dedup key over the bytes alone would treat the second recipient as a
    // replay of the first and silently drop it. The envelope recipients must
    // be part of the fallback key so each distinct recipient is relayed.
    const { pipeline, smtpSend, persistInputs } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });
    const message = erpMessage({ messageId: null, subject: 'Sammelversand' });

    const first = await pipeline.submitRelay(submitInput(message, { recipients: ['kunde-a@example.com'] }));
    const second = await pipeline.submitRelay(submitInput(message, { recipients: ['kunde-b@example.com'] }));

    expect(first).toEqual(expect.objectContaining({ ok: true }));
    expect(second).toEqual(expect.objectContaining({ ok: true }));
    // Both recipients were actually relayed — the second was NOT short-circuited.
    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(persistInputs[0]!.dedupKey).not.toBe(persistInputs[1]!.dedupKey);

    // ...but a true retry to the SAME recipient still dedupes.
    const retry = await pipeline.submitRelay(submitInput(message, { recipients: ['kunde-a@example.com'] }));
    expect(retry).toEqual(expect.objectContaining({ ok: true }));
    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(persistInputs[2]!.dedupKey).toBe(persistInputs[0]!.dedupKey);
  });

  test('a failing sent-copy appender does not fail the relay', async () => {
    const sentCopyAppend = jest.fn(async () => {
      throw new Error('imap down');
    });
    const { pipeline, submissions } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off', followupWorkflowId: null }) }),
      sentCopyAppend,
    });

    const result = await pipeline.submitRelay(submitInput(erpMessage()));

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(sentCopyAppend).toHaveBeenCalledTimes(1);
    expect(submissions[0]!.status).toBe('relayed');
  });
});

// --- (c) from mismatch ----------------------------------------------------------

describe('submitRelay header-From spoofing check', () => {
  test('rejects a header From that is not allowed for the relay', async () => {
    const { pipeline, smtpSend, store } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(erpMessage({
      from: 'Fremder <stranger@acme.test>',
    })));

    expect(result).toEqual({
      ok: false,
      code: 'from_mismatch',
      message: expect.any(String),
      retryable: false,
    });
    expect(smtpSend).not.toHaveBeenCalled();
    expect(store.persistMessage).not.toHaveBeenCalled();
  });

  test('rejects a multi-address header From even when the first address is allowed', async () => {
    // Regression test: only the FIRST From address was ever checked against
    // the relay's allowed accounts, but the full header (every address) is
    // what actually ships in the rebuilt/pass-through message — a second,
    // attacker-controlled mailbox could ride along disguised behind the
    // allowed one.
    const { pipeline, smtpSend, store } = makePipeline();

    const result = await pipeline.submitRelay(submitInput(erpMessage({
      from: 'Buchhaltung <sales@acme.test>, Evil <evil@example.test>',
    })));

    expect(result).toEqual({
      ok: false,
      code: 'from_mismatch',
      message: expect.any(String),
      retryable: false,
    });
    expect(smtpSend).not.toHaveBeenCalled();
    expect(store.persistMessage).not.toHaveBeenCalled();
  });

  test('rejects a header From that resolves to a different account than the envelope From', async () => {
    const relayPort = makeRelayPort({
      accounts: [
        routingAccount(),
        routingAccount({ id: 200, source_sqlite_id: 200, email_address: 'marketing@acme.test' }),
      ],
    });
    const { pipeline, smtpSend, store } = makePipeline({ relayPort });

    const result = await pipeline.submitRelay(submitInput(
      erpMessage({ from: 'Marketing <marketing@acme.test>' }),
      { envelopeFrom: 'sales@acme.test' },
    ));

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'from_mismatch', retryable: false }));
    expect(smtpSend).not.toHaveBeenCalled();
    expect(store.persistMessage).not.toHaveBeenCalled();
  });
});

// --- (d) smtp failure ------------------------------------------------------------

describe('submitRelay SMTP failure', () => {
  test('marks the submission failed, records the tracking event, and asks for a retry', async () => {
    const smtpSend = jest.fn(async () => {
      throw new Error('451 4.3.0 Temporary local problem');
    });
    const { pipeline, submissions, tracking, store } = makePipeline({ smtpSend });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toEqual({
      ok: false,
      code: 'relay_failed',
      message: '451 4.3.0 Temporary local problem',
      retryable: true,
    });
    expect(submissions[0]!.status).toBe('failed');
    expect(submissions[0]!.errorText).toContain('451');
    expect(tracking!.recordSmtpFailed).toHaveBeenCalledTimes(1);
    expect(tracking!.recordSmtpFailed).toHaveBeenCalledWith(expect.objectContaining({
      trackingMessageId: 'tm-1',
      stage: 'send',
      smtpCode: 451,
    }));
    expect(tracking!.recordSmtpAccepted).not.toHaveBeenCalled();
    expect(store.enqueueFollowup).not.toHaveBeenCalled();
  });

  test('a permanent (5xx) rejection is not retryable', async () => {
    const smtpSend = jest.fn(async () => {
      throw new Error('550 5.1.1 mailbox unavailable');
    });
    const { pipeline, submissions } = makePipeline({ smtpSend });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toEqual({
      ok: false,
      code: 'relay_failed',
      message: '550 5.1.1 mailbox unavailable',
      retryable: false,
    });
    expect(submissions[0]!.status).toBe('failed');
  });

  test('a missing SMTP host is a permanent (non-retryable) config rejection', async () => {
    // A routing account with no SMTP host will never deliver, no matter how
    // often the ERP retries — so classify it permanent (550) instead of a
    // retryable 451 that loops forever.
    const smtpSend = jest.fn(async () => undefined);
    const { pipeline, submissions } = makePipeline({
      relayPort: makeRelayPort({ accounts: [routingAccount({ smtp_host: null })] }),
      smtpSend,
    });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toMatchObject({ ok: false, code: 'relay_failed', retryable: false });
    expect(smtpSend).not.toHaveBeenCalled();
    expect(submissions[0]!.status).toBe('failed');
  });

  test('a missing SMTP secret is a permanent (non-retryable) config rejection', async () => {
    // resolveSmtpAuth returns ok:false (no password available) when the secret
    // is absent; a transient secret-store failure would THROW instead and be
    // retried by the listener. The absent-secret case is permanent.
    const smtpSend = jest.fn(async () => undefined);
    const { pipeline } = makePipeline({
      readSecret: async () => null,
      smtpSend,
    });

    const result = await pipeline.submitRelay(submitInput(erpMessage({ subject: 'Mahnung 2' })));

    expect(result).toMatchObject({ ok: false, code: 'relay_failed', retryable: false });
    expect(smtpSend).not.toHaveBeenCalled();
  });
});

// --- (e) idempotent replay -------------------------------------------------------

describe('submitRelay idempotent replay', () => {
  test('a submission whose Message-ID is already relayed is acknowledged without re-sending', async () => {
    const { pipeline, smtpSend } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off', followupWorkflowId: null }) }),
    });
    const message = erpMessage();

    const first = await pipeline.submitRelay(submitInput(message));
    expect(first).toEqual(expect.objectContaining({ ok: true, messageId: 500 }));
    expect(smtpSend).toHaveBeenCalledTimes(1);

    const replay = await pipeline.submitRelay(submitInput(message));
    expect(replay).toEqual({ ok: true, messageId: 500, tracked: false });
    expect(smtpSend).toHaveBeenCalledTimes(1);
  });

  test('a retried submission with tracking active is deduped on the ERP Message-ID, not the minted wire id', async () => {
    // Regression test: the tracked path mints a fresh outgoing Message-ID on
    // every attempt (see the "OUR Message-ID, not the ERP's" test above), so
    // dedup must NOT be keyed on that wire id — otherwise a connection drop
    // between SMTP accept and the sender receiving the response, followed by
    // an ERP retry of the identical Message-ID, would relay the same dunning
    // email to the customer twice.
    const { pipeline, smtpSend, persistInputs } = makePipeline();
    const message = erpMessage({ subject: 'Mahnung 2', messageId: '<erp-stable-1@erp.local>' });

    const first = await pipeline.submitRelay(submitInput(message));
    expect(first).toEqual(expect.objectContaining({ ok: true, tracked: true }));
    expect(smtpSend).toHaveBeenCalledTimes(1);

    const retry = await pipeline.submitRelay(submitInput(message));
    expect(retry).toEqual(expect.objectContaining({ ok: true, tracked: false }));
    // Not re-sent: the second attempt short-circuited on alreadyRelayed.
    expect(smtpSend).toHaveBeenCalledTimes(1);

    // Both attempts minted DIFFERENT wire Message-IDs (existing tracked-path
    // behaviour) but shared the SAME stable dedup key. The key now folds in the
    // ERP Message-ID together with the envelope (sha256), so it is a hash
    // rather than the bare Message-ID — the point is it is STABLE across the
    // retry (same identity + same recipients), not the wire id.
    expect(persistInputs[0]!.messageIdHeader).not.toBe(persistInputs[1]!.messageIdHeader);
    expect(persistInputs[0]!.dedupKey).toMatch(/^sha256:/);
    expect(persistInputs[0]!.dedupKey).toBe(persistInputs[1]!.dedupKey);
    // ...and NOT the freshly minted wire id.
    expect(persistInputs[0]!.dedupKey).not.toBe(persistInputs[0]!.messageIdHeader);
  });

  test('the same Message-ID to DIFFERENT envelope recipients is not deduped (Bcc fan-out)', async () => {
    // Regression: keying on the incoming Message-ID alone dropped every batch
    // after the first when an ERP fans the same message out to different
    // recipients in separate transactions. The envelope recipients are part of
    // the key, so distinct recipient sets relay independently.
    const { pipeline, smtpSend, persistInputs } = makePipeline({
      relayPort: makeRelayPort({ config: relayConfig({ trackingMode: 'off' }) }),
    });
    const message = erpMessage({ messageId: '<same-id@erp.local>', subject: 'Sammel' });

    await pipeline.submitRelay(submitInput(message, { recipients: ['a@example.com'] }));
    await pipeline.submitRelay(submitInput(message, { recipients: ['b@example.com'] }));
    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(persistInputs[0]!.dedupKey).not.toBe(persistInputs[1]!.dedupKey);

    // A true retry to the same recipient still dedupes.
    await pipeline.submitRelay(submitInput(message, { recipients: ['a@example.com'] }));
    expect(smtpSend).toHaveBeenCalledTimes(2);
    expect(persistInputs[2]!.dedupKey).toBe(persistInputs[0]!.dedupKey);
  });
});

// --- (f) stripSimplecrmHeaders ----------------------------------------------------

describe('stripSimplecrmHeaders', () => {
  test('removes X-SimpleCRM headers including folded continuation lines', () => {
    const source = Buffer.from([
      'From: a@b.test',
      'X-SimpleCRM-Track: on',
      'X-SimpleCRM-Note: first',
      ' folded second',
      '\tfolded third',
      'Subject: Hallo',
      '',
      'Body',
    ].join('\r\n'), 'utf8');

    expect(stripSimplecrmHeaders(source).toString('utf8')).toBe([
      'From: a@b.test',
      'Subject: Hallo',
      '',
      'Body',
    ].join('\r\n'));
  });

  test('is case-insensitive and keeps folded lines of other headers', () => {
    const source = Buffer.from([
      'Subject: a very long subject',
      ' that folds onto a second line',
      'x-simplecrm-track: OFF',
      'To: k@example.com',
      '',
      'Body',
    ].join('\r\n'), 'utf8');

    expect(stripSimplecrmHeaders(source).toString('utf8')).toBe([
      'Subject: a very long subject',
      ' that folds onto a second line',
      'To: k@example.com',
      '',
      'Body',
    ].join('\r\n'));
  });

  test('never touches the body, even when it contains X-SimpleCRM lines', () => {
    const body = [
      'First body line',
      'X-SimpleCRM-Track: on',
      '',
      'X-SimpleCRM-Internal: still body',
      'trailing',
    ].join('\r\n');
    const source = Buffer.from(`From: a@b.test\r\nX-SimpleCRM-Track: off\r\n\r\n${body}`, 'utf8');

    expect(stripSimplecrmHeaders(source).toString('utf8')).toBe(`From: a@b.test\r\n\r\n${body}`);
  });

  test('handles LF-only messages and messages without a body', () => {
    const lfOnly = Buffer.from('From: a@b.test\nX-SimpleCRM-Track: on\nSubject: x\n\nBody\n', 'utf8');
    expect(stripSimplecrmHeaders(lfOnly).toString('utf8'))
      .toBe('From: a@b.test\nSubject: x\n\nBody\n');

    const headersOnly = Buffer.from('X-SimpleCRM-Track: on\r\nFrom: a@b.test', 'utf8');
    expect(stripSimplecrmHeaders(headersOnly).toString('utf8')).toBe('From: a@b.test');
  });
});

describe('parseRelayTrackingHeaderOverride', () => {
  test('parses on/off case-insensitively and ignores other values', () => {
    const build = (value?: string): Buffer => Buffer.from(
      `From: a@b.test\r\n${value === undefined ? '' : `X-SimpleCRM-Track: ${value}\r\n`}\r\nX-SimpleCRM-Track: on\r\n`,
      'utf8',
    );
    expect(parseRelayTrackingHeaderOverride(build('on'))).toBe('on');
    expect(parseRelayTrackingHeaderOverride(build('OFF'))).toBe('off');
    expect(parseRelayTrackingHeaderOverride(build(' On '))).toBe('on');
    expect(parseRelayTrackingHeaderOverride(build('maybe'))).toBeNull();
    // Header absent from the top-level block: the body copy must not count.
    expect(parseRelayTrackingHeaderOverride(build())).toBeNull();
  });
});
