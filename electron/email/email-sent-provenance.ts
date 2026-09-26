/**
 * Teilautomatisierung P3 (Desktop): Herkunft eines Entwurfs und Kennzeichnung
 * „gesendet von“. Bewusst getrennt von markDraftAsSent: finalizeSentDraft ruft
 * recordSentProvenance direkt nach dem Übergang zu folder_kind 'sent' auf.
 */
import { EMAIL_MESSAGES_TABLE, EMAIL_WORKFLOWS_TABLE, SYNC_INFO_TABLE, USERS_TABLE } from '../database-schema';
import { getDb, getSyncInfo } from '../sqlite-service';
import { outboundReviewApprovedKey } from './outbound-approval';
import {
  determineSentProvenance,
  draftContentChanged,
  type DraftContentSnapshot,
  type DraftOriginKind,
  type SentProvenance,
} from '../../packages/core/src/email/sent-provenance';
import { outboundReviewSkippedKey } from '../../packages/core/src/email/outbound-review-skip';

/** Wer den Versand auslöst: ein Mensch (Sitzung/Planer) oder ein Workflow ohne Menschen. */
export type DesktopSentByActor = { kind: 'human'; userId: string } | { kind: 'workflow' };

/**
 * Ein Workflow-Knoten hat den Entwurf angelegt (KI ⇒ 'ai', sonst 'workflow').
 * onlyIfUnset: send_draft/release_outbound überschreiben eine vorhandene
 * Herkunft (etwa 'ai' vom Entwurfs-Knoten) nicht.
 */
export function markDraftOrigin(
  draftId: number,
  kind: DraftOriginKind,
  workflowId: number | null,
  opts?: { onlyIfUnset?: boolean },
): void {
  try {
    getDb()
      .prepare(
        `UPDATE ${EMAIL_MESSAGES_TABLE}
         SET draft_origin_kind = ?, draft_origin_workflow_id = ?
         WHERE id = ? AND uid < 0${opts?.onlyIfUnset ? ' AND draft_origin_kind IS NULL' : ''}`,
      )
      .run(kind, workflowId, draftId);
  } catch (error) {
    // Buchhaltung für die Kennzeichnung — darf den Workflow nie abbrechen.
    console.warn('[email] draft origin not recorded:', error);
  }
}

/** Ein Mensch hat den Inhalt des Entwurfs geändert (Autosave/Speichern im Entwurfsfenster). */
export function markDraftOriginEdited(draftId: number): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET draft_origin_edited = 1
       WHERE id = ? AND uid < 0 AND draft_origin_kind IS NOT NULL`,
    )
    .run(draftId);
}

type DraftContentRow = {
  account_id: number | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_json: string | null;
  cc_json: string | null;
  bcc_json: string | null;
  draft_attachment_paths_json: string | null;
};

function attachmentPathsFromJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Inhalt eines lokalen Entwurfs mit KI-/Workflow-Herkunft, der noch nicht als
 * bearbeitet gilt; sonst null (dann ist nichts zu vergleichen).
 */
export function readDraftOriginContent(draftId: number): DraftContentSnapshot | null {
  try {
    const row = getDb()
      .prepare(
        `SELECT * FROM ${EMAIL_MESSAGES_TABLE}
         WHERE id = ? AND uid < 0 AND draft_origin_kind IS NOT NULL AND COALESCE(draft_origin_edited, 0) = 0`,
      )
      .get(draftId) as (DraftContentRow & Record<string, unknown>) | undefined;
    if (!row) return null;
    return {
      subject: row.subject,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      to: row.to_json,
      cc: row.cc_json,
      bcc: row.bcc_json ?? null,
      attachmentPaths: attachmentPathsFromJson(row.draft_attachment_paths_json ?? null),
      accountId: row.account_id,
    };
  } catch (error) {
    console.warn('[email] draft origin content not read:', error);
    return null;
  }
}

/** Nach dem Speichern: nur ein echter Unterschied zum vorherigen Inhalt markiert „bearbeitet“. */
export function markDraftOriginEditedIfChanged(draftId: number, before: DraftContentSnapshot | null): void {
  if (!before) return;
  const after = readDraftOriginContent(draftId);
  if (after && draftContentChanged(before, after)) markDraftOriginEdited(draftId);
}

function lookupName(sql: string, id: string | number | null): string | null {
  if (id == null) return null;
  try {
    const row = getDb().prepare(sql).get(id) as { name?: string | null } | undefined;
    return row?.name?.trim() || null;
  } catch {
    // Tabelle fehlt (Tests, sehr alte Datenbank): nur der Name fehlt dann.
    return null;
  }
}

/**
 * Bestimmt und speichert die Kennzeichnung beim Versand. Liefert sie für
 * Folgeschritte (Hook-Punkt nach dem Versand) zurück.
 */
export function recordSentProvenance(draftId: number, actor: DesktopSentByActor): SentProvenance | null {
  // Läuft nach dem SMTP-Commit: ein Fehler hier darf den Versand nicht als
  // gescheitert melden — die Mail ist raus, es fehlt dann nur das Kennzeichen.
  try {
    return writeSentProvenance(draftId, actor);
  } catch (error) {
    console.warn('[email] sent-by provenance not recorded:', error);
    return null;
  }
}

function writeSentProvenance(draftId: number, actor: DesktopSentByActor): SentProvenance | null {
  const row = getDb()
    .prepare(
      `SELECT draft_origin_kind, draft_origin_workflow_id, draft_origin_edited
       FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
    )
    .get(draftId) as {
      draft_origin_kind: string | null;
      draft_origin_workflow_id: number | null;
      draft_origin_edited: number | null;
    } | undefined;
  if (!row) return null;

  const skippedMarker = getSyncInfo(outboundReviewSkippedKey(draftId));
  const skipped = Boolean(skippedMarker) && skippedMarker === getSyncInfo(outboundReviewApprovedKey(draftId));
  const provenance = determineSentProvenance({
    actor: actor.kind === 'human'
      ? {
          kind: 'human',
          userId: actor.userId,
          userLabel: lookupName(`SELECT display_name AS name FROM ${USERS_TABLE} WHERE id = ?`, actor.userId),
        }
      : {
          kind: 'workflow',
          workflowId: null,
          workflowName: lookupName(
            `SELECT name FROM ${EMAIL_WORKFLOWS_TABLE} WHERE id = ?`,
            row.draft_origin_workflow_id,
          ),
        },
    draftOriginKind: row.draft_origin_kind,
    draftOriginWorkflowId: row.draft_origin_workflow_id,
    draftOriginEdited: (row.draft_origin_edited ?? 0) > 0,
    outboundReviewSkipped: skipped,
  });

  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET sent_by_kind = ?, sent_by_user_id = ?, sent_by_workflow_id = ?, sent_by_label = ?,
           sent_outbound_review_skipped = ?
       WHERE id = ?`,
    )
    .run(
      provenance.kind,
      provenance.userId,
      provenance.workflowId,
      provenance.label,
      provenance.outboundReviewSkipped ? 1 : 0,
      draftId,
    );
  getDb().prepare(`DELETE FROM ${SYNC_INFO_TABLE} WHERE key = ?`).run(outboundReviewSkippedKey(draftId));
  return provenance;
}
