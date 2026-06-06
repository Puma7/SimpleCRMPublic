"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { translations, type TranslationKey } from "./translations"

export type Language = "de" | "en"
export const LANGUAGES: readonly Language[] = ["de", "en"] as const
export const DEFAULT_LANGUAGE: Language = "de"
const STORAGE_KEY = "simplecrm.language.v1"

export type TranslateParams = Record<string, string | number>
export type TranslateFn = (key: TranslationKey, params?: TranslateParams) => string

type I18nContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  t: TranslateFn
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function translate(language: Language, key: TranslationKey, params?: TranslateParams): string {
  const entry = translations[key]
  let text = entry ? (entry[language] ?? entry.de) : key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value))
    }
  }
  return text
}

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "de" || stored === "en") return stored
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_LANGUAGE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage())

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* localStorage unavailable */
    }
    if (typeof document !== "undefined") document.documentElement.lang = next
  }, [])

  const t = useCallback<TranslateFn>(
    (key, params) => translate(language, key, params),
    [language],
  )

  const value = useMemo<I18nContextValue>(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * Returns the translation helpers. When used outside an I18nProvider (e.g. in
 * isolated component tests), it falls back to the default language so migrated
 * components keep rendering without a provider.
 */
export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  return {
    language: DEFAULT_LANGUAGE,
    setLanguage: () => undefined,
    t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
  }
}

export type { TranslationKey }
