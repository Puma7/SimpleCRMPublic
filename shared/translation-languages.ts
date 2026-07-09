// Shared defaults for the AI translation feature. The `label` (a German
// language name) is what we send to the model as the target language and what
// the UI shows. Kept here so a future settings surface can make the list
// configurable without touching the transport wiring.

export type TranslationLanguage = { code: string; label: string };

/** Language the user reads incoming customer text in (viewer → local). */
export const DEFAULT_LOCAL_LANGUAGE = 'Deutsch';

/** Frequent target languages for outgoing text (compose → customer language). */
export const DEFAULT_TARGET_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'en', label: 'Englisch' },
  { code: 'it', label: 'Italienisch' },
  { code: 'es', label: 'Spanisch' },
  { code: 'fr', label: 'Französisch' },
  { code: 'tr', label: 'Türkisch' },
] as const;
