import fs from 'node:fs';
import path from 'node:path';

export type AppLogLevel = 'info' | 'warn' | 'error' | 'fatal';

export type AppLogEntry = {
  time: string;
  level: AppLogLevel;
  message: string;
  source: string;
};

export type AppLogStore = {
  capture(input: { level: AppLogLevel; message: string; source?: string; time?: Date }): void;
  recent(options?: { level?: AppLogLevel; limit?: number }): AppLogEntry[];
  selfTest(): number;
  clear(): void;
  count(): number;
};

const DEFAULT_MAX_ENTRIES = 2000;
const LEVEL_RANK: Record<AppLogLevel, number> = { info: 0, warn: 1, error: 2, fatal: 3 };

export function redactSecrets(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/("?(?:password|passwd|secret|token|api[_-]?key)"?\s*[:=]\s*)("?)([^"\s,}]+)/gi, '$1$2[redacted]');
}

export function createAppLogStore(options: {
  maxEntries?: number;
  filePath?: string;
  now?: () => Date;
} = {}): AppLogStore {
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  const now = options.now ?? (() => new Date());
  const filePath = options.filePath?.trim() || undefined;
  const buffer: AppLogEntry[] = [];
  let appendsSinceTrim = 0;

  if (filePath) {
    loadFromFile(buffer, maxEntries, filePath);
  }

  function persist(entry: AppLogEntry): void {
    if (!filePath) return;
    try {
      ensureDir(filePath);
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
      appendsSinceTrim += 1;
      if (appendsSinceTrim >= maxEntries) {
        fs.writeFileSync(
          filePath,
          buffer.map((item) => JSON.stringify(item)).join('\n') + (buffer.length ? '\n' : ''),
        );
        appendsSinceTrim = 0;
      }
    } catch {
      /* logging must never throw */
    }
  }

  function captureEntry(input: {
    level: AppLogLevel;
    message: string;
    source?: string;
    time?: Date;
  }): void {
    const message = redactSecrets(String(input.message ?? '').slice(0, 4000));
    if (!message) return;
    const entry: AppLogEntry = {
      time: (input.time ?? now()).toISOString(),
      level: input.level,
      message,
      source: input.source?.trim() || 'app',
    };
    buffer.push(entry);
    if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries);
    persist(entry);
  }

  return {
    capture: captureEntry,
    selfTest() {
      const levels: AppLogLevel[] = ['info', 'warn', 'error'];
      for (const level of levels) {
        captureEntry({
          level,
          message: `App-Log Selbsttest (${level}) – Erfassung über Diagnose bestätigt.`,
          source: 'self-test',
        });
      }
      return levels.length;
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
      if (filePath) {
        try {
          ensureDir(filePath);
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

function loadFromFile(buffer: AppLogEntry[], maxEntries: number, filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value = JSON.parse(trimmed) as Partial<AppLogEntry>;
        if (!value || typeof value.message !== 'string') continue;
        if (value.level !== 'info' && value.level !== 'warn' && value.level !== 'error' && value.level !== 'fatal') {
          continue;
        }
        buffer.push({
          time: typeof value.time === 'string' ? value.time : new Date(0).toISOString(),
          level: value.level,
          message: value.message,
          source: typeof value.source === 'string' ? value.source : 'app',
        });
      } catch {
        /* skip bad line */
      }
    }
    if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries);
  } catch {
    /* corrupt file must not block startup */
  }
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
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

let singleton: AppLogStore | null = null;

export function getAppLogStore(filePath?: string): AppLogStore {
  if (!singleton) {
    singleton = createAppLogStore({ filePath });
  }
  return singleton;
}

export function resetAppLogStoreForTests(): void {
  singleton = null;
}
