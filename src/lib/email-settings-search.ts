import type {
  BetaIntelligenceTab,
  BetaSettingsSection,
} from "@/components/email/beta/beta-settings-sections"
import type { SettingsTab } from "@/components/email/workspace-context"

/** Full search object required by `/email/settings` route (TanStack Router). */
export type EmailSettingsSearch = {
  tab: SettingsTab
  section: BetaSettingsSection
  intelligenceTab: BetaIntelligenceTab
}

export function emailSettingsSearch(
  partial: Partial<EmailSettingsSearch> = {},
): EmailSettingsSearch {
  return {
    tab: partial.tab ?? "accounts",
    section: partial.section ?? "overview",
    intelligenceTab: partial.intelligenceTab ?? "profiles",
  }
}
