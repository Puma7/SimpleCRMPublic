"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { isServerClientMode } from "@/lib/runtime-mode"

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
  | "tracking"
  | "smtpRelay"
  | "delegation"
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
  | "snooze"
  | "misc"

export type SettingsAccountsSubTab =
  | "imap"
  | "smtp"
  | "oauth"
  | "signature"
  | "ki"
  | "erweitert"

import type { ComposeSessionSnapshot } from "@shared/compose-session"

export type { ComposeSessionSnapshot } from "@shared/compose-session"

export type MailSearchScopeState = {
  allFolders: boolean
  includeSpam: boolean
  includeTrash: boolean
}

/** Sortierung der Suchergebnisse: Datum (Standard) oder Relevanz (bm25/FTS). */
export type MailSearchSortMode = "date" | "relevance"

const DEFAULT_SEARCH_SCOPE: MailSearchScopeState = {
  allFolders: true,
  includeSpam: false,
  includeTrash: false,
}

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
  /** Suchbereich: alle Ordner (Standard) oder nur aktuelle Ansicht; Spam/Papierkorb optional. */
  searchScope: MailSearchScopeState
  setSearchScope: Dispatch<SetStateAction<MailSearchScopeState>>
  searchSortMode: MailSearchSortMode
  setSearchSortMode: Dispatch<SetStateAction<MailSearchSortMode>>
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
  composeSession: ComposeSessionSnapshot | null
  setComposeSession: Dispatch<SetStateAction<ComposeSessionSnapshot | null>>
  clearComposeSession: () => void
  settingsTab: SettingsTab
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>
  /**
   * Shared account selection for the Settings panels (SMTP, OAuth, …).
   * Matches the single `accId` state the old settings/page.tsx used across
   * multiple cards so users don't have to pick the account twice.
   */
  settingsAccountId: number | null
  setSettingsAccountId: Dispatch<SetStateAction<number | null>>
  /** One-shot account selection from compose → Einstellungen (not persisted). */
  settingsAccountDeepLinkId: number | null
  setSettingsAccountDeepLinkId: Dispatch<SetStateAction<number | null>>
  /** One-shot deep link from compose → Konten → Signatur (consumed by accounts settings). */
  settingsAccountsSubTab: SettingsAccountsSubTab | null
  setSettingsAccountsSubTab: Dispatch<SetStateAction<SettingsAccountsSubTab | null>>
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
  searchScope: "mail-search-scope-v1",
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
  "scheduled_send",
  "spam_review",
  "spam",
  "trash",
  "snoozed",
]
const VALID_MESSAGE_DONE_FILTERS: MessageDoneFilter[] = ["all", "open", "done"]

const SERVER_ONLY_SETTINGS_TABS = new Set<SettingsTab>([
  "authSecurity",
  "userGroups",
  "tracking",
  "smtpRelay",
  "delegation",
])

export function normalizeSettingsTab(
  raw: string,
  serverClientMode = isServerClientMode(),
): SettingsTab | null {
  if (raw === "smtp" || raw === "oauth" || raw === "accountMail") return "accounts"
  if (VALID_SETTINGS_TAB_IDS.includes(raw as SettingsTab)) {
    const tab = raw as SettingsTab
    return !serverClientMode && SERVER_ONLY_SETTINGS_TABS.has(tab) ? null : tab
  }
  return null
}

const VALID_SETTINGS_TAB_IDS: SettingsTab[] = [
  "accounts",
  "oauthApps",
  "ai",
  "accountMail",
  "knowledge",
  "mailSecurity",
  "tracking",
  "smtpRelay",
  "delegation",
  "automation",
  "team",
  "appUsers",
  "authSecurity",
  "userGroups",
  "canned",
  "prompts",
  "export",
  "diagnostics",
  "pgp",
  "auditLog",
  "threadTools",
  "snooze",
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
  const [searchScope, setSearchScope] = useState<MailSearchScopeState>(() =>
    readLS<MailSearchScopeState>(
      LS_KEYS.searchScope,
      (raw) => {
        try {
          const parsed = JSON.parse(raw) as Partial<MailSearchScopeState> | null
          if (!parsed || typeof parsed !== "object") return null
          return {
            allFolders: parsed.allFolders !== false,
            includeSpam: parsed.includeSpam === true,
            includeTrash: parsed.includeTrash === true,
          }
        } catch {
          return null
        }
      },
      DEFAULT_SEARCH_SCOPE,
    ),
  )
  const [searchSortMode, setSearchSortMode] = useState<MailSearchSortMode>("date")
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
  const [composeSession, setComposeSession] = useState<ComposeSessionSnapshot | null>(null)
  const clearComposeSession = useCallback(() => {
    setComposeSession(null)
  }, [])
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
  const [settingsAccountsSubTab, setSettingsAccountsSubTab] =
    useState<SettingsAccountsSubTab | null>(null)
  const [settingsAccountDeepLinkId, setSettingsAccountDeepLinkId] =
    useState<number | null>(null)
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(true)
  const [accountsRevision, setAccountsRevision] = useState(0)
  const [mailMetricsRevision, setMailMetricsRevision] = useState(0)
  const [categoryAssignmentRevision, setCategoryAssignmentRevision] = useState(0)

  const bumpAccountsRevision = useCallback(() => {
    setAccountsRevision((v) => v + 1)
  }, [])

  // Coalesce rapid successive mutations (e.g. marking many mails as spam one
  // after another): each revision bump refetches folder counts + categories +
  // category counts, so a trailing debounce collapses a burst into a single
  // refresh instead of ~3 requests per action — a big part of what tripped the
  // rate limiter.
  const mailMetricsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpMailMetricsRevision = useCallback(() => {
    if (mailMetricsTimerRef.current) clearTimeout(mailMetricsTimerRef.current)
    mailMetricsTimerRef.current = setTimeout(() => {
      mailMetricsTimerRef.current = null
      setMailMetricsRevision((v) => v + 1)
    }, 500)
  }, [])
  useEffect(
    () => () => {
      if (mailMetricsTimerRef.current) clearTimeout(mailMetricsTimerRef.current)
    },
    [],
  )

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
  useEffect(() => {
    writeLS(LS_KEYS.searchScope, JSON.stringify(searchScope))
  }, [searchScope])

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
      searchScope,
      setSearchScope,
      searchSortMode,
      setSearchSortMode,
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
      composeSession,
      setComposeSession,
      clearComposeSession,
      settingsTab,
      setSettingsTab,
      settingsAccountId,
      setSettingsAccountId,
      settingsAccountDeepLinkId,
      setSettingsAccountDeepLinkId,
      settingsAccountsSubTab,
      setSettingsAccountsSubTab,
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
      searchScope,
      searchSortMode,
      messageListFilter,
      messageDoneFilter,
      listSortMode,
      listDisplayMode,
      composeIntent,
      composeSession,
      clearComposeSession,
      settingsTab,
      settingsAccountId,
      settingsAccountDeepLinkId,
      settingsAccountsSubTab,
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
