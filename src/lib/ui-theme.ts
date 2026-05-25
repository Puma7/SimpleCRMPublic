export type UiTheme = "classic" | "beta"

const KEY = "simplecrm:uiTheme"
const LEGACY_KEY = "email:uiMode"

export const UI_THEME_CHANGED = "simplecrm:ui-theme-changed"

export function readUiTheme(): UiTheme {
  if (typeof window === "undefined") return "classic"
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === "beta" || raw === "classic") return raw
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy === "beta") return "beta"
    return "classic"
  } catch {
    return "classic"
  }
}

export function writeUiTheme(theme: UiTheme): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, theme)
    window.localStorage.setItem(LEGACY_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === "undefined") return
  document.documentElement.setAttribute("data-ui-theme", theme)
  if (theme === "beta") document.documentElement.classList.add("dark")
  else document.documentElement.classList.remove("dark")
}

export function setUiTheme(theme: UiTheme): void {
  writeUiTheme(theme)
  applyUiTheme(theme)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UI_THEME_CHANGED, { detail: theme }))
  }
}
