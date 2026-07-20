"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MAIL_PERMISSION_PROFILES,
  MAIL_PERMISSIONS,
  type MailPermission,
  type MailPermissionProfile,
} from "@simplecrm/core"
import { IPCChannels } from "@shared/ipc/channels"
import { RefreshCw, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  invokeRenderer,
  isMailAclRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { cn } from "@/lib/utils"

type AccountRow = {
  id: number
  display_name?: string | null
  displayName?: string | null
  email_address?: string | null
}

type FolderRow = {
  id: number
  account_id?: number | null
  accountId?: number | null
  path?: string | null
}

type UserRow = {
  id: string
  display_name?: string | null
  displayName?: string | null
  username?: string | null
  role?: string | null
  is_active?: number | boolean | null
  disabledAt?: string | null
}

type GroupRow = {
  id: number
  name: string
  memberCount?: number | null
}

type DelegationBinding = {
  id: number
  subject: { type: "user"; id: string; label?: string } | { type: "group"; id: number; label?: string }
  resource: { type: "account"; accountId: number; label?: string } | { type: "folder"; accountId: number; folderId: number; label?: string }
  permissions: MailPermission[]
  profile: string | null
  updatedAt: string
}

type DelegationBindingPage = {
  items: DelegationBinding[]
  nextCursor: number | null
}

const DELEGATION_PAGE_SIZE = 100

const PROFILE_OPTIONS: Array<MailPermissionProfile | "custom"> = [
  "viewer",
  "triage",
  "editor",
  "sender",
  "manager",
  "custom",
]

const PROFILE_LABELS: Record<MailPermissionProfile | "custom", string> = {
  viewer: "Lesen",
  triage: "Triage",
  editor: "Bearbeiten",
  sender: "Senden",
  manager: "Verwalten",
  custom: "Benutzerdefiniert",
}

const PERMISSION_LABELS: Record<MailPermission, string> = {
  "mail.metadata.read": "Metadaten lesen",
  "mail.content.read": "Inhalt lesen",
  "mail.attachment.read": "Anhänge lesen",
  "mail.attachment.suspicious_download": "Verdächtige Anhänge laden",
  "mail.triage": "Triage",
  "mail.comment": "Kommentieren",
  "mail.draft.create": "Entwurf erstellen",
  "mail.draft.edit": "Entwurf bearbeiten",
  "mail.send": "Senden",
  "mail.send_as": "Als Konto senden",
  "mail.delete": "Löschen",
  "mail.export": "Exportieren",
  "mail.account.manage": "Konto verwalten",
  "mail.delegation.manage": "Delegation verwalten",
}

export function MailDelegationPanel() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [bindings, setBindings] = useState<DelegationBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [subjectType, setSubjectType] = useState<"user" | "group">("user")
  const [subjectId, setSubjectId] = useState("")
  const [resourceType, setResourceType] = useState<"account" | "folder">("account")
  const [accountId, setAccountId] = useState("")
  const [folderId, setFolderId] = useState("")
  const [profile, setProfile] = useState<MailPermissionProfile | "custom">("viewer")
  const [permissions, setPermissions] = useState<MailPermission[]>([...MAIL_PERMISSION_PROFILES.viewer])
  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const loadingRef = useRef(true)
  const formRef = useRef({ accountId, folderId, resourceType, subjectId, subjectType, editingId })
  formRef.current = { accountId, folderId, resourceType, subjectId, subjectType, editingId }

  const activeUsers = useMemo(() => users.filter(isActiveUser), [users])

  const visibleFolders = useMemo(() => {
    const selected = Number(accountId)
    return folders.filter((folder) => (folder.account_id ?? folder.accountId) === selected)
  }, [folders, accountId])

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    loadingRef.current = true
    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }
    try {
      const [accountRows, folderRows, userRows, groupRows, bindingRows] = await Promise.all([
        invokeRenderer(IPCChannels.Email.ListAccounts) as Promise<AccountRow[]>,
        invokeRenderer(IPCChannels.Email.ListFolders) as Promise<FolderRow[]>,
        invokeRenderer(IPCChannels.Auth.ListUsers) as Promise<UserRow[]>,
        invokeRenderer(IPCChannels.UserGroups.List) as Promise<GroupRow[]>,
        listAllDelegationBindings(),
      ])
      if (!mountedRef.current || generation !== loadGenerationRef.current) return

      const current = formRef.current
      const nextAccountId = accountRows.some((account) => String(account.id) === current.accountId)
        ? current.accountId
        : accountRows[0] ? String(accountRows[0].id) : ""
      const foldersForAccount = folderRows.filter((folder) => (
        String(folder.account_id ?? folder.accountId ?? "") === nextAccountId
      ))
      const nextFolderId = current.resourceType === "folder"
        ? foldersForAccount.some((folder) => String(folder.id) === current.folderId)
          ? current.folderId
          : foldersForAccount[0] ? String(foldersForAccount[0].id) : ""
        : ""
      const activeUserRows = userRows.filter(isActiveUser)
      const currentSubjectVisible = current.subjectType === "user"
        ? activeUserRows.some((user) => user.id === current.subjectId)
        : groupRows.some((group) => String(group.id) === current.subjectId)
      const nextSubjectType = currentSubjectVisible
        ? current.subjectType
        : activeUserRows.length > 0 ? "user" : "group"
      const nextSubjectId = currentSubjectVisible
        ? current.subjectId
        : nextSubjectType === "user"
          ? activeUserRows[0]?.id ?? ""
          : String(groupRows[0]?.id ?? "")
      const editedBinding = current.editingId === null
        ? null
        : bindingRows.find((binding) => binding.id === current.editingId) ?? null
      const selectedResourceChanged = nextAccountId !== current.accountId
        || (current.resourceType === "folder" && nextFolderId !== current.folderId)
      const editedResourceVisible = editedBinding !== null
        && resourceIsVisible(editedBinding.resource, accountRows, folderRows)

      setAccounts(accountRows)
      setFolders(folderRows)
      setUsers(userRows)
      setGroups(groupRows)
      setBindings(bindingRows)
      setAccountId(nextAccountId)
      setFolderId(nextFolderId)
      setSubjectType(nextSubjectType)
      setSubjectId(nextSubjectId)
      if (current.editingId !== null && (selectedResourceChanged || !editedResourceVisible)) {
        setEditingId(null)
        setProfile("viewer")
        setPermissions([...MAIL_PERMISSION_PROFILES.viewer])
      }
    } catch {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setError("Delegationen konnten nicht geladen werden.")
      }
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailAclRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load])

  useEffect(() => {
    if (resourceType === "folder" && visibleFolders.length > 0 && !visibleFolders.some((folder) => String(folder.id) === folderId)) {
      setFolderId(String(visibleFolders[0]!.id))
    }
  }, [folderId, resourceType, visibleFolders])

  const applyProfile = (value: MailPermissionProfile | "custom") => {
    setProfile(value)
    if (value !== "custom") setPermissions([...MAIL_PERMISSION_PROFILES[value]])
  }

  const togglePermission = (permission: MailPermission, checked: boolean) => {
    setProfile("custom")
    setPermissions((current) => {
      if (checked) return current.includes(permission) ? current : [...current, permission]
      return current.filter((entry) => entry !== permission)
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setProfile("viewer")
    setPermissions([...MAIL_PERMISSION_PROFILES.viewer])
  }

  const editBinding = (binding: DelegationBinding) => {
    setEditingId(binding.id)
    setSubjectType(binding.subject.type)
    setSubjectId(String(binding.subject.id))
    setResourceType(binding.resource.type)
    setAccountId(String(binding.resource.accountId))
    setFolderId(binding.resource.type === "folder" ? String(binding.resource.folderId) : "")
    setProfile(binding.profile && PROFILE_OPTIONS.includes(binding.profile as MailPermissionProfile) ? binding.profile as MailPermissionProfile : "custom")
    setPermissions(binding.permissions)
  }

  const save = async () => {
    if (loadingRef.current) return
    const numericAccountId = Number(accountId)
    const accountVisible = accounts.some((account) => account.id === numericAccountId)
    const numericFolderId = Number(folderId)
    const folderVisible = resourceType === "account" || folders.some((folder) => (
      folder.id === numericFolderId
      && (folder.account_id ?? folder.accountId) === numericAccountId
    ))
    if (!accountVisible || !folderVisible) {
      setError("Die ausgewählte Mail-Ressource ist nicht mehr verfügbar.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...(editingId === null ? {} : { id: editingId }),
        subject: subjectType === "user"
          ? { type: "user" as const, id: subjectId }
          : { type: "group" as const, id: Number(subjectId) },
        resource: resourceType === "account"
          ? { type: "account" as const, accountId: numericAccountId }
          : { type: "folder" as const, accountId: numericAccountId, folderId: numericFolderId },
        profile,
        permissions: [...permissions].sort(),
      }
      const result = await invokeRenderer(IPCChannels.Email.SaveMailDelegationBinding, payload) as { success?: boolean; error?: string }
      if (result.success === false) throw new Error(result.error ?? "save_failed")
      if (mountedRef.current) {
        resetForm()
        await load()
      }
    } catch {
      if (mountedRef.current) setError("Delegation konnte nicht gespeichert werden.")
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const remove = async (bindingId: number) => {
    setSaving(true)
    setError(null)
    try {
      await invokeRenderer(IPCChannels.Email.DeleteMailDelegationBinding, bindingId)
      if (mountedRef.current) {
        if (editingId === bindingId) resetForm()
        await load()
      }
    } catch {
      if (mountedRef.current) setError("Delegation konnte nicht gelöscht werden.")
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const subjectOptions = subjectType === "user"
    ? activeUsers.map((user) => ({ id: user.id, label: user.display_name ?? user.displayName ?? user.username ?? user.id }))
    : groups.map((group) => ({ id: String(group.id), label: group.name }))

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Mailbox-Delegation</h2>
        <p className="text-sm text-muted-foreground">Serverseitige Konten- und Ordnerrechte für Benutzer und Gruppen.</p>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Konto
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name ?? account.displayName ?? `Konto ${account.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Ressource
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value as "account" | "folder")}
            >
              <option value="account">Ganzes Konto</option>
              <option value="folder">Ordner</option>
            </select>
          </label>
          {resourceType === "folder" ? (
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Ordner
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              >
                {visibleFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.path ?? `Ordner ${folder.id}`}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="space-y-1 text-sm font-medium">
            Subjekt
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={subjectType}
              onChange={(event) => {
                const next = event.target.value as "user" | "group"
                setSubjectType(next)
                setSubjectId(next === "user" ? activeUsers[0]?.id ?? "" : String(groups[0]?.id ?? ""))
              }}
            >
              <option value="user">Benutzer</option>
              <option value="group">Gruppe</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Auswahl
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {subjectOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-sm font-medium">
          Profil
          <select
            aria-label="Profil"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={profile}
            onChange={(event) => applyProfile(event.target.value as MailPermissionProfile | "custom")}
          >
            {PROFILE_OPTIONS.map((option) => (
              <option key={option} value={option}>{PROFILE_LABELS[option]}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {MAIL_PERMISSIONS.map((permission) => (
            <label key={permission} className="flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm">
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) => togglePermission(permission, event.target.checked)}
              />
              <span>{PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={save}
            disabled={loading || saving || !accountId || !subjectId || permissions.length === 0 || (resourceType === "folder" && !folderId)}
          >
            <Save className="mr-2 h-4 w-4" />
            Berechtigung speichern
          </Button>
          {editingId !== null ? (
            <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
              Abbrechen
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Aktualisieren
          </Button>
        </div>
      </div>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Delegationen werden geladen.</p> : null}
      {!loading && bindings.length === 0 ? <p className="text-sm text-muted-foreground">Keine Delegationen vorhanden.</p> : null}

      <div className="space-y-2">
        {bindings.map((binding) => (
          <div key={binding.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <button type="button" className="min-w-0 text-left" onClick={() => editBinding(binding)}>
              <p className="truncate text-sm font-medium">{binding.subject.label ?? String(binding.subject.id)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {binding.resource.label ?? (binding.resource.type === "folder" ? `Ordner ${binding.resource.folderId}` : `Konto ${binding.resource.accountId}`)}
                {" · "}
                {binding.permissions.map((permission) => PERMISSION_LABELS[permission]).join(", ")}
              </p>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Löschen ${binding.subject.label ?? binding.id}`}
              onClick={() => void remove(binding.id)}
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

async function listAllDelegationBindings(): Promise<DelegationBinding[]> {
  const bindings: DelegationBinding[] = []
  const seenCursors = new Set<number>()
  let cursor: number | undefined
  do {
    const page = await invokeRenderer(IPCChannels.Email.ListMailDelegationBindings, {
      ...(cursor === undefined ? {} : { cursor }),
      limit: DELEGATION_PAGE_SIZE,
    }) as DelegationBindingPage
    bindings.push(...page.items)
    if (page.nextCursor === null) return bindings
    if (
      !Number.isSafeInteger(page.nextCursor)
      || page.nextCursor <= 0
      || (cursor !== undefined && page.nextCursor <= cursor)
      || seenCursors.has(page.nextCursor)
    ) {
      throw new Error("invalid_mail_delegation_cursor")
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (true)
}

function isActiveUser(user: UserRow): boolean {
  if (user.disabledAt) return false
  return user.is_active === undefined
    || user.is_active === null
    || user.is_active === true
    || user.is_active === 1
}

function resourceIsVisible(
  resource: DelegationBinding["resource"],
  accounts: readonly AccountRow[],
  folders: readonly FolderRow[],
): boolean {
  if (!accounts.some((account) => account.id === resource.accountId)) return false
  if (resource.type === "account") return true
  return folders.some((folder) => (
    folder.id === resource.folderId
    && (folder.account_id ?? folder.accountId) === resource.accountId
  ))
}
