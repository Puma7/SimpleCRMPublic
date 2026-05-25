export type EmailUiMode = "classic" | "beta"

const LS_KEY = "email:uiMode"

export function readEmailUiMode(): EmailUiMode {
  if (typeof window === "undefined") return "classic"
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return raw === "beta" ? "beta" : "classic"
  } catch {
    return "classic"
  }
}

export function writeEmailUiMode(mode: EmailUiMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LS_KEY, mode)
  } catch {
    /* ignore */
  }
}
