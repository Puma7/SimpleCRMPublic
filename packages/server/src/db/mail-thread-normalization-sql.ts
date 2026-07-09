/**
 * Canonical SQL that normalizes a Message-ID / In-Reply-To column for
 * reference-threading MATCHING. It MUST produce byte-identical output to the
 * JS `normalizeMessageId` in @simplecrm/core (trim → strip a SINGLE outer
 * `<`/`>` pair → lowercase); the sync resolver builds its IN-list from the JS
 * helper, so any divergence silently misses siblings and splits conversations.
 *
 * Both the resolver query (resolveReferenceThreadForSync) and the functional
 * indexes in migration 0025 call this so the query stays index-backed and the
 * two never drift. Using anchored `^<` / `>$` (not a blanket bracket strip)
 * mirrors the JS regex `/^<|>$/g`: e.g. `<<x@y>>` → `<x@y>` (outer pair only),
 * and `<a>b>` → `a>b` rather than collapsing to `ab`.
 *
 * `columnExpr` is embedded verbatim, so callers MUST pass a trusted column name
 * (e.g. 'message_id'), never user input.
 */
export function normalizedMessageIdSql(columnExpr: string): string {
  return `lower(regexp_replace(regexp_replace(btrim(coalesce(${columnExpr}, '')), '^<', ''), '>$', ''))`;
}
