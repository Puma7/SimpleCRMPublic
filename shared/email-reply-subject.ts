/** Antwort-Betreff: vorhandenes "Re:" (case-insensitiv) nicht doppeln. */
export function replySubject(subject: string | null | undefined): string {
  const raw = subject?.trim() ?? '';
  if (!raw) return 'Re:';
  return /^re:/i.test(raw) ? raw : `Re: ${raw}`;
}
