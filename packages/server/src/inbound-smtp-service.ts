/**
 * Inbound SMTP listener for the workspace SMTP relay.
 *
 * An external system (e.g. the ERP) connects on the submission port (587,
 * STARTTLS) or the SMTPS port (465, implicit TLS), authenticates with a relay
 * credential (`smtp_relay_credentials`, verified via the relay port), and
 * submits a complete RFC822 message. The listener enforces the transport-level
 * relay policy (auth, allowed From, recipient count, message size, per-
 * credential rate limit) and hands the buffered message to the relay
 * submission pipeline (`relay-submission.ts`), which owns parsing, spoofing
 * checks, tracking, persistence and the actual outbound send.
 *
 * TLS-before-AUTH on 587 is guaranteed by smtp-server itself: with the default
 * `allowInsecureAuth: false` the server neither advertises nor accepts AUTH
 * until the connection has been upgraded via STARTTLS.
 */
import { SMTPServer } from 'smtp-server';
import type {
  SMTPServerDataStream,
  SMTPServerOptions,
  SMTPServerSession,
} from 'smtp-server';

import type {
  PostgresSmtpRelayPort,
  SmtpRelayConfig,
  SmtpRelayCredentialMatch,
} from './db/postgres-relay-port';
import type {
  RelaySubmissionInput,
  RelaySubmissionResult,
} from './relay-submission';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type InboundSmtpLogger = Readonly<{
  info(message: string, detail?: Readonly<Record<string, unknown>>): void;
  warn(message: string, detail?: Readonly<Record<string, unknown>>): void;
  error(message: string, detail?: Readonly<Record<string, unknown>>): void;
}>;

export type InboundSmtpServiceOptions = Readonly<{
  relayPort: Pick<
    PostgresSmtpRelayPort,
    'verifyCredential' | 'resolveRoutingAccount' | 'loadRelayConfig'
  >;
  submitRelay: (input: RelaySubmissionInput) => Promise<RelaySubmissionResult>;
  /** EHLO name of the listener (defaults to os.hostname() via smtp-server). */
  hostname?: string;
  /** STARTTLS submission port (default 587; 0 picks an ephemeral port). */
  portSubmission?: number;
  /** Implicit-TLS port (default 465; 0 picks an ephemeral port). */
  portSmtps?: number;
  tlsKey: Buffer | string;
  tlsCert: Buffer | string;
  /** Global message size cap; a smaller per-relay limit still applies. */
  maxMessageBytes?: number;
  maxConnections?: number;
  socketTimeoutMs?: number;
  bindHost?: string;
  /** Clock injected into the per-credential rate limiter (tests). */
  now?: () => number;
  log?: InboundSmtpLogger;
}>;

export type InboundSmtpService = Readonly<{
  stop(): Promise<void>;
  /** The ACTUAL bound ports (relevant when a port was requested as 0). */
  ports: Readonly<{ submission: number; smtps: number }>;
}>;

export const INBOUND_SMTP_DEFAULT_SUBMISSION_PORT = 587;
export const INBOUND_SMTP_DEFAULT_SMTPS_PORT = 465;
export const INBOUND_SMTP_DEFAULT_MAX_MESSAGE_BYTES = 26_214_400;
export const INBOUND_SMTP_DEFAULT_MAX_CONNECTIONS = 50;
export const INBOUND_SMTP_DEFAULT_SOCKET_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Per-credential token bucket (in-memory, lazily refilled — no interval)
// ---------------------------------------------------------------------------

export type RelayRateLimiter = Readonly<{
  /** Consumes one token; false when the per-minute budget is exhausted. */
  tryConsume(credentialId: string, ratePerMin: number): boolean;
  /** Peek without consuming (used to reject an exhausted credential at AUTH). */
  hasCapacity(credentialId: string, ratePerMin: number): boolean;
}>;

