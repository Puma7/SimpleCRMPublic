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
  UI_THEME_CHANGED,
  applyUiTheme,
  readUiTheme,
  setUiTheme,
  type UiTheme,
} from "@/lib/ui-theme"

type UiThemeContextValue = {
  theme: UiTheme
  setTheme: (theme: UiTheme) => void
}

const UiThemeContext = createContext<UiThemeContextValue | null>(null)

export function UiThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>("classic")

  const syncFromStorage = useCallback(() => {
    const t = readUiTheme()
    setThemeState(t)
    applyUiTheme(t)
  }, [])

  useEffect(() => {
    syncFromStorage()
    const onThemeChanged = () => syncFromStorage()
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "simplecrm:uiTheme" && e.key !== "email:uiMode") return
      syncFromStorage()
    }
    window.addEventListener(UI_THEME_CHANGED, onThemeChanged)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(UI_THEME_CHANGED, onThemeChanged)
      window.removeEventListener("storage", onStorage)
    }
  }, [syncFromStorage])

  const setTheme = useCallback((t: UiTheme) => {
    setUiTheme(t)
    setThemeState(t)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return (
    <UiThemeContext.Provider value={value}>
      <div data-ui-theme-active={theme}>{children}</div>
    </UiThemeContext.Provider>
  )
}

export function useUiTheme(): UiThemeContextValue {
  const ctx = useContext(UiThemeContext)
  if (!ctx) throw new Error("useUiTheme must be used within UiThemeProvider")
  return ctx
}
