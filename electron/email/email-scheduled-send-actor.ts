/**
 * C-A2 (G6): Wer einen zeitversetzten Versand geplant, erneut angestossen oder
 * freigegeben hat. Der Hintergrundversand prueft vor SMTP, ob diese Person das
 * Konto noch schreibend nutzen darf. Ohne Migration in sync_info (Muster:
 * outbound_review_approved:<id>). Fehlt der Schluessel (Altbestand, Workflow),
 * laeuft der Versand wie bisher.
 */
import { SYNC_INFO_TABLE } from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';

export const SCHEDULED_SEND_ACTOR_PREFIX = 'scheduled_send_actor:';

export function scheduledSendActorKey(draftId: number): string {
  return `${SCHEDULED_SEND_ACTOR_PREFIX}${draftId}`;
}

export function recordScheduledSendActor(draftId: number, actor: { userId: string }): void {
  setSyncInfo(scheduledSendActorKey(draftId), JSON.stringify({ userId: actor.userId }));
}

/**
 * undefined: kein Akteur gespeichert. null: Eintrag vorhanden, aber unlesbar
 * (der Aufrufer behandelt das wie einen entzogenen Zugriff).
 */
export function readScheduledSendActor(draftId: number): { userId: string } | null | undefined {
  const raw = getSyncInfo(scheduledSendActorKey(draftId));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown };
    return typeof parsed?.userId === 'string' && parsed.userId ? { userId: parsed.userId } : null;
  } catch {
    return null;
  }
}

export function clearScheduledSendActor(...draftIds: number[]): void {
  const del = getDb().prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`);
  for (const id of draftIds) del.run(scheduledSendActorKey(id));
}
