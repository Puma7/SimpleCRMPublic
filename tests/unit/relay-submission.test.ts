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
    readSecret: async () => Buffer.from('relay-smtp-pass', 'utf8'),
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
  return (smtpSend.mock.calls[0]![0] as ServerSmtpSendInput).rfc822;
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
    expect(sentCopyAppend).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, accountId: 100, rfc822: outgoing }),
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
    // behaviour) but shared the SAME stable dedup key.
    expect(persistInputs[0]!.messageIdHeader).not.toBe(persistInputs[1]!.messageIdHeader);
    expect(persistInputs[0]!.dedupKey).toBe('<erp-stable-1@erp.local>');
    expect(persistInputs[1]!.dedupKey).toBe('<erp-stable-1@erp.local>');
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
