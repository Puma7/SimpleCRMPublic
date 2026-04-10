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
import type { EmailMessage, MailView } from "./types"

export type ComposeIntent =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "reply"; message: EmailMessage }
  | { mode: "draft"; messageId: number }

export type SettingsTab =
  | "accounts"
  | "smtp"
  | "oauth"
  | "ai"
  | "team"
  | "canned"
  | "prompts"
  | "export"

type MailWorkspaceState = {
  selectedAccountId: number | null
  setSelectedAccountId: Dispatch<SetStateAction<number | null>>
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
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
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

const VALID_MAIL_VIEWS: MailView[] = ["inbox", "sent", "archived", "drafts"]
const VALID_SETTINGS_TABS: SettingsTab[] = [
  "accounts",
  "smtp",
  "oauth",
  "ai",
  "team",
  "canned",
  "prompts",
  "export",
]

export function MailWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(() =>
    readLS<number | null>(
      LS_KEYS.selectedAccountId,
      (raw) => {
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const bumpAccountsRevision = useCallback(() => {
    setAccountsRevision((v) => v + 1)
  }, [])

  // Persist the few slices that deserve it.
  useEffect(() => {
    writeLS(LS_KEYS.selectedAccountId, selectedAccountId)
  }, [selectedAccountId])
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
      selectedAccountId,
      setSelectedAccountId,
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
      settingsOpen,
      setSettingsOpen,
      settingsTab,
      setSettingsTab,
      settingsAccountId,
      setSettingsAccountId,
      metadataPanelOpen,
      setMetadataPanelOpen,
      accountsRevision,
      bumpAccountsRevision,
    }),
    [
      selectedAccountId,
      mailView,
      categoryFilterId,
      selectedMessage,
      searchQuery,
      composeIntent,
      settingsOpen,
      settingsTab,
      settingsAccountId,
      metadataPanelOpen,
      accountsRevision,
      bumpAccountsRevision,
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