export function createRelayRateLimiter(now: () => number = () => Date.now()): RelayRateLimiter {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>();

  const refill = (credentialId: string, ratePerMin: number): { tokens: number; lastRefill: number } => {
    const timestamp = now();
    let bucket = buckets.get(credentialId);
    if (!bucket) {
      bucket = { tokens: ratePerMin, lastRefill: timestamp };
      buckets.set(credentialId, bucket);
      return bucket;
    }
    const elapsedMs = timestamp - bucket.lastRefill;
    if (elapsedMs > 0) {
      bucket.tokens = Math.min(ratePerMin, bucket.tokens + (elapsedMs / 60_000) * ratePerMin);
      bucket.lastRefill = timestamp;
    }
    return bucket;
  };

  return {
    tryConsume(credentialId, ratePerMin) {
      // A relay without a sensible positive limit is treated as unlimited.
      if (!Number.isFinite(ratePerMin) || ratePerMin <= 0) return true;
      const bucket = refill(credentialId, ratePerMin);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
    hasCapacity(credentialId, ratePerMin) {
      if (!Number.isFinite(ratePerMin) || ratePerMin <= 0) return true;
      return refill(credentialId, ratePerMin).tokens >= 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Transaction/session scratch state the handlers stash next to the session. */
type RelaySessionState = {
  /** Relay config, loaded once per connection ('null' = relay unconfigured). */
  relayConfig?: SmtpRelayConfig | null;
  accountId?: number;
  envelopeFrom?: string;
};

export async function startInboundSmtpService(
  options: InboundSmtpServiceOptions,
): Promise<InboundSmtpService> {
  const log = options.log ?? consoleInboundSmtpLogger();
  const maxMessageBytes = options.maxMessageBytes ?? INBOUND_SMTP_DEFAULT_MAX_MESSAGE_BYTES;
  const rateLimiter = createRelayRateLimiter(options.now);
  const sessionStates = new WeakMap<SMTPServerSession, RelaySessionState>();

  const sessionState = (session: SMTPServerSession): RelaySessionState => {
    let state = sessionStates.get(session);
    if (!state) {
      state = {};
      sessionStates.set(session, state);
    }
    return state;
  };

  /** smtp-server types session.user as string; we stash the credential match. */
  const sessionUser = (session: SMTPServerSession): SmtpRelayCredentialMatch | undefined => {
    const user = (session as { user?: unknown }).user;
    if (!user || typeof user !== 'object') return undefined;
    return user as SmtpRelayCredentialMatch;
  };

  const loadSessionRelayConfig = async (
    session: SMTPServerSession,
    user: SmtpRelayCredentialMatch,
  ): Promise<SmtpRelayConfig | null> => {
    const state = sessionState(session);
    if (state.relayConfig === undefined) {
      state.relayConfig = await options.relayPort.loadRelayConfig({
        workspaceId: user.workspaceId,
        relayId: user.relayId,
      });
    }
    return state.relayConfig;
  };

  const onAuth: NonNullable<SMTPServerOptions['onAuth']> = (auth, session, callback) => {
    void (async () => {
      if (auth.method !== 'PLAIN' && auth.method !== 'LOGIN') {
        log.warn('inbound smtp auth rejected: unsupported mechanism', {
          method: auth.method,
          remoteAddress: session.remoteAddress,
        });
        return callback(smtpError(504, 'Unsupported authentication mechanism'));
      }
      const match = await options.relayPort.verifyCredential({
        username: auth.username ?? '',
        password: auth.password ?? '',
      });
      if (!match) {
        log.warn('inbound smtp auth failed', {
          username: auth.username ?? '',
          remoteAddress: session.remoteAddress,
        });
        return callback(smtpError(535, 'Invalid username or password'));
      }
      // Token-bucket peek AFTER verify: an exhausted credential is turned away
      // at AUTH already; the actual token is consumed per message at MAIL FROM.
      const config = await loadSessionRelayConfig(session, match).catch(() => undefined);
      if (config && !rateLimiter.hasCapacity(match.credentialId, config.rateLimitPerMin)) {
        log.warn('inbound smtp auth deferred: rate limit exceeded', {
          workspaceId: match.workspaceId,
          relayId: match.relayId,
          credentialId: match.credentialId,
        });
        return callback(smtpError(454, '4.7.0 Rate limit exceeded, retry later'));
      }
      log.info('inbound smtp auth ok', {
        workspaceId: match.workspaceId,
        relayId: match.relayId,
        credentialId: match.credentialId,
        remoteAddress: session.remoteAddress,
      });
      callback(null, { user: match });
    })().catch((error) => {
      log.error('inbound smtp auth errored', { error: errorMessage(error) });
      callback(smtpError(451, '4.3.0 Temporary authentication failure, retry later'));
    });
  };

  const onMailFrom: NonNullable<SMTPServerOptions['onMailFrom']> = (address, session, callback) => {
    void (async () => {
      const user = sessionUser(session);
      if (!user) return callback(smtpError(530, '5.7.0 Authentication required'));

      // Reload (not the AUTH-time memoized peek) so an admin disabling the
      // relay or tightening its limits takes effect on the NEXT message of
      // an already-authenticated, possibly long-lived connection — a client
      // can submit many messages over one SMTP session, so caching this for
      // the whole session would let a since-revoked/tightened relay keep
      // accepting mail until the connection happens to drop.
      const config = await options.relayPort.loadRelayConfig({
        workspaceId: user.workspaceId,
        relayId: user.relayId,
      });
      sessionState(session).relayConfig = config;
      if (!config) {
        log.warn('inbound smtp sender rejected: relay not configured', {
          workspaceId: user.workspaceId,
          relayId: user.relayId,
        });
        return callback(smtpError(550, '5.7.1 Relay is not configured'));
      }
      if (!rateLimiter.tryConsume(user.credentialId, config.rateLimitPerMin)) {
        log.warn('inbound smtp message deferred: rate limit exceeded', {
          workspaceId: user.workspaceId,
          relayId: user.relayId,
          credentialId: user.credentialId,
        });
        return callback(smtpError(451, '4.7.0 Rate limit exceeded, retry later'));
      }
      const account = await options.relayPort.resolveRoutingAccount({
        workspaceId: user.workspaceId,
        relayId: user.relayId,
        fromAddress: address.address,
      });
      if (!account) {
        log.warn('inbound smtp sender rejected', {
          workspaceId: user.workspaceId,
          relayId: user.relayId,
          fromAddress: address.address,
        });
        return callback(smtpError(550, '5.7.1 Sender address not permitted'));
      }
      const state = sessionState(session);
      state.accountId = Number(account.id);
      state.envelopeFrom = address.address;
      callback();
    })().catch((error) => {
      log.error('inbound smtp MAIL FROM errored', { error: errorMessage(error) });
      callback(smtpError(451, '4.3.0 Temporary server error, retry later'));
    });
  };

  const onRcptTo: NonNullable<SMTPServerOptions['onRcptTo']> = (_address, session, callback) => {
    const user = sessionUser(session);
    if (!user) return callback(smtpError(530, '5.7.0 Authentication required'));
    const config = sessionState(session).relayConfig;
    // envelope.rcptTo holds the ALREADY accepted recipients at this point.
    if (config && session.envelope.rcptTo.length >= config.maxRecipients) {
      log.warn('inbound smtp recipient rejected: too many recipients', {
        workspaceId: user.workspaceId,
        relayId: user.relayId,
        maxRecipients: config.maxRecipients,
      });
      return callback(smtpError(452, '4.5.3 Too many recipients'));
    }
    callback();
  };

  const onData: NonNullable<SMTPServerOptions['onData']> = (stream, session, callback) => {
    const user = sessionUser(session);
    const state = sessionState(session);
    const byteCap = state.relayConfig?.maxMessageBytes ?? maxMessageBytes;

    const chunks: Buffer[] = [];
    let byteCount = 0;
    let overflowed = false;
    stream.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
      if (overflowed) return;
      if (byteCount > byteCap) {
        // Hard cap: drop what we buffered and keep draining so the SMTP
        // dialogue can finish with our 552 instead of a stalled connection.
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    stream.once('end', () => {
      void handleDataEnd(stream, session, user, state, chunks, overflowed).then(
        ({ error, message }) => callback(error, message),
      ).catch((error) => {
        log.error('inbound smtp DATA errored', { error: errorMessage(error) });
        callback(smtpError(451, '4.3.0 Temporary server error, retry later'));
      });
    });
  };

  const handleDataEnd = async (
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
    user: SmtpRelayCredentialMatch | undefined,
    state: RelaySessionState,
    chunks: Buffer[],
    overflowed: boolean,
  ): Promise<{ error?: Error; message?: string }> => {
    if (!user || state.accountId === undefined || state.envelopeFrom === undefined) {
      return { error: smtpError(503, '5.5.1 Bad sequence of commands') };
    }
    if (overflowed || stream.sizeExceeded) {
      log.warn('inbound smtp message rejected: size limit exceeded', {
        workspaceId: user.workspaceId,
        relayId: user.relayId,
        byteLength: stream.byteLength,
      });
      return { error: smtpError(552, '5.3.4 Message size exceeds limit') };
    }

    const recipients = session.envelope.rcptTo.map((recipient) => recipient.address);
    const result = await options.submitRelay({
      workspaceId: user.workspaceId,
      relayId: user.relayId,
      credentialId: user.credentialId,
      accountId: state.accountId,
      envelopeFrom: state.envelopeFrom,
      recipients,
      rfc822: Buffer.concat(chunks),
    });
    if (result.ok) {
      log.info('inbound smtp message relayed', {
        workspaceId: user.workspaceId,
        relayId: user.relayId,
        credentialId: user.credentialId,
        messageId: result.messageId,
        tracked: result.tracked,
        recipientCount: recipients.length,
      });
      return { message: `OK: relayed as ${result.messageId}` };
    }
    log.warn('inbound smtp message rejected by pipeline', {
      workspaceId: user.workspaceId,
      relayId: user.relayId,
      code: result.code,
      retryable: result.retryable,
      error: singleLine(result.message),
    });
    return {
      error: result.retryable
        ? smtpError(451, `4.3.0 ${singleLine(result.message) || 'Temporary failure, retry later'}`)
        : smtpError(550, `5.7.1 ${singleLine(result.message) || 'Message rejected'}`),
    };
  };

  const buildServer = (secure: boolean): SMTPServer => new SMTPServer({
    secure,
    key: options.tlsKey,
    cert: options.tlsCert,
    ...(options.hostname ? { name: options.hostname } : {}),
    authMethods: ['PLAIN', 'LOGIN'],
    authOptional: false,
    // Keep the default allowInsecureAuth: false — on the STARTTLS port AUTH is
    // neither advertised nor accepted until the connection is encrypted.
    disabledCommands: [],
    size: maxMessageBytes,
    maxClients: options.maxConnections ?? INBOUND_SMTP_DEFAULT_MAX_CONNECTIONS,
    socketTimeout: options.socketTimeoutMs ?? INBOUND_SMTP_DEFAULT_SOCKET_TIMEOUT_MS,
    // Reverse-DNS on every connection is slow and irrelevant for auth'd relays.
    disableReverseLookup: true,
    onAuth,
    onMailFrom,
    onRcptTo,
    onData,
  });

  const submissionServer = buildServer(false);
  const smtpsServer = buildServer(true);
  for (const server of [submissionServer, smtpsServer]) {
    server.on('error', (error) => {
      log.error('inbound smtp server error', { error: errorMessage(error) });
    });
  }

  const bindHost = options.bindHost ?? '0.0.0.0';
  let submissionPort: number;
  let smtpsPort: number;
  try {
    submissionPort = await listenSmtpServer(
      submissionServer,
      options.portSubmission ?? INBOUND_SMTP_DEFAULT_SUBMISSION_PORT,
      bindHost,
    );
    smtpsPort = await listenSmtpServer(
      smtpsServer,
      options.portSmtps ?? INBOUND_SMTP_DEFAULT_SMTPS_PORT,
      bindHost,
    );
  } catch (error) {
    await Promise.all([closeSmtpServer(submissionServer), closeSmtpServer(smtpsServer)]);
    throw error;
  }

  log.info('inbound smtp listeners started', {
    bindHost,
    submissionPort,
    smtpsPort,
  });

  let stopped: Promise<void> | undefined;
  return {
    ports: { submission: submissionPort, smtps: smtpsPort },
    stop() {
      stopped ??= Promise.all([
        closeSmtpServer(submissionServer),
        closeSmtpServer(smtpsServer),
      ]).then(() => undefined);
      return stopped;
    },
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Starts listening and resolves with the ACTUAL bound port (supports port 0). */
function listenSmtpServer(server: SMTPServer, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      server.server.removeListener('error', onError);
      const address = server.server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('inbound SMTP listener did not report a bound port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeSmtpServer(server: SMTPServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function smtpError(responseCode: number, message: string): Error {
  const error = new Error(message) as Error & { responseCode: number };
  error.responseCode = responseCode;
  return error;
}

/** Collapse a pipeline error into a single trimmed SMTP-safe response line. */
function singleLine(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function consoleInboundSmtpLogger(): InboundSmtpLogger {
  const write = (
    sink: (message: string) => void,
    message: string,
    detail?: Readonly<Record<string, unknown>>,
  ): void => {
    sink(`[smtp-relay] ${message}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
  };
  return {
    info: (message, detail) => write((line) => console.info(line), message, detail),
    warn: (message, detail) => write((line) => console.warn(line), message, detail),
    error: (message, detail) => write((line) => console.error(line), message, detail),
  };
}
