/**
 * Local calendar date 'YYYY-MM-DD'. Task due dates are stored as local dates
 * (date inputs, calendar), so "today" must not come from toISOString() (UTC),
 * which is still yesterday shortly after local midnight.
 */
export function localDateKey(date: Date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Local date `days` calendar days from `now` (DST-safe, unlike adding 24h steps). */
export function localDateKeyInDays(days: number, now: Date = new Date()): string {
  return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}
