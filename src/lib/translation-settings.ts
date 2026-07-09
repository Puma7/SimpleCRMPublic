import { DEFAULT_LOCAL_LANGUAGE, DEFAULT_TARGET_LANGUAGES } from "@shared/translation-languages"

// Per-user translation preferences for the AI translate actions. Stored in
// localStorage: the local language (incoming → read) and the frequent target
// languages (outgoing → send). Kept client-side because it is a per-user UI
// preference; the language name string is what we hand to the model.
const STORAGE_KEY = "simplecrm.translationSettings.v1"

export type TranslationSettings = {
  localLanguage: string
  targetLanguages: string[]
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  localLanguage: DEFAULT_LOCAL_LANGUAGE,
  targetLanguages: DEFAULT_TARGET_LANGUAGES.map((l) => l.label),
}

export function getTranslationSettings(): TranslationSettings {
  if (typeof window === "undefined") return DEFAULT_TRANSLATION_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TRANSLATION_SETTINGS
    const parsed = JSON.parse(raw) as Partial<TranslationSettings>
    const localLanguage =
      typeof parsed.localLanguage === "string" && parsed.localLanguage.trim()
        ? parsed.localLanguage.trim()
        : DEFAULT_TRANSLATION_SETTINGS.localLanguage
    const targetLanguages = Array.isArray(parsed.targetLanguages)
      ? [...new Set(parsed.targetLanguages.map((s) => String(s).trim()).filter(Boolean))]
      : DEFAULT_TRANSLATION_SETTINGS.targetLanguages
    return {
      localLanguage,
      targetLanguages: targetLanguages.length > 0 ? targetLanguages : DEFAULT_TRANSLATION_SETTINGS.targetLanguages,
    }
  } catch {
    return DEFAULT_TRANSLATION_SETTINGS
  }
}

export function saveTranslationSettings(settings: TranslationSettings): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    // Let open components (compose/viewer) pick up the change within the session.
    window.dispatchEvent(new CustomEvent("simplecrm:translation-settings-changed"))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
