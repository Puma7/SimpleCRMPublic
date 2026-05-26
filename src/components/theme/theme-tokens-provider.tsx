"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { UI_THEME_CHANGED, readUiTheme } from "@/lib/ui-theme"
import {
  DEFAULT_THEME_TOKENS,
  THEME_TOKENS_CHANGED,
  applyThemeTokens,
  clearThemeTokens,
  readThemeTokens,
  setThemeTokens,
  type ThemeTokenSettings,
} from "@/lib/theme-tokens"

type Ctx = {
  tokens: ThemeTokenSettings
  setTokens: (next: ThemeTokenSettings) => void
  patchTokens: (patch: Partial<ThemeTokenSettings>) => void
  resetTokens: () => void
}

const ThemeTokensContext = createContext<Ctx | null>(null)

function syncTokensToDocument(settings: ThemeTokenSettings): void {
  if (readUiTheme() === "beta") applyThemeTokens(settings)
  else clearThemeTokens()
}

export function ThemeTokensProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokensState] = useState<ThemeTokenSettings>(() => readThemeTokens())

  const syncAll = useCallback(() => {
    const t = readThemeTokens()
    setTokensState(t)
    syncTokensToDocument(t)
  }, [])

  useEffect(() => {
    syncAll()
    const onTokens = () => syncAll()
    const onShell = () => syncAll()
    window.addEventListener(THEME_TOKENS_CHANGED, onTokens)
    window.addEventListener(UI_THEME_CHANGED, onShell)
    return () => {
      window.removeEventListener(THEME_TOKENS_CHANGED, onTokens)
      window.removeEventListener(UI_THEME_CHANGED, onShell)
    }
  }, [syncAll])

  const setTokens = useCallback((next: ThemeTokenSettings) => {
    setThemeTokens(next)
    setTokensState(next)
    syncTokensToDocument(next)
  }, [])

  const patchTokens = useCallback((patch: Partial<ThemeTokenSettings>) => {
    const next = { ...readThemeTokens(), ...patch }
    setTokens(next)
  }, [setTokens])

  const resetTokens = useCallback(() => {
    setTokens({ ...DEFAULT_THEME_TOKENS })
  }, [setTokens])

  const value = useMemo(
    () => ({ tokens, setTokens, patchTokens, resetTokens }),
    [tokens, setTokens, patchTokens, resetTokens],
  )

  return <ThemeTokensContext.Provider value={value}>{children}</ThemeTokensContext.Provider>
}

export function useThemeTokens(): Ctx {
  const ctx = useContext(ThemeTokensContext)
  if (!ctx) throw new Error("useThemeTokens must be used within ThemeTokensProvider")
  return ctx
}
