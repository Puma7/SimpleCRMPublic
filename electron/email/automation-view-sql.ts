/**
 * Plan 049: Warteschlangen der Teilautomatisierung als Ansichten. Eine Quelle
 * für Liste, Suche und die Zähler im Automatik-Cockpit (gleiche Zahlen).
 * Tabellen-Alias `m` = email_messages.
 */

/** „Wartet auf Freigabe“: KI-Entwürfe mit neutralem Freigabe-Zustand (wie im Posteingang). */
export const APPROVAL_PENDING_VIEW_SQL = `m.uid < 0 AND m.folder_kind = 'draft' AND m.approval_state = 'pending' AND (m.scheduled_send_at IS NULL OR m.scheduled_send_at = '')`;

/** „Versand blockiert“: vom Ausgang angehaltene Entwürfe. */
export const OUTBOUND_BLOCKED_VIEW_SQL = `m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1`;
