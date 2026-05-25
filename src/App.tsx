import "./fonts.css"
import "./styles/globals.css"
import "./styles/beta-theme.css"
import { UiThemeProvider } from "@/components/beta/ui-theme-provider"
import { AppShell } from "@/components/app-shell"

export default function App() {
  return (
    <UiThemeProvider>
      <AppShell />
    </UiThemeProvider>
  )
}
