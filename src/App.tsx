import "./fonts.css"
import "./styles/globals.css"
import "./styles/beta-theme.css"
import "./styles/theme-tokens.css"
import { UiThemeProvider } from "@/components/beta/ui-theme-provider"
import { ThemeTokensProvider } from "@/components/theme/theme-tokens-provider"
import { AppShell } from "@/components/app-shell"

export default function App() {
  return (
    <UiThemeProvider>
      <ThemeTokensProvider>
        <AppShell />
      </ThemeTokensProvider>
    </UiThemeProvider>
  )
}
