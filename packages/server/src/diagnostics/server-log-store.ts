/**
 * Central server log store for a "zero error culture": every warning/error that
 * reaches the server is captured into a bounded in-memory ring buffer and
 * appended to a JSONL file so it survives container restarts/rebuilds (the file
 * lives on a Docker volume). It is exposed read-only via the diagnostics API so
 * operators can copy/export all warnings and errors from the frontend.
 *
 * Logging must never throw, so all I/O is best-effort.
 */

export type ServerLogLevel = 'warn' | 'error' | 'fatal';

export type ServerLogEntry = {
  time: string;
  level: ServerLogLevel;
  message: string;
  source: string;
};

export type ServerLogStore = {
  capture(input: { level: ServerLogLevel; message: string; source?: string; time?: Date }): void;
  recent(options?: { level?: ServerLogLevel; limit?: number }): ServerLogEntry[];
  clear(): void;
  count(): number;
};

export type ServerLogFileSystem = {
  readFileSync(path: string, encoding: 'utf8'): string;
  appendFileSync(path: string, data: string): void;
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  existsSync(path: string): boolean;
  dirname(path: string): string;
};

export type CreateServerLogStoreOptions = {
  maxEntries?: number;
  filePath?: string;
  now?: () => Date;
  fs?: ServerLogFileSystem;
};

const DEFAULT_MAX_ENTRIES = 2000;
const LEVEL_RANK: Record<ServerLogLevel, number> = { warn: 1, error: 2, fatal: 3 };

export function createServerLogStore(options: CreateServerLogStoreOptions = {}): ServerLogStore {
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  const now = options.now ?? (() => new Date());
  const filePath = options.filePath?.trim() || undefined;
  const fs = options.fs ?? (filePath ? nodeFileSystem() : undefined);

  const buffer: ServerLogEntry[] = [];
  let appendsSinceTrim = 0;

  if (filePath && fs) {
    loadFromFile(buffer, maxEntries, filePath, fs);
  }

  function persist(entry: ServerLogEntry): void {
    if (!filePath || !fs) return;
    try {
      ensureDir(fs, filePath);
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
      appendsSinceTrim += 1;
      // Keep the file bounded without rewriting on every append.
      if (appendsSinceTrim >= maxEntries) {
        fs.writeFileSync(filePath, buffer.map((item) => JSON.stringify(item)).join('\n') + (buffer.length ? '\n' : ''));
        appendsSinceTrim = 0;
      }
    } catch {
      /* logging must never throw */
    }
  }

  return {
    capture(input) {
      const message = redactSecrets(String(input.message ?? '').slice(0, 4000));
      if (!message) return;
      const entry: ServerLogEntry = {
        time: (input.time ?? now()).toISOString(),
        level: input.level,
        message,
        source: input.source?.trim() || 'app',
      };
      buffer.push(entry);
      if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries);
      persist(entry);
    },
    recent(opts) {
      const minRank = opts?.level ? LEVEL_RANK[opts.level] : LEVEL_RANK.warn;
      const filtered = buffer.filter((entry) => LEVEL_RANK[entry.level] >= minRank);
      const limit = normalizeLimit(opts?.limit, filtered.length);
      return filtered.slice(Math.max(0, filtered.length - limit));
    },
    clear() {
      buffer.length = 0;
      appendsSinceTrim = 0;
      if (filePath && fs) {
        try {
          ensureDir(fs, filePath);
          fs.writeFileSync(filePath, '');
        } catch {
          /* best effort */
        }
      }
    },
    count() {
      return buffer.length;
    },
  };
}

/** Strips obvious secrets (passwords/tokens) so they never land in the log buffer. */
export function redactSecrets(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/("?(?:password|passwd|secret|token|api[_-]?key)"?\s*[:=]\s*)("?)([^"\s,}]+)/gi, '$1$2[redacted]');
}

function loadFromFile(
  buffer: ServerLogEntry[],
  maxEntries: number,
  filePath: string,
  fs: ServerLogFileSystem,
): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = parseEntry(trimmed);
      if (entry) buffer.push(entry);
    }
    if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries);
  } catch {
    /* corrupt/unreadable log file must not block startup */
  }
}

function parseEntry(line: string): ServerLogEntry | null {
  try {
    const value = JSON.parse(line) as Partial<ServerLogEntry>;
    if (!value || typeof value.message !== 'string') return null;
    if (value.level !== 'warn' && value.level !== 'error' && value.level !== 'fatal') return null;
    return {
      time: typeof value.time === 'string' ? value.time : new Date(0).toISOString(),
      level: value.level,
      message: value.message,
      source: typeof value.source === 'string' ? value.source : 'app',
    };
  } catch {
    return null;
  }
}

function ensureDir(fs: ServerLogFileSystem, filePath: string): void {
  const dir = fs.dirname(filePath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_ENTRIES;
  return Math.min(Math.floor(value), 50_000);
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 5000);
}

function nodeFileSystem(): ServerLogFileSystem {
  const fsModule = require('node:fs') as typeof import('node:fs');
  const pathModule = require('node:path') as typeof import('node:path');
  return {
    readFileSync: (path, encoding) => fsModule.readFileSync(path, encoding),
    appendFileSync: (path, data) => fsModule.appendFileSync(path, data),
    writeFileSync: (path, data) => fsModule.writeFileSync(path, data),
    mkdirSync: (path, opts) => { fsModule.mkdirSync(path, opts); },
    existsSync: (path) => fsModule.existsSync(path),
    dirname: (path) => pathModule.dirname(path),
  };
}
