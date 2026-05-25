import { DEFAULT_THEME_TOKENS, applyThemeTokens } from "@/lib/theme-tokens"
import { setUiTheme } from "@/lib/ui-theme"

describe("ui-theme shell sync", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ""
    document.documentElement.removeAttribute("data-ui-theme")
    document.documentElement.removeAttribute("data-tokens-applied")
  })

  it("classic shell clears OKLCH tokens", () => {
    applyThemeTokens(DEFAULT_THEME_TOKENS)
    setUiTheme("classic")
    expect(document.documentElement.getAttribute("data-ui-theme")).toBe("classic")
    expect(document.documentElement.hasAttribute("data-tokens-applied")).toBe(false)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("beta shell applies tokens and respects light mode", () => {
    localStorage.setItem(
      "simplecrm:themeTokens",
      JSON.stringify({
        colorMode: "light",
        bgTone: "neutral",
        accentHue: 155,
        accentChroma: 0.18,
        density: "comfort",
        radius: "medium",
        sidebarMode: "rail",
        fontFamily: "geist",
      }),
    )
    setUiTheme("beta")
    expect(document.documentElement.getAttribute("data-ui-theme")).toBe("beta")
    expect(document.documentElement.getAttribute("data-tokens-applied")).toBe("true")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
