export function normalizeClassificationLabel(output: string): string {
  return output.trim().split(/\s+/)[0]?.trim() ?? '';
}

/** Parses model output "Kategorie|Sicherheit" or plain label. */
export function parseClassificationOutput(output: string): {
  label: string;
  confidence: number | null;
} {
  const trimmed = output.trim();
  const pipeIndex = trimmed.indexOf('|');
  const labelPart = pipeIndex >= 0 ? trimmed.slice(0, pipeIndex) : trimmed;
  const label = normalizeClassificationLabel(labelPart);
  const confidenceSource =
    pipeIndex >= 0 ? trimmed.slice(pipeIndex + 1) : trimmed.slice(label.length);
  const match = confidenceSource.match(/\d{1,3}/);
  const confidence = match ? Math.max(0, Math.min(100, Number(match[0]))) : null;
  return { label, confidence };
}

export function parseCannedPickNumber(output: string, max: number): number {
  const match = output.trim().match(/\d+/);
  if (!match) return 0;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value < 1 || value > max) return 0;
  return value;
}

export function classificationPrompt(
  labels: readonly string[],
  text: string,
): string {
  return [
    `Klassifiziere die E-Mail in genau eine Kategorie: ${labels.join(', ')}.`,
    'Antworte ausschließlich im Format "Kategorie|Sicherheit", wobei Sicherheit eine ganze Zahl von 0 bis 100 ist',
    '(wie sicher du dir bei der Kategorie bist), z. B. "Rechnung|85". Keine weiteren Worte.',
    '',
    text,
  ].join('\n');
}
