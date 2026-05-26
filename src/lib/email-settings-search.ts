import type { SettingsTab } from "@/components/email/workspace-context"

export type EmailSettingsSearch = {
  tab: SettingsTab
}

export function emailSettingsSearch(
  partial: Partial<EmailSettingsSearch> = {},
): EmailSettingsSearch {
  return {
    tab: partial.tab ?? "accounts",
  }
}
