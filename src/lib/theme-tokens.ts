/**
 * Theme token preferences (EDITMODE) — persisted in localStorage.
 * Drives OKLCH CSS variables on <html> via applyThemeTokens().
 */

export type ColorMode = "dark" | "light"
export type BgTone = "cool" | "neutral" | "warm"
export type Density = "compact" | "comfort" | "cozy"
export type RadiusScale = "sharp" | "medium" | "pill"
export type SidebarMode = "rail" | "full"
export type FontFamilyId = "geist" | "inter-tight" | "ibm-plex" | "space-grotesk"

export type ThemeTokenSettings = {
  colorMode: ColorMode
  bgTone: BgTone
  accentHue: number
  accentChroma: number
  density: Density
  radius: RadiusScale
  sidebarMode: SidebarMode
  fontFamily: FontFamilyId
}

export const THEME_TOKENS_KEY = "simplecrm:themeTokens"
export const THEME_TOKENS_CHANGED = "simplecrm:theme-tokens-changed"

export const DEFAULT_THEME_TOKENS: ThemeTokenSettings = {
  colorMode: "dark",
  bgTone: "neutral",
  accentHue: 75,
  accentChroma: 0.18,
  density: "comfort",
  radius: "medium",
  sidebarMode: "full",
  fontFamily: "geist",
}

const BG_HUE: Record<BgTone, number> = {
  cool: 250,
  neutral: 80,
  warm: 55,
}

const RADIUS_REM: Record<RadiusScale, string> = {
  sharp: "0.25rem",
  medium: "0.5rem",
  pill: "9999px",
}

const DENSITY_SCALE: Record<Density, string> = {
  compact: "0.88",
  comfort: "1",
  cozy: "1.12",
}

const FONT_STACK: Record<FontFamilyId, string> = {
  geist: "'Geist Sans', system-ui, sans-serif",
  "inter-tight": "'Inter Tight', system-ui, sans-serif",
  "ibm-plex": "'IBM Plex Sans', system-ui, sans-serif",
  "space-grotesk": "'Space Grotesk', system-ui, sans-serif",
}

export const ACCENT_SWATCHES = [
  { label: "Bernstein", hue: 75 },
  { label: "Koralle", hue: 35 },
  { label: "Smaragd", hue: 155 },
  { label: "Ozean", hue: 230 },
  { label: "Violett", hue: 300 },
  { label: "Signal", hue: 15 },
] as const

export function readThemeTokens(): ThemeTokenSettings {
  if (typeof window === "undefined") return { ...DEFAULT_THEME_TOKENS }
  try {
    const raw = window.localStorage.getItem(THEME_TOKENS_KEY)
    if (!raw) return { ...DEFAULT_THEME_TOKENS }
    const parsed = JSON.parse(raw) as Partial<ThemeTokenSettings>
    return { ...DEFAULT_THEME_TOKENS, ...parsed }
  } catch {
    return { ...DEFAULT_THEME_TOKENS }
  }
}

export function writeThemeTokens(settings: ThemeTokenSettings): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(THEME_TOKENS_KEY, JSON.stringify(settings))
    window.dispatchEvent(
      new CustomEvent(THEME_TOKENS_CHANGED, { detail: settings }),
    )
  } catch {
    /* ignore */
  }
}

function elevatedBg(mode: ColorMode, tone: BgTone): string {
  const h = BG_HUE[tone]
  return mode === "dark" ? `oklch(0.20 0.008 ${h})` : `oklch(0.96 0.01 ${h})`
}

function baseBg(mode: ColorMode, tone: BgTone): string {
  const h = BG_HUE[tone]
  return mode === "dark" ? `oklch(0.16 0.006 ${h})` : `oklch(0.98 0.008 ${h})`
}

function fg(mode: ColorMode): string {
  return mode === "dark" ? "oklch(0.94 0.01 80)" : "oklch(0.22 0.02 80)"
}

function mutedFg(mode: ColorMode): string {
  return mode === "dark" ? "oklch(0.62 0.02 80)" : "oklch(0.48 0.02 80)"
}

function primaryColor(mode: ColorMode, hue: number, chroma: number): string {
  return mode === "dark"
    ? `oklch(0.82 ${chroma} ${hue})`
    : `oklch(0.52 ${chroma * 0.9} ${hue})`
}

function primaryFg(mode: ColorMode, tone: BgTone): string {
  return mode === "dark" ? baseBg("dark", tone) : "oklch(0.98 0.01 80)"
}

