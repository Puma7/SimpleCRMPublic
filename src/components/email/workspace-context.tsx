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
import type { MessageListDisplayMode, MessageListSortMode } from "@shared/email-list-options"
import type { MessageListFilter } from "@shared/email-list-filters"
import {
  DEFAULT_MESSAGE_DONE_FILTER,
  type MessageDoneFilter,
} from "@shared/email-done-filter"
import type { ConversationLockRecord, EmailMessage, MailView } from "./types"

export type ComposeIntent =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "reply"; message: EmailMessage; initialReplyHtml?: string }
  | { mode: "reply-all"; message: EmailMessage; initialReplyHtml?: string }
  | { mode: "forward"; message: EmailMessage }
  | { mode: "draft"; messageId: number }

export type { MessageListFilter, MessageDoneFilter }

export type SettingsTab =
  | "accounts"
  | "oauthApps"
  | "ai"
  | "accountMail"
  | "knowledge"
  | "mailSecurity"
  | "automation"
  | "team"
  | "appUsers"
  | "authSecurity"
  | "userGroups"
  | "canned"
  | "prompts"
  | "export"
  | "diagnostics"
  | "pgp"
  | "auditLog"
  | "threadTools"
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
  conversationLocks: Record<number, ConversationLockRecord>
  setConversationLocks: Dispatch<SetStateAction<Record<number, ConversationLockRecord>>>
  upsertConversationLock: (lock: ConversationLockRecord) => void
  removeConversationLock: (messageId: number) => void
  searchQuery: string
  setSearchQuery: Dispatch<SetStateAction<string>>
  messageListFilter: MessageListFilter
  setMessageListFilter: Dispatch<SetStateAction<MessageListFilter>>
  /** Posteingang Zero: offen / erledigt / alle (nur Posteingang). */
  messageDoneFilter: MessageDoneFilter
  setMessageDoneFilter: Dispatch<SetStateAction<MessageDoneFilter>>
  listSortMode: MessageListSortMode
  setListSortMode: Dispatch<SetStateAction<MessageListSortMode>>
  listDisplayMode: MessageListDisplayMode
  setListDisplayMode: Dispatch<SetStateAction<MessageListDisplayMode>>
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
  /**
   * Bumps when folder/category sidebar counts should refresh (move, erledigt, sync, …).
   * Consumed by useMailFolderCounts / useEmailCategories in the sidebar only.
   */
  mailMetricsRevision: number
  bumpMailMetricsRevision: () => void
  /**
   * Bumps after add/remove/set on `email_message_categories` from anywhere
   * in the app (sidebar drag-drop, bulk drop, metadata panel select).
   * The metadata panel chip list keys off this so it re-fetches its chips
   * when a sibling component mutated the M:N assignment for the selected
   * message — otherwise the chips would only refresh on message switch.
   */
  categoryAssignmentRevision: number
  bumpCategoryAssignmentRevision: () => void
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
  messageDoneFilter: "email:messageDoneFilter",
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

const VALID_MAIL_VIEWS: MailView[] = [
  "inbox",
  "sent",
  "archived",
  "drafts",
  "spam_review",
  "spam",
  "trash",
  "snoozed",
]
const VALID_MESSAGE_DONE_FILTERS: MessageDoneFilter[] = ["all", "open", "done"]

function normalizeSettingsTab(raw: string): SettingsTab | null {
  if (raw === "smtp" || raw === "oauth") return "accounts"
  if (VALID_SETTINGS_TAB_IDS.includes(raw as SettingsTab)) return raw as SettingsTab
  return null
}

const VALID_SETTINGS_TAB_IDS: SettingsTab[] = [
  "accounts",
  "oauthApps",
  "ai",
  "accountMail",
  "knowledge",
  "mailSecurity",
  "automation",
  "team",
  "appUsers",
  "userGroups",
  "canned",
  "prompts",
  "export",
  "diagnostics",
  "misc",
]

