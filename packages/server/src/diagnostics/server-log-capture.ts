import { redactSecrets, type ServerLogLevel, type ServerLogStore } from './server-log-store';

/** pino numeric levels: 40=warn, 50=error, 60=fatal. */
function pinoLevelToServerLevel(level: unknown): ServerLogLevel | null {
  if (typeof level !== 'number') return null;
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  return null;
}

function messageFromPinoRecord(record: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof record.msg === 'string' && record.msg) parts.push(record.msg);
  const err = record.err;
  if (err && typeof err === 'object') {
    const errMessage = (err as { message?: unknown }).message;
    if (typeof errMessage === 'string' && errMessage && !parts.includes(errMessage)) parts.push(errMessage);
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) parts.push(`(${code})`);
  }
  const req = record.req;
  if (req && typeof req === 'object') {
    const method = (req as { method?: unknown }).method;
    const url = (req as { url?: unknown }).url;
    if (typeof method === 'string' && typeof url === 'string') parts.push(`${method} ${url}`);
  }
  return parts.join(' ').trim();
}

/**
 * A pino stream that tees every log line to stdout (so `docker logs` keeps
 * working) and captures warn/error/fatal records into the central store.
 */
export function createPinoLogCaptureStream(
  store: ServerLogStore,
  out: { write(chunk: string): void } = process.stdout,
): { write(chunk: string): void } {
  return {
    write(chunk: string): void {
      const redactedChunk = redactSecrets(chunk);
      out.write(redactedChunk);
      for (const line of redactedChunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed[0] !== '{') continue;
        try {
          const record = JSON.parse(trimmed) as Record<string, unknown>;
          const level = pinoLevelToServerLevel(record.level);
          if (!level) continue;
          const message = messageFromPinoRecord(record);
          if (message) store.capture({ level, message, source: 'server' });
        } catch {
          /* non-JSON or malformed line: ignore */
        }
      }
    },
  };
}

type ConsoleLike = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

/**
 * Routes console.warn/console.error (e.g. the mail-sync diagnostics) into the
 * central store while preserving the original console output. Returns a restore
 * function. Safe to no-op if already installed on the given console.
 */
export function installConsoleLogCapture(
  store: ServerLogStore,
  target: ConsoleLike = console,
): () => void {
  const installed = target as ConsoleLike & { __serverLogCaptureInstalled?: boolean };
  if (installed.__serverLogCaptureInstalled) return () => undefined;

  const originalWarn = target.warn.bind(target);
  const originalError = target.error.bind(target);

  const toMessage = (args: unknown[]): string =>
    args
      .map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : safeStringify(arg)))
      .join(' ')
      .trim();

  target.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const message = toMessage(args);
    if (message) store.capture({ level: 'warn', message, source: 'console' });
  };
  target.error = (...args: unknown[]) => {
    originalError(...args);
    const message = toMessage(args);
    if (message) store.capture({ level: 'error', message, source: 'console' });
  };
  installed.__serverLogCaptureInstalled = true;

  return () => {
    target.warn = originalWarn;
    target.error = originalError;
    delete installed.__serverLogCaptureInstalled;
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
