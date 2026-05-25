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
import {
  DEFAULT_THEME_TOKENS,
  THEME_TOKENS_CHANGED,
  applyThemeTokens,
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

export function ThemeTokensProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokensState] = useState<ThemeTokenSettings>(() => readThemeTokens())

  const sync = useCallback(() => {
    const t = readThemeTokens()
    setTokensState(t)
    applyThemeTokens(t)
  }, [])

  useEffect(() => {
    applyThemeTokens(tokens)
    const onChange = () => sync()
    window.addEventListener(THEME_TOKENS_CHANGED, onChange)
    return () => window.removeEventListener(THEME_TOKENS_CHANGED, onChange)
  }, [tokens, sync])

  const setTokens = useCallback((next: ThemeTokenSettings) => {
    setThemeTokens(next)
    setTokensState(next)
  }, [])

  const patchTokens = useCallback((patch: Partial<ThemeTokenSettings>) => {
    setTokens({ ...readThemeTokens(), ...patch })
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
