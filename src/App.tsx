import "./fonts.css"
import "./styles/globals.css"
import { AppShell } from "@/components/app-shell"
import { DeploySetupGate } from "@/components/setup/deploy-setup-gate"

export default function App() {
  return (
    <DeploySetupGate>
      <AppShell />
    </DeploySetupGate>
  )
}
