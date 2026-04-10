"use client"

import {
  createContext,
  useContext,
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
  metadataPanelOpen: boolean
  setMetadataPanelOpen: Dispatch<SetStateAction<boolean>>
}

export type SettingsTab =
  | "accounts"
  | "smtp"
  | "oauth"
  | "ai"
  | "team"
  | "canned"
  | "prompts"
  | "export"

const MailWorkspaceContext = createContext<MailWorkspaceState | null>(null)

export function MailWorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [mailView, setMailView] = useState<MailView>("inbox")
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ mode: "closed" })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("accounts")
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(true)

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
      metadataPanelOpen,
      setMetadataPanelOpen,
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
      metadataPanelOpen,
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
