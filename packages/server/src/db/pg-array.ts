import { sql, type RawBuilder } from 'kysely';

/**
 * Values for native Postgres array columns (text[], bigint[]).
 *
 * createJsonbArrayPlugin turns every JS array parameter into a JSON string,
 * because jsonb columns reject Postgres array literals. A native array column
 * rejects JSON the other way round ("malformed array literal"). So a native
 * array is never passed as a JS array: these helpers pass one Postgres array
 * literal string (`{"a","b"}`), which the plugin leaves alone, with an
 * explicit cast.
 */
export function pgArrayLiteral(values: readonly (string | number)[]): string {
  const items = values.map((value) => {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new Error(`not an integer array element: ${value}`);
      return String(value);
    }
    return `"${value.replace(/[\\"]/g, '\\$&')}"`;
  });
  return `{${items.join(',')}}`;
}

/** A text[] value for inserts, updates and comparisons. */
export function pgTextArray(values: readonly string[]): RawBuilder<string[]> {
  return sql<string[]>`${pgArrayLiteral(values)}::text[]`;
}

/** A bigint[] value (safe integers only). */
export function pgBigintArray(values: readonly number[]): RawBuilder<number[]> {
  return sql<number[]>`${pgArrayLiteral(values)}::bigint[]`;
}
