import type { AppLogStore } from './app-log-store';

type ConsoleLike = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

function toMessage(args: unknown[]): string {
  return args
    .map((arg) =>
      arg instanceof Error
        ? arg.message
        : typeof arg === 'string'
          ? arg
          : safeStringify(arg),
    )
    .join(' ')
    .trim();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Tee console.warn/error into the central app log store (desktop parity with server). */
export function installAppLogCapture(
  store: AppLogStore,
  target: ConsoleLike = console,
): () => void {
  const installed = target as ConsoleLike & { __appLogCaptureInstalled?: boolean };
  if (installed.__appLogCaptureInstalled) return () => undefined;

  const originalWarn = target.warn.bind(target);
  const originalError = target.error.bind(target);

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
  installed.__appLogCaptureInstalled = true;

  return () => {
    target.warn = originalWarn;
    target.error = originalError;
    delete installed.__appLogCaptureInstalled;
  };
}