const VALID_SETTINGS_TABS = VALID_SETTINGS_TAB_IDS

export function MailWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedAccountScope, setSelectedAccountScope] = useState<MailAccountScope | null>(() =>
    readLS<MailAccountScope | null>(
      LS_KEYS.selectedAccountId,
      (raw) => {
        if (raw === "all") return "all"
        const n = parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
      },
      "all",
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
  const [conversationLocks, setConversationLocks] = useState<Record<number, ConversationLockRecord>>({})
  const [searchQuery, setSearchQuery] = useState("")
  const [messageListFilter, setMessageListFilter] = useState<MessageListFilter>("all")
  const [messageDoneFilter, setMessageDoneFilter] = useState<MessageDoneFilter>(() =>
    readLS<MessageDoneFilter>(
      LS_KEYS.messageDoneFilter,
      (raw) =>
        VALID_MESSAGE_DONE_FILTERS.includes(raw as MessageDoneFilter)
          ? (raw as MessageDoneFilter)
          : null,
      DEFAULT_MESSAGE_DONE_FILTER,
    ),
  )
  const [listSortMode, setListSortMode] = useState<MessageListSortMode>("date_desc")
  const [listDisplayMode, setListDisplayMode] = useState<MessageListDisplayMode>("flat")
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ mode: "closed" })
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() =>
    readLS<SettingsTab>(
      LS_KEYS.settingsTab,
      (raw) => normalizeSettingsTab(raw),
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
  const [mailMetricsRevision, setMailMetricsRevision] = useState(0)
  const [categoryAssignmentRevision, setCategoryAssignmentRevision] = useState(0)

  const bumpAccountsRevision = useCallback(() => {
    setAccountsRevision((v) => v + 1)
  }, [])

  const bumpMailMetricsRevision = useCallback(() => {
    setMailMetricsRevision((v) => v + 1)
  }, [])

  const bumpCategoryAssignmentRevision = useCallback(() => {
    setCategoryAssignmentRevision((v) => v + 1)
  }, [])

  const upsertConversationLock = useCallback((lock: ConversationLockRecord) => {
    setConversationLocks((prev) => ({ ...prev, [lock.messageId]: lock }))
  }, [])

  const removeConversationLock = useCallback((messageId: number) => {
    setConversationLocks((prev) => {
      if (!(messageId in prev)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
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
  useEffect(() => {
    writeLS(LS_KEYS.messageDoneFilter, messageDoneFilter)
  }, [messageDoneFilter])

  // R-9: Erledigt-Filter gilt nur im Posteingang — beim View-Wechsel zurücksetzen.
  useEffect(() => {
    if (mailView !== "inbox" && messageDoneFilter !== DEFAULT_MESSAGE_DONE_FILTER) {
      setMessageDoneFilter(DEFAULT_MESSAGE_DONE_FILTER)
    }
  }, [mailView, messageDoneFilter])

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
      conversationLocks,
      setConversationLocks,
      upsertConversationLock,
      removeConversationLock,
      searchQuery,
      setSearchQuery,
      messageListFilter,
      setMessageListFilter,
      messageDoneFilter,
      setMessageDoneFilter,
      listSortMode,
      setListSortMode,
      listDisplayMode,
      setListDisplayMode,
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
      mailMetricsRevision,
      bumpMailMetricsRevision,
      categoryAssignmentRevision,
      bumpCategoryAssignmentRevision,
    }),
    [
      selectedAccountScope,
      mailView,
      categoryFilterId,
      selectedMessage,
      conversationLocks,
      upsertConversationLock,
      removeConversationLock,
      searchQuery,
      messageListFilter,
      messageDoneFilter,
      listSortMode,
      listDisplayMode,
      composeIntent,
      settingsTab,
      settingsAccountId,
      metadataPanelOpen,
      accountsRevision,
      bumpAccountsRevision,
      mailMetricsRevision,
      bumpMailMetricsRevision,
      categoryAssignmentRevision,
      bumpCategoryAssignmentRevision,
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
