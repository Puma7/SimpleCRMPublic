import type { ReactElement } from "react"
import {
  AtSign,
  BrainCircuit,
  Download,
  KeyRound,
  LayoutDashboard,
  Send,
  Type,
  Users,
  Workflow,
  Wrench,
} from "lucide-react"
import { AccountsPanel } from "../settings/accounts-panel"
import { SmtpPanel } from "../settings/smtp-panel"
import { OAuthPanel } from "../settings/oauth-panel"
import { AiPanel } from "../settings/ai-panel"
import { KnowledgePanel } from "../settings/knowledge-panel"
import { MailSecurityPanel } from "../settings/mail-security-panel"
import { AutomationPanel } from "../settings/automation-panel"
import { PromptsPanel } from "../settings/prompts-panel"
import { TeamPanel } from "../settings/team-panel"
import { CannedPanel } from "../settings/canned-panel"
import { ExportPanel } from "../settings/export-panel"
import { MiscPanel } from "../settings/misc-panel"

export type BetaSettingsSection =
  | "overview"
  | "mailboxes"
  | "delivery"
  | "intelligence"
  | "automation"
  | "team"
  | "privacy"
  | "advanced"

export type BetaIntelligenceTab = "profiles" | "prompts" | "knowledge" | "security"

export const BETA_SETTINGS_SECTION_IDS: BetaSettingsSection[] = [
  "overview",
  "mailboxes",
  "delivery",
  "intelligence",
  "automation",
  "team",
  "privacy",
  "advanced",
]

export const BETA_INTELLIGENCE_TAB_IDS: BetaIntelligenceTab[] = [
  "profiles",
  "prompts",
  "knowledge",
  "security",
]

type SectionDef = {
  id: BetaSettingsSection
  label: string
  description: string
  icon: typeof LayoutDashboard
  group: string
}

export const BETA_SETTINGS_SECTIONS: SectionDef[] = [
  {
    id: "overview",
    label: "Übersicht",
    description: "Status von Postfächern, KI und Automatisierung auf einen Blick.",
    icon: LayoutDashboard,
    group: "Start",
  },
  {
    id: "mailboxes",
    label: "Postfächer",
    description: "IMAP/POP3-Konten anlegen und verwalten.",
    icon: AtSign,
    group: "E-Mail",
  },
  {
    id: "delivery",
    label: "Versand & Anmeldung",
    description: "SMTP, Sent-Ordner und OAuth (Google/Microsoft).",
    icon: Send,
    group: "E-Mail",
  },
  {
    id: "intelligence",
    label: "KI & Wissen",
    description: "Profile, Composer-Prompts, Wissensbasis und Mail-Sicherheit.",
    icon: BrainCircuit,
    group: "Intelligenz",
  },
  {
    id: "automation",
    label: "Automatisierung",
    description: "API-Zugang, IMAP-Löschen und Workflow-Verknüpfung.",
    icon: Workflow,
    group: "Intelligenz",
  },
  {
    id: "team",
    label: "Team & Vorlagen",
    description: "Zuweisung, Signaturen und Textbausteine.",
    icon: Users,
    group: "Organisation",
  },
  {
    id: "privacy",
    label: "Datenschutz",
    description: "DSGVO-Export als ZIP.",
    icon: Download,
    group: "Compliance",
  },
  {
    id: "advanced",
    label: "Erweitert",
    description: "Inbox-Wiederherstellung und Sonderfälle.",
    icon: Wrench,
    group: "System",
  },
]

const INTELLIGENCE_LABELS: Record<BetaIntelligenceTab, string> = {
  profiles: "KI-Profile",
  prompts: "Composer-Prompts",
  knowledge: "Wissensbasis",
  security: "Mail-Sicherheit",
}

export function intelligenceTabLabel(tab: BetaIntelligenceTab): string {
  return INTELLIGENCE_LABELS[tab]
}

export function renderBetaSectionContent(
  section: BetaSettingsSection,
  intelligenceTab: BetaIntelligenceTab,
): ReactElement | null {
  switch (section) {
    case "overview":
      return null
    case "mailboxes":
      return <AccountsPanel />
    case "delivery":
      return (
        <div className="space-y-8">
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">SMTP &amp; Versand</h3>
            </div>
            <SmtpPanel />
          </section>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">OAuth (Google / Microsoft)</h3>
            </div>
            <OAuthPanel />
          </section>
        </div>
      )
    case "intelligence":
      switch (intelligenceTab) {
        case "profiles":
          return <AiPanel />
        case "prompts":
          return <PromptsPanel />
        case "knowledge":
          return <KnowledgePanel />
        case "security":
          return <MailSecurityPanel />
        default:
          return <AiPanel />
      }
    case "automation":
      return <AutomationPanel />
    case "team":
      return (
        <div className="space-y-8">
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <TeamPanel />
          </section>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Type className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Textbausteine</h3>
            </div>
            <CannedPanel />
          </section>
        </div>
      )
    case "privacy":
      return <ExportPanel />
    case "advanced":
      return <MiscPanel />
    default:
      return null
  }
}

export function betaSectionWideLayout(section: BetaSettingsSection): boolean {
  return section === "intelligence" || section === "mailboxes"
}
