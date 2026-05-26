import { buildRfc822FromStored } from './mail-rfc822-build';
import { normalizeRspamdBaseUrl } from '../../shared/rspamd-url';

export type RspamdCheckResult = {
  score: number | null;
  action: string | null;
  requiredScore: number | null;
  symbols: string[];
  error?: string;
};

type RspamdJson = {
  score?: number;
  action?: string;
  required_score?: number;
  symbols?: Record<string, { score?: number; options?: string[] }>;
};

/**
 * POST full message to Rspamd controller (/checkv2). Optional localhost daemon.
 */
export async function checkMessageWithRspamd(input: {
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  baseUrl: string;
  timeoutMs: number;
}): Promise<RspamdCheckResult> {
  const message = buildRfc822FromStored(input);
  if (!message) {
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: 'Keine Nachricht zum Prüfen',
    };
  }

  const normalized = normalizeRspamdBaseUrl(input.baseUrl);
  if (!normalized.ok) {
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: normalized.error,
    };
  }
  const url = `${normalized.baseUrl}/checkv2`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'message/rfc822',
      },
      body: new Uint8Array(message),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        score: null,
        action: null,
        requiredScore: null,
        symbols: [],
        error: `Rspamd HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }
    const data = (await res.json()) as RspamdJson;
    const symbols = data.symbols
      ? Object.entries(data.symbols)
          .filter(([, v]) => (v?.score ?? 0) > 0.01)
          .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
          .slice(0, 12)
          .map(([name, v]) => `${name}(${v?.score?.toFixed(2) ?? '?'})`)
      : [];
    return {
      score: typeof data.score === 'number' ? data.score : null,
      action: data.action ?? null,
      requiredScore: typeof data.required_score === 'number' ? data.required_score : null,
      symbols,
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === 'AbortError'
          ? 'Rspamd Timeout'
          : e.message
        : String(e);
    return {
      score: null,
      action: null,
      requiredScore: null,
      symbols: [],
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
