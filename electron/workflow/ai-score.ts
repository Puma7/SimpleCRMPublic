/** Parse KI spam score: first integer 1–100 in model output. */
export function parseSpamScore(modelOutput: string): number {
  const text = modelOutput.trim();
  const direct = /^\s*(\d{1,3})\s*$/.exec(text);
  if (direct) return clampScore(Number(direct[1]));
  const found = text.match(/\b(\d{1,3})\b/);
  if (found) return clampScore(Number(found[1]));
  return 50;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, Math.round(n)));
}

export function formatMetadataForSpamPrompt(meta: {
  subject: string;
  snippet: string;
  from_address: string;
  to_address: string;
  cc_address: string;
  has_attachments: string;
  attachment_names: string;
  attachment_types: string;
}): string {
  return [
    `Betreff: ${meta.subject || '(leer)'}`,
    `Vorschau: ${meta.snippet || '(leer)'}`,
    `Von: ${meta.from_address || '(leer)'}`,
    `An: ${meta.to_address || '(leer)'}`,
    meta.cc_address ? `CC: ${meta.cc_address}` : null,
    `Anhänge: ${meta.has_attachments === 'true' ? 'ja' : 'nein'}`,
    meta.attachment_names ? `Anhang-Namen: ${meta.attachment_names}` : null,
    meta.attachment_types ? `Anhang-Typen: ${meta.attachment_types}` : null,
    '',
    'Hinweis: Der E-Mail-Volltext wurde aus Datenschutzgründen nicht übermittelt.',
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}
