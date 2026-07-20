"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MAIL_PERMISSION_PROFILES,
  MAIL_PERMISSIONS,
  type MailPermission,
  type MailPermissionProfile,
} from "@simplecrm/core"
import { IPCChannels, type InvokeChannel } from "@shared/ipc/channels"
import { RefreshCw, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  invokeRenderer,
  isMailAclRefreshEvent,
  RendererTransportError,
  subscribeServerEvents,
} from "@/services/transport"
import { cn } from "@/lib/utils"

type DelegationResource =
  | { type: "account"; accountId: number }
  | { type: "folder"; accountId: number; folderId: number }

type ResourceOption =
  | { type: "account"; accountId: number; label: string }
  | { type: "folder"; accountId: number; folderId: number; accountLabel: string; label: string }

type SubjectOption =
  | { type: "user"; id: string; label: string }
  | { type: "group"; id: number; label: string }

type DelegationBinding = {
  id: number
  subject: { type: "user"; id: string; label?: string } | { type: "group"; id: number; label?: string }
  resource: { type: "account"; accountId: number; label?: string } | { type: "folder"; accountId: number; folderId: number; label?: string }
  permissions: MailPermission[]
  profile: string | null
  updatedAt: string
}

type NumericPage<T> = { items: T[]; nextCursor: number | null }
type SubjectPage = { items: SubjectOption[]; nextCursor: string | null }
type FormSnapshot = {
  accountId: string
  folderId: string
  resourceType: "account" | "folder"
  subjectId: string
  subjectType: "user" | "group"
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
  const [resources, setResources] = useState<ResourceOption[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [bindings, setBindings] = useState<DelegationBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [authorizationReady, setAuthorizationReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [subjectType, setSubjectType] = useState<"user" | "group">("user")
  const [subjectId, setSubjectId] = useState("")
  const [resourceType, setResourceType] = useState<"account" | "folder">("account")
  const [accountId, setAccountId] = useState("")
  const [folderId, setFolderId] = useState("")
  const [profile, setProfile] = useState<MailPermissionProfile | "custom">("viewer")
  const [permissions, setPermissions] = useState<MailPermission[]>([])

  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const subjectGenerationRef = useRef(0)
  const loadingRef = useRef(true)
  const authorizationReadyRef = useRef(false)
  const formRef = useRef<FormSnapshot>({ accountId, folderId, resourceType, subjectId, subjectType })
  formRef.current = { accountId, folderId, resourceType, subjectId, subjectType }

  const accounts = useMemo(() => accountOptions(resources), [resources])
  const visibleFolders = useMemo(() => resources.filter((resource): resource is Extract<ResourceOption, { type: "folder" }> => (
    resource.type === "folder" && String(resource.accountId) === accountId
  )), [resources, accountId])
  const canManageSelectedAccount = resources.some((resource) => (
    resource.type === "account" && String(resource.accountId) === accountId
  ))
  const subjectOptions = useMemo(() => subjects.filter((subject) => subject.type === subjectType), [subjects, subjectType])

  const clearAuthorizedState = useCallback(() => {
    authorizationReadyRef.current = false
    loadingRef.current = true
    setAuthorizationReady(false)
    setLoading(true)
    setResources([])
    setSubjects([])
    setBindings([])
    setAccountId("")
    setFolderId("")
    setResourceType("account")
    setSubjectType("user")
    setSubjectId("")
    setEditingId(null)
    setProfile("viewer")
    setPermissions([])
  }, [])

  const load = useCallback(async () => {
    const preferred = formRef.current
    const generation = ++loadGenerationRef.current
    subjectGenerationRef.current += 1
    clearAuthorizedState()
    if (mountedRef.current) setError(null)
    try {
      const [accountResources, folderResources, bindingRows] = await Promise.all([
        listAllDelegationResources("account"),
        listAllDelegationResources("folder"),
        listAllDelegationBindings(),
      ])
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      const resourceRows = [...accountResources, ...folderResources]
      const selected = chooseResource(resourceRows, preferred)
      const subjectRows = selected
        ? await listAllDelegationSubjects(selected)
        : []
      if (!mountedRef.current || generation !== loadGenerationRef.current) return

      const nextSubject = chooseSubject(subjectRows, preferred)
      setResources(resourceRows)
      setSubjects(subjectRows)
      setBindings(bindingRows)
      setAccountId(selected ? String(selected.accountId) : "")
      setResourceType(selected?.type ?? "account")
      setFolderId(selected?.type === "folder" ? String(selected.folderId) : "")
      setSubjectType(nextSubject?.type ?? "user")
      setSubjectId(nextSubject ? String(nextSubject.id) : "")
      setProfile("viewer")
      setPermissions(selected && nextSubject ? [...MAIL_PERMISSION_PROFILES.viewer] : [])
      authorizationReadyRef.current = true
      loadingRef.current = false
      setAuthorizationReady(true)
      setLoading(false)
    } catch (err) {
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      loadingRef.current = false
      setLoading(false)
      setError(err instanceof RendererTransportError ? err.message : "Delegationen konnten nicht geladen werden.")
    }
  }, [clearAuthorizedState])

  const selectResource = useCallback(async (
    resource: DelegationResource,
    preferredSubject?: DelegationBinding["subject"],
    editingBinding?: DelegationBinding,
  ) => {
    const generation = ++subjectGenerationRef.current
    authorizationReadyRef.current = false
    loadingRef.current = true
    setAuthorizationReady(false)
    setLoading(true)
    setError(null)
    setSubjects([])
    setSubjectId("")
    setEditingId(null)
    setProfile("viewer")
    setPermissions([])
    setAccountId(String(resource.accountId))
    setResourceType(resource.type)
    setFolderId(resource.type === "folder" ? String(resource.folderId) : "")
    try {
      const subjectRows = await listAllDelegationSubjects(resource)
      if (!mountedRef.current || generation !== subjectGenerationRef.current) return
      const preferred = preferredSubject
        ? { subjectType: preferredSubject.type, subjectId: String(preferredSubject.id) }
        : formRef.current
      const nextSubject = chooseSubject(subjectRows, preferred)
      setSubjects(subjectRows)
      setSubjectType(nextSubject?.type ?? "user")
      setSubjectId(nextSubject ? String(nextSubject.id) : "")
      if (editingBinding && nextSubject && sameSubject(nextSubject, editingBinding.subject)) {
        setEditingId(editingBinding.id)
        setProfile("custom")
        setPermissions([...editingBinding.permissions])
      } else {
        setProfile("viewer")
        setPermissions(nextSubject ? [...MAIL_PERMISSION_PROFILES.viewer] : [])
      }
      authorizationReadyRef.current = true
      loadingRef.current = false
      setAuthorizationReady(true)
      setLoading(false)
    } catch (err) {
      if (!mountedRef.current || generation !== subjectGenerationRef.current) return
      loadingRef.current = false
      setLoading(false)
      setError(err instanceof RendererTransportError ? err.message : "Delegationen konnten nicht geladen werden.")
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      subjectGenerationRef.current += 1
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

  const applyProfile = (next: MailPermissionProfile | "custom") => {
    setProfile(next)
    if (next !== "custom") setPermissions([...MAIL_PERMISSION_PROFILES[next]])
  }

  const togglePermission = (permission: MailPermission, checked: boolean) => {
    setProfile("custom")
    setPermissions((current) => checked
      ? [...new Set([...current, permission])]
      : current.filter((entry) => entry !== permission))
  }

  const resetForm = () => {
    setEditingId(null)
    setProfile("viewer")
    setPermissions(subjectId ? [...MAIL_PERMISSION_PROFILES.viewer] : [])
  }

  const changeSubjectType = (next: "user" | "group") => {
    const nextSubjectId = String(subjects.find((subject) => subject.type === next)?.id ?? "")
    setSubjectType(next)
    setSubjectId(nextSubjectId)
    setEditingId(null)
    setProfile("viewer")
    setPermissions(nextSubjectId ? [...MAIL_PERMISSION_PROFILES.viewer] : [])
  }

  const changeSubject = (nextSubjectId: string) => {
    setSubjectId(nextSubjectId)
    setEditingId(null)
    setProfile("viewer")
    setPermissions(nextSubjectId ? [...MAIL_PERMISSION_PROFILES.viewer] : [])
  }

  const save = async () => {
    if (loadingRef.current || !authorizationReadyRef.current) return
    const resource = selectedResource(resources, resourceType, accountId, folderId)
    const subject = subjects.find((option) => option.type === subjectType && String(option.id) === subjectId)
    if (!resource || !subject) {
      clearAuthorizedState()
      setLoading(false)
      loadingRef.current = false
      setError("Die ausgewählte Delegation ist nicht mehr verfügbar.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await invokeRenderer(IPCChannels.Email.SaveMailDelegationBinding, {
        ...(editingId === null ? {} : { id: editingId }),
        subject: subject.type === "user"
          ? { type: "user" as const, id: subject.id }
          : { type: "group" as const, id: subject.id },
        resource,
        profile,
        permissions: [...permissions].sort(),
      }) as { success?: boolean; error?: string }
      if (result.success === false) throw new Error(result.error ?? "save_failed")
      if (mountedRef.current) await load()
    } catch (err) {
      if (mountedRef.current) {
        clearAuthorizedState()
        loadingRef.current = false
        setLoading(false)
        setError(err instanceof RendererTransportError ? err.message : "Delegation konnte nicht gespeichert werden.")
      }
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const remove = async (bindingId: number) => {
    setSaving(true)
    setError(null)
    try {
      await invokeRenderer(IPCChannels.Email.DeleteMailDelegationBinding, bindingId)
      if (mountedRef.current) await load()
    } catch (err) {
      if (mountedRef.current) {
        clearAuthorizedState()
        loadingRef.current = false
        setLoading(false)
        setError(err instanceof RendererTransportError ? err.message : "Delegation konnte nicht gelöscht werden.")
      }
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const editBinding = (binding: DelegationBinding) => {
    if (!resourceIsVisible(binding.resource, resources)) {
      clearAuthorizedState()
      setLoading(false)
      loadingRef.current = false
      return
    }
    void selectResource(binding.resource, binding.subject, binding)
  }

  const changeAccount = (value: string) => {
    const accountResource = resources.find((resource): resource is Extract<ResourceOption, { type: "account" }> => (
      resource.type === "account" && String(resource.accountId) === value
    ))
    const folderResource = resources.find((resource): resource is Extract<ResourceOption, { type: "folder" }> => (
      resource.type === "folder" && String(resource.accountId) === value
    ))
    const next = accountResource ?? folderResource
    if (next) void selectResource(next)
  }

  const changeResourceType = (nextType: "account" | "folder") => {
    const next = nextType === "account"
      ? resources.find((resource) => resource.type === "account" && String(resource.accountId) === accountId)
      : visibleFolders[0]
    if (next) void selectResource(next)
  }

  const changeFolder = (value: string) => {
    const next = visibleFolders.find((folder) => String(folder.folderId) === value)
    if (next) void selectResource(next)
  }

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
              onChange={(event) => changeAccount(event.target.value)}
              disabled={!authorizationReady || loading}
            >
              {accounts.length === 0 ? <option value="">Keine autorisierte Ressource</option> : null}
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Ressource
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={resourceType}
              onChange={(event) => changeResourceType(event.target.value as "account" | "folder")}
              disabled={!authorizationReady || loading}
            >
              <option value="account" disabled={!canManageSelectedAccount}>Ganzes Konto</option>
              <option value="folder" disabled={visibleFolders.length === 0}>Ordner</option>
            </select>
          </label>
          {resourceType === "folder" ? (
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Ordner
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={folderId}
                onChange={(event) => changeFolder(event.target.value)}
                disabled={!authorizationReady || loading}
              >
                {visibleFolders.length === 0 ? <option value="">Kein autorisierter Ordner</option> : null}
                {visibleFolders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="space-y-1 text-sm font-medium">
            Subjekt
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={subjectType}
              disabled={!authorizationReady || loading}
              onChange={(event) => changeSubjectType(event.target.value as "user" | "group")}
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
              onChange={(event) => changeSubject(event.target.value)}
              disabled={!authorizationReady || loading}
            >
              {subjectOptions.length === 0 ? <option value="">Kein auswählbares Subjekt</option> : null}
              {subjectOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
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
            disabled={!authorizationReady || loading}
          >
            {PROFILE_OPTIONS.map((option) => <option key={option} value={option}>{PROFILE_LABELS[option]}</option>)}
          </select>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {MAIL_PERMISSIONS.map((permission) => (
            <label key={permission} className="flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm">
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) => togglePermission(permission, event.target.checked)}
                disabled={!authorizationReady || loading}
              />
              <span>{PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={save}
            disabled={!authorizationReady || loading || saving || !accountId || !subjectId || permissions.length === 0 || (resourceType === "folder" && !folderId)}
          >
            <Save className="mr-2 h-4 w-4" />
            Berechtigung speichern
          </Button>
          {editingId !== null ? (
            <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>Abbrechen</Button>
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

async function listAllDelegationResources(resourceType: "account" | "folder"): Promise<ResourceOption[]> {
  return listAllNumericPages<ResourceOption>(IPCChannels.Email.ListMailDelegationResources, { resourceType })
}

async function listAllDelegationBindings(): Promise<DelegationBinding[]> {
  return listAllNumericPages<DelegationBinding>(IPCChannels.Email.ListMailDelegationBindings, {})
}

async function listAllNumericPages<T>(channel: InvokeChannel, payload: Record<string, unknown>): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<number>()
  let cursor: number | undefined
  do {
    const page = await invokeRenderer(channel, {
      ...payload,
      ...(cursor === undefined ? {} : { cursor }),
      limit: DELEGATION_PAGE_SIZE,
    }) as NumericPage<T>
    items.push(...page.items)
    if (page.nextCursor === null) return items
    if (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0 || seen.has(page.nextCursor)) {
      throw new Error("invalid_mail_delegation_cursor")
    }
    if (cursor !== undefined && page.nextCursor <= cursor) throw new Error("non_progressing_mail_delegation_cursor")
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  } while (true)
}

async function listAllDelegationSubjects(resource: DelegationResource): Promise<SubjectOption[]> {
  const [users, groups] = await Promise.all([
    listSubjectType(resource, "user"),
    listSubjectType(resource, "group"),
  ])
  return [...users, ...groups]
}

async function listSubjectType(
  resource: DelegationResource,
  subjectType: "user" | "group",
): Promise<SubjectOption[]> {
  const items: SubjectOption[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await invokeRenderer(IPCChannels.Email.ListMailDelegationSubjects, {
      resource,
      subjectType,
      ...(cursor === undefined ? {} : { cursor }),
      limit: DELEGATION_PAGE_SIZE,
    }) as SubjectPage
    items.push(...page.items)
    if (page.nextCursor === null) return items
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error("invalid_mail_delegation_subject_cursor")
    if (cursor !== undefined && compareSubjectCursor(subjectType, page.nextCursor, cursor) <= 0) {
      throw new Error("non_progressing_mail_delegation_subject_cursor")
    }
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  } while (true)
}

function compareSubjectCursor(subjectType: "user" | "group", left: string, right: string): number {
  return subjectType === "group" ? Number(left) - Number(right) : left.localeCompare(right)
}

function accountOptions(resources: readonly ResourceOption[]): Array<{ id: number; label: string }> {
  const accounts = new Map<number, string>()
  for (const resource of resources) {
    accounts.set(resource.accountId, resource.type === "account" ? resource.label : resource.accountLabel)
  }
  return [...accounts].map(([id, label]) => ({ id, label })).sort((left, right) => left.id - right.id)
}

function chooseResource(resources: readonly ResourceOption[], preferred: Pick<FormSnapshot, "accountId" | "folderId" | "resourceType">): DelegationResource | null {
  const preferredResource = selectedResource(resources, preferred.resourceType, preferred.accountId, preferred.folderId)
  if (preferredResource) return preferredResource
  const first = resources[0]
  return first ? resourceValue(first) : null
}

function chooseSubject(
  subjects: readonly SubjectOption[],
  preferred: Pick<FormSnapshot, "subjectId" | "subjectType">,
): SubjectOption | null {
  return subjects.find((subject) => subject.type === preferred.subjectType && String(subject.id) === preferred.subjectId)
    ?? subjects.find((subject) => subject.type === "user")
    ?? subjects[0]
    ?? null
}

function selectedResource(
  resources: readonly ResourceOption[],
  type: "account" | "folder",
  accountId: string,
  folderId: string,
): DelegationResource | null {
  const option = resources.find((resource) => (
    resource.type === type
    && String(resource.accountId) === accountId
    && (resource.type === "account" || String(resource.folderId) === folderId)
  ))
  return option ? resourceValue(option) : null
}

function resourceValue(resource: ResourceOption): DelegationResource {
  return resource.type === "account"
    ? { type: "account", accountId: resource.accountId }
    : { type: "folder", accountId: resource.accountId, folderId: resource.folderId }
}

function resourceIsVisible(resource: DelegationBinding["resource"], resources: readonly ResourceOption[]): boolean {
  return resources.some((option) => {
    if (option.type !== resource.type || option.accountId !== resource.accountId) return false
    if (option.type === "account" && resource.type === "account") return true
    return option.type === "folder" && resource.type === "folder" && option.folderId === resource.folderId
  })
}

function sameSubject(left: SubjectOption, right: DelegationBinding["subject"]): boolean {
  return left.type === right.type && String(left.id) === String(right.id)
}
