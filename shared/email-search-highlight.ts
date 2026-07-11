import { parseMailSearchQuery } from '../packages/core/src/email/search-query';

/**
 * Treffer-Markierung in Suchergebnissen — Implementierung lebt in
 * @simplecrm/core (packages/core/src/email/search-highlight), damit
 * Desktop-Engine, Server-Port und Frontend dieselbe Logik teilen.
 * Dieses Modul bleibt der stabile @shared-Importpfad fuer Renderer/Electron.
 */
export {
  buildLikeSearchSnippet,
  highlightNeedlesInText,
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  splitHighlighted,
  type HighlightedPart,
} from '../packages/core/src/email/search-highlight';

/** Suchbegriffe (Phrasen + Terme) einer Query — für clientseitiges Markieren. */
export function searchNeedlesFromQuery(raw: string): string[] {
  const parsed = parseMailSearchQuery(raw);
  return [...parsed.phrases, ...parsed.terms].filter((n) => n.length > 0);
}
