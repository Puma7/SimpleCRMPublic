import {
  DEFAULT_THEME_TOKENS,
  applyThemeTokens,
  readThemeTokens,
  writeThemeTokens,
} from "@/lib/theme-tokens"

describe("theme-tokens", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-tokens-applied")
  })

  it("returns defaults when storage empty", () => {
    expect(readThemeTokens()).toEqual(DEFAULT_THEME_TOKENS)
  })

  it("persists and merges partial settings", () => {
    writeThemeTokens({ ...DEFAULT_THEME_TOKENS, accentHue: 120, density: "compact" })
    const t = readThemeTokens()
    expect(t.accentHue).toBe(120)
    expect(t.density).toBe("compact")
    expect(t.bgTone).toBe(DEFAULT_THEME_TOKENS.bgTone)
  })

  it("applyThemeTokens sets document attributes", () => {
    applyThemeTokens({ ...DEFAULT_THEME_TOKENS, colorMode: "light", sidebarMode: "rail" })
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("light")
    expect(document.documentElement.getAttribute("data-sidebar-mode")).toBe("rail")
    expect(document.documentElement.style.getPropertyValue("--crm-background")).toContain("oklch")
  })
})
