"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import type { MailAccountScope } from "./account-scope"
import type { EmailMessage, MailView } from "./types"
import type { EmailUiMode } from "@/lib/email-ui-mode"
import { UI_THEME_CHANGED, readUiTheme, setUiTheme } from "@/lib/ui-theme"

export type ComposeIntent =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "reply"; message: EmailMessage }
  | { mode: "forward"; message: EmailMessage }
  | { mode: "draft"; messageId: number }

export type SettingsTab =
  | "accounts"
  | "smtp"
  | "oauth"
  | "ai"
  | "knowledge"
  | "mailSecurity"
  | "automation"
  | "team"
  | "canned"
  | "prompts"
  | "export"
  | "misc"

type MailWorkspaceState = {
  /** Ein Konto oder `all` für Shared Inbox über alle Konten. */
  selectedAccountScope: MailAccountScope | null
  setSelectedAccountScope: Dispatch<SetStateAction<MailAccountScope | null>>
  /** @deprecated Alias — use selectedAccountScope */
  selectedAccountId: MailAccountScope | null
  setSelectedAccountId: Dispatch<SetStateAction<MailAccountScope | null>>
  mailView: MailView
  setMailView: Dispatch<SetStateAction<MailView>>
  categoryFilterId: number | null
  setCategoryFilterId: Dispatch<SetStateAction<number | null>>
  selectedMessage: EmailMessage | null
  setSelectedMessage: Dispatch<SetStateAction<EmailMessage | null>>
  searchQuery: string
  setSearchQuery: Dispatch<SetStateAction<string>>
  composeIntent: ComposeIntent
  setComposeIntent: Dispatch<SetStateAction<ComposeIntent>>
  settingsTab: SettingsTab
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>
  /**
   * Shared account selection for the Settings panels (SMTP, OAuth, …).
   * Matches the single `accId` state the old settings/page.tsx used across
   * multiple cards so users don't have to pick the account twice.
   */
  settingsAccountId: number | null
  setSettingsAccountId: Dispatch<SetStateAction<number | null>>
  metadataPanelOpen: boolean
  setMetadataPanelOpen: Dispatch<SetStateAction<boolean>>
  /**
   * Monotonic counter that bumps whenever the account list is mutated
   * (add/update/delete). Hooks and panels that render account data
   * (Inbox sidebar, SMTP panel, OAuth panel) include this in their
   * useEffect dependencies to re-fetch without needing a prop chain
   * back into their state holder.
   */
  accountsRevision: number
  bumpAccountsRevision: () => void
  /** Classic sidebar tabs vs. beta hub (Einstellungen); persisted in localStorage. */
  emailUiMode: EmailUiMode
  setEmailUiMode: (mode: EmailUiMode) => void
}

const MailWorkspaceContext = createContext<MailWorkspaceState | null>(null)

// localStorage keys — kept narrow on purpose: only the few state slices
// where losing them between route transitions (e.g. user clicks "Mail-Report"
// in MainNav) would be annoying. Session-local state (selectedMessage,
// searchQuery, composeIntent, …) is intentionally NOT persisted.
const LS_KEYS = {
  selectedAccountId: "email:selectedAccountId",
  mailView: "email:mailView",
  settingsTab: "email:settingsTab",
  settingsAccountId: "email:settingsAccountId",
} as const

function readLS<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = parse(raw)
    return parsed !== null ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown): void {
  if (typeof window === "undefined") return
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, String(value))
    }
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

const VALID_MAIL_VIEWS: MailView[] = ["inbox", "sent", "archived", "drafts", "spam", "trash"]
const VALID_SETTINGS_TABS: SettingsTab[] = [
  "accounts",
  "smtp",
  "oauth",
  "ai",
  "knowledge",
  "mailSecurity",
  "automation",
  "team",
  "canned",
  "prompts",
  "export",
  "misc",
]

export function MailWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedAccountScope, setSelectedAccountScope] = useState<MailAccountScope | null>(() =>
    readLS<MailAccountScope | null>(
      LS_KEYS.selectedAccountId,
      (raw) => {
        if (raw === "all") return "all"
        const n = parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
      },
      null,
    ),
  )
  const [mailView, setMailView] = useState<MailView>(() =>
    readLS<MailView>(
      LS_KEYS.mailView,
      (raw) => (VALID_MAIL_VIEWS.includes(raw as MailView) ? (raw as MailView) : null),
      "inbox",
    ),
  )
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ mode: "closed" })
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() =>
    readLS<SettingsTab>(
      LS_KEYS.settingsTab,
      (raw) =>
        VALID_SETTINGS_TABS.includes(raw as SettingsTab) ? (raw as SettingsTab) : null,
      "accounts",
    ),
  )
  const [settingsAccountId, setSettingsAccountId] = useState<number | null>(() =>
    readLS<number | null>(
      LS_KEYS.settingsAccountId,
      (raw) => {
        const n = parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
      },
      null,
    ),
  )
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(true)
  const [accountsRevision, setAccountsRevision] = useState(0)
  const [emailUiMode, setEmailUiModeState] = useState<EmailUiMode>(() => readUiTheme())

  const setEmailUiMode = useCallback((mode: EmailUiMode) => {
    setEmailUiModeState(mode)
    setUiTheme(mode)
  }, [])

  useEffect(() => {
    const sync = () => setEmailUiModeState(readUiTheme())
    window.addEventListener(UI_THEME_CHANGED, sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "simplecrm:uiTheme" && e.key !== "email:uiMode") return
      sync()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(UI_THEME_CHANGED, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const bumpAccountsRevision = useCallback(() => {
    setAccountsRevision((v) => v + 1)
  }, [])

  // Persist the few slices that deserve it.
  useEffect(() => {
    writeLS(LS_KEYS.selectedAccountId, selectedAccountScope)
  }, [selectedAccountScope])
  useEffect(() => {
    writeLS(LS_KEYS.mailView, mailView)
  }, [mailView])
  useEffect(() => {
    writeLS(LS_KEYS.settingsTab, settingsTab)
  }, [settingsTab])
  useEffect(() => {
    writeLS(LS_KEYS.settingsAccountId, settingsAccountId)
  }, [settingsAccountId])

  const value = useMemo<MailWorkspaceState>(
    () => ({
      selectedAccountScope,
      setSelectedAccountScope,
      selectedAccountId: selectedAccountScope,
      setSelectedAccountId: setSelectedAccountScope,
      mailView,
      setMailView,
      categoryFilterId,
      setCategoryFilterId,
      selectedMessage,
      setSelectedMessage,
      searchQuery,
      setSearchQuery,
      composeIntent,
      setComposeIntent,
      settingsTab,
      setSettingsTab,
      settingsAccountId,
      setSettingsAccountId,
      metadataPanelOpen,
      setMetadataPanelOpen,
      accountsRevision,
      bumpAccountsRevision,
      emailUiMode,
      setEmailUiMode,
    }),
    [
      selectedAccountScope,
      mailView,
      categoryFilterId,
      selectedMessage,
      searchQuery,
      composeIntent,
      settingsTab,
      settingsAccountId,
      metadataPanelOpen,
      accountsRevision,
      bumpAccountsRevision,
      emailUiMode,
      setEmailUiMode,
    ],
  )

  return (
    <MailWorkspaceContext.Provider value={value}>{children}</MailWorkspaceContext.Provider>
  )
}

export function useMailWorkspace(): MailWorkspaceState {
  const ctx = useContext(MailWorkspaceContext)
  if (!ctx) throw new Error("useMailWorkspace must be used within MailWorkspaceProvider")
  return ctx
}
