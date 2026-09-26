/**
 * Kennzeichnung „gesendet von“ (Teilautomatisierung P3). Beide Editionen
 * bestimmen beim Übergang zu folder_kind 'sent', wer eine Mail verschickt
 * hat; die Oberfläche zeigt daraus Kennzeichen und die Ansicht „Gesendet (KI)“.
 */

export const SENT_BY_KINDS = ['human', 'ai_auto', 'ai_approved', 'workflow', 'relay'] as const;

/**
 * human       – ein Mensch hat geschrieben oder einen KI-Entwurf geändert
 * ai_auto     – KI-Entwurf automatisch von einem Workflow gesendet
 * ai_approved – KI-Entwurf, von einem Menschen unverändert freigegeben
 * workflow    – Automatik ohne KI (z. B. email.create_draft + send_draft)
 * relay       – externes System über das SMTP-Relay
 */
export type SentByKind = typeof SENT_BY_KINDS[number];

/** Mails dieser Herkunft zeigt die Ansicht „Gesendet (KI)“ (view-ID sent_ai). */
export const SENT_AI_VIEW_KINDS: readonly SentByKind[] = ['ai_auto', 'ai_approved', 'workflow'];

export const DRAFT_ORIGIN_KINDS = ['ai', 'workflow'] as const;
export type DraftOriginKind = typeof DRAFT_ORIGIN_KINDS[number];

export function isSentByKind(value: unknown): value is SentByKind {
  return typeof value === 'string' && (SENT_BY_KINDS as readonly string[]).includes(value);
}

export function isDraftOriginKind(value: unknown): value is DraftOriginKind {
  return typeof value === 'string' && (DRAFT_ORIGIN_KINDS as readonly string[]).includes(value);
}

/** Wer den Versand auslöst. */
export type SentByActor =
  /** Compose-Senden, „Später senden“, Freigabe „Jetzt senden“, „Ohne Ausgangsprüfung senden“. */
  | { kind: 'human'; userId: string; userLabel: string | null }
  /** Versand durch einen Workflow ohne menschlichen Akteur (Trusted Service). */
  | { kind: 'workflow'; workflowId: number | null; workflowName: string | null }
  | { kind: 'relay'; clientLabel: string | null };

export type SentProvenance = {
  kind: SentByKind;
  userId: string | null;
  workflowId: number | null;
  label: string | null;
  outboundReviewSkipped: boolean;
};

export function workflowSentByLabel(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed ? `Workflow „${trimmed}“` : null;
}

/**
 * Bestimmung beim Versand. Die Entwurfs-Herkunft (`draft_origin_*`) muss vor
 * dem Löschen der Planungsdaten gelesen sein.
 */
export function determineSentProvenance(input: {
  actor: SentByActor;
  draftOriginKind: string | null | undefined;
  draftOriginWorkflowId: number | null | undefined;
  draftOriginEdited: boolean;
  outboundReviewSkipped: boolean;
}): SentProvenance {
  const originAi = input.draftOriginKind === 'ai';
  const skipped = input.outboundReviewSkipped === true;
  if (input.actor.kind === 'relay') {
    return {
      kind: 'relay',
      userId: null,
      workflowId: null,
      label: input.actor.clientLabel?.trim() || null,
      outboundReviewSkipped: skipped,
    };
  }
  if (input.actor.kind === 'workflow') {
    const workflowId = input.actor.workflowId ?? input.draftOriginWorkflowId ?? null;
    return {
      kind: originAi ? 'ai_auto' : 'workflow',
      userId: null,
      workflowId,
      label: workflowSentByLabel(input.actor.workflowName),
      outboundReviewSkipped: skipped,
    };
  }
  // Ein unveränderter KI-Entwurf, den ein Mensch abschickt, ist „freigegeben“.
  const approved = originAi && !input.draftOriginEdited;
  return {
    kind: approved ? 'ai_approved' : 'human',
    userId: input.actor.userId,
    workflowId: approved ? input.draftOriginWorkflowId ?? null : null,
    label: input.actor.userLabel?.trim() || null,
    outboundReviewSkipped: skipped,
  };
}

/** Kurzes Kennzeichen in der Nachrichtenliste; null ⇒ kein Kennzeichen (Mensch, Altbestand). */
export function sentByBadgeLabel(kind: string | null | undefined): string | null {
  switch (kind) {
    case 'ai_auto':
      return 'KI';
    case 'ai_approved':
      return 'KI · freigegeben';
    case 'workflow':
      return 'Automatik';
    case 'relay':
      return 'Relay';
    default:
      return null;
  }
}

/** Zeile „Gesendet von …“ in der Leseansicht; null ⇒ keine Angabe (Altbestand). */
export function sentByDescription(input: {
  kind: string | null | undefined;
  label: string | null | undefined;
}): string | null {
  const label = input.label?.trim() || null;
  switch (input.kind) {
    case 'human':
      return label ? `Gesendet von: ${label}` : 'Gesendet von einem Menschen';
    case 'ai_auto':
      return label ? `Automatisch von KI gesendet (${label})` : 'Automatisch von KI gesendet';
    case 'ai_approved':
      return label ? `KI-Entwurf, freigegeben von ${label}` : 'KI-Entwurf, von einem Menschen freigegeben';
    case 'workflow':
      return label ? `Automatisch gesendet (${label})` : 'Automatisch von einem Workflow gesendet';
    case 'relay':
      return label ? `Über das SMTP-Relay gesendet (${label})` : 'Über das SMTP-Relay gesendet';
    default:
      return null;
  }
}