/** Apply semantic CRM tokens + layout attributes on documentElement. */
const CRM_INLINE_PROPS = [
  "--crm-background",
  "--crm-foreground",
  "--crm-card",
  "--crm-card-foreground",
  "--crm-muted",
  "--crm-muted-foreground",
  "--crm-border",
  "--crm-primary",
  "--crm-primary-foreground",
  "--crm-accent",
  "--crm-ring",
  "--crm-destructive",
  "--crm-sidebar",
  "--crm-sidebar-foreground",
  "--crm-sidebar-accent",
  "--crm-sidebar-border",
  "--crm-glow-accent",
  "--crm-shadow-sm",
  "--crm-shadow-md",
  "--radius",
  "--density-scale",
  "--font-sans-active",
  "--font-display-serif",
  "--font-label-mono",
] as const

/** Remove OKLCH overrides (classic shell / HSL fallback). */
export function clearThemeTokens(): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.removeAttribute("data-tokens-applied")
  root.removeAttribute("data-color-mode")
  root.removeAttribute("data-bg-tone")
  root.removeAttribute("data-density")
  root.removeAttribute("data-sidebar-mode")
  root.removeAttribute("data-font-family")
  for (const prop of CRM_INLINE_PROPS) {
    root.style.removeProperty(prop)
  }
}

export function applyThemeTokens(settings: ThemeTokenSettings): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const mode = settings.colorMode
  const tone = settings.bgTone
  const hue = settings.accentHue
  const chroma = Math.max(0, Math.min(0.28, settings.accentChroma))

  root.setAttribute("data-tokens-applied", "true")
  root.setAttribute("data-color-mode", mode)
  root.setAttribute("data-bg-tone", tone)
  root.setAttribute("data-density", settings.density)
  root.setAttribute("data-sidebar-mode", settings.sidebarMode)
  root.setAttribute("data-font-family", settings.fontFamily)

  if (mode === "dark") root.classList.add("dark")
  else root.classList.remove("dark")

  const style = root.style
  style.setProperty("--crm-background", baseBg(mode, tone))
  style.setProperty("--crm-foreground", fg(mode))
  style.setProperty("--crm-card", elevatedBg(mode, tone))
  style.setProperty("--crm-card-foreground", fg(mode))
  style.setProperty("--crm-muted", elevatedBg(mode, tone))
  style.setProperty("--crm-muted-foreground", mutedFg(mode))
  style.setProperty("--crm-border", mode === "dark" ? `oklch(0.28 0.01 ${BG_HUE[tone]})` : `oklch(0.88 0.01 ${BG_HUE[tone]})`)
  style.setProperty("--crm-primary", primaryColor(mode, hue, chroma))
  style.setProperty("--crm-primary-foreground", primaryFg(mode, tone))
  style.setProperty("--crm-accent", primaryColor(mode, hue, chroma * 0.35))
  style.setProperty("--crm-ring", primaryColor(mode, hue, chroma))
  style.setProperty("--crm-destructive", "oklch(0.58 0.22 25)")
  style.setProperty("--crm-sidebar", mode === "dark" ? `oklch(0.13 0.006 ${BG_HUE[tone]})` : `oklch(0.95 0.008 ${BG_HUE[tone]})`)
  style.setProperty("--crm-sidebar-foreground", mutedFg(mode))
  style.setProperty("--crm-sidebar-accent", elevatedBg(mode, tone))
  style.setProperty("--crm-sidebar-border", style.getPropertyValue("--crm-border"))

  style.setProperty("--radius", RADIUS_REM[settings.radius])
  style.setProperty("--density-scale", DENSITY_SCALE[settings.density])
  style.setProperty("--font-sans-active", FONT_STACK[settings.fontFamily])
  style.setProperty("--font-display-serif", "'Georgia', 'Times New Roman', serif")
  style.setProperty("--font-label-mono", "'Geist Mono', ui-monospace, monospace")

  const glow = primaryColor(mode, hue, chroma)
  style.setProperty("--crm-glow-accent", `0 0 24px color-mix(in oklch, ${glow} 45%, transparent)`)
  style.setProperty("--crm-shadow-sm", mode === "dark" ? "0 1px 2px oklch(0 0 0 / 0.35)" : "0 1px 2px oklch(0 0 0 / 0.06)")
  style.setProperty(
    "--crm-shadow-md",
    mode === "dark"
      ? `0 4px 16px oklch(0 0 0 / 0.4), var(--crm-glow-accent)`
      : "0 4px 12px oklch(0 0 0 / 0.08)",
  )
}

export function setThemeTokens(settings: ThemeTokenSettings): void {
  writeThemeTokens(settings)
}
