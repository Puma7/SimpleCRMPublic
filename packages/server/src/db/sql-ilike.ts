/** Escape `%`, `_` and `\` for safe use inside a SQL ILIKE pattern. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Build a case-insensitive contains pattern: `%term%` with wildcards escaped. */
export function ilikeContainsPattern(value: string): string {
  return `%${escapeIlikePattern(value)}%`;
}
