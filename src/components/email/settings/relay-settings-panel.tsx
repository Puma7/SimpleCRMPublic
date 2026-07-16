"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  ServerOff,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth/auth-context"
import { isServerClientMode } from "@/lib/runtime-mode"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { invokeRenderer } from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"
import {
  formatRelayDateTime,
  RelayCredentialsSection,
  type SmtpRelayCredential,
} from "./relay-credentials-section"

export type SmtpRelayTrackingMode = "off" | "rule" | "always"

export type SmtpRelayAllowedAccount = {
  accountId: number
  fromAddress: string | null
  emailAddress: string
  displayName: string
}

export type SmtpRelay = {
  id: string
  label: string
  enabled: boolean
  trackingMode: SmtpRelayTrackingMode
  trackingSubjectPatterns: string | null
  allowHeaderOverride: boolean
  maxRecipients: number
  maxMessageBytes: number
  rateLimitPerMin: number
  allowArbitraryRecipients: boolean
  followupWorkflowId: number | null
  createdAt: string
  allowedAccounts: SmtpRelayAllowedAccount[]
  credentials: SmtpRelayCredential[]
}

export type SmtpRelaySubmission = {
  id: string
  status: "received" | "relayed" | "failed"
  recipientCount: number
  trackingApplied: boolean
  trackingRuleReason: string | null
  messageId: number | null
  smtpMessageIdHeader: string | null
  errorText: string | null
  createdAt: string
}

type AccountOption = {
  id: number
  display_name: string
  email_address: string
}

type WorkflowOption = {
  id: number
  name: string
  trigger?: string
}

export function RelaySettingsPanel() {
  const { user, loading: authLoading } = useAuth()
  const hasUser = Boolean(user)
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const serverClientMode = isServerClientMode()

  const [relays, setRelays] = useState<SmtpRelay[]>([])
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListSmtpRelays) as SmtpRelay[]
      setRelays(list)
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP-Relays konnten nicht geladen werden."
      setLoadError(message)
      toast.error(message)
      setLoading(false)
      return
    }
    // Auxiliary lists for the pickers — the panel stays usable if either fails.
    try {
      setAccounts(await invokeRenderer(IPCChannels.Email.ListAccounts) as AccountOption[])
    } catch {
      setAccounts([])
    }
    try {
      setWorkflows(await invokeRenderer(IPCChannels.Email.ListWorkflows) as WorkflowOption[])
    } catch {
      setWorkflows([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (serverClientMode && !authLoading && hasUser) void load()
  }, [serverClientMode, authLoading, hasUser, load])

  const replaceRelay = (next: SmtpRelay) => {
    setRelays((current) => current.map((relay) => relay.id === next.id ? next : relay))
  }

  const createRelay = async () => {
    const label = newLabel.trim()
    if (!label) {
      toast.error("Bitte ein Label für das Relay angeben.")
      return
    }
    setCreating(true)
    try {
      const created = await invokeRenderer(IPCChannels.Email.CreateSmtpRelay, { label }) as SmtpRelay
      setRelays((current) => [...current, created])
      setNewLabel("")
      setExpandedId(created.id)
      toast.success("Relay angelegt.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Relay konnte nicht angelegt werden.")
    } finally {
      setCreating(false)
    }
  }

  const header = (
    <div>
      <h2 className="text-lg font-semibold">SMTP-Relay</h2>
      <p className="text-sm text-muted-foreground">
        Externe Systeme (z. B. JTL-Wawi) senden E-Mails über SimpleCRM — inklusive optionaler
        Nachverfolgung und Follow-up-Workflows.
      </p>
    </div>
  )

  if (!serverClientMode) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <ServerOff className="h-4 w-4" />
          <AlertTitle>Server-Funktion</AlertTitle>
          <AlertDescription>
            Das SMTP-Relay läuft auf dem SimpleCRM-Server und nimmt E-Mails externer Systeme über
            die Ports 587 (STARTTLS) und 465 (SSL/TLS) entgegen. Verbinden Sie diese App mit einer
            SimpleCRM-Serverinstanz, um Relays zu verwalten.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        SMTP-Relays werden geladen…
      </div>
    )
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>SMTP-Relays nicht verfügbar</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Erneut versuchen
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      {!isAdmin ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Nur lesbar</AlertTitle>
          <AlertDescription>Änderungen sind Ownern und Admins vorbehalten.</AlertDescription>
        </Alert>
      ) : null}

      {isAdmin ? (
        <section className="flex flex-wrap items-end gap-2 rounded-lg border p-4">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="relay-new-label">Neues Relay</Label>
            <Input
              id="relay-new-label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="z. B. JTL-Wawi Mahnwesen"
              maxLength={200}
            />
          </div>
          <Button type="button" onClick={() => void createRelay()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Relay anlegen
          </Button>
        </section>
      ) : null}

      {relays.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Noch kein Relay eingerichtet.
        </p>
      ) : (
        <div className="space-y-4">
          {relays.map((relay) => (
            <RelayCard
              key={relay.id}
              relay={relay}
              isAdmin={isAdmin}
              expanded={expandedId === relay.id}
              accounts={accounts}
              workflows={workflows}
              onToggleExpand={() =>
                setExpandedId((current) => current === relay.id ? null : relay.id)}
              onChanged={replaceRelay}
              onDeleted={(relayId) => {
                setRelays((current) => current.filter((entry) => entry.id !== relayId))
                setExpandedId((current) => current === relayId ? null : current)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RelayCard(props: {
  relay: SmtpRelay
  isAdmin: boolean
  expanded: boolean
  accounts: AccountOption[]
  workflows: WorkflowOption[]
  onToggleExpand(): void
  onChanged(next: SmtpRelay): void
  onDeleted(relayId: string): void
}) {
  const { relay, isAdmin, expanded, accounts, workflows, onToggleExpand, onChanged, onDeleted } = props
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const toggleEnabled = async (enabled: boolean) => {
    setToggling(true)
    try {
      const next = await invokeRenderer(IPCChannels.Email.UpdateSmtpRelay, {
        relayId: relay.id,
        enabled,
      }) as SmtpRelay
      onChanged(next)
      toast.success(enabled ? "Relay aktiviert." : "Relay deaktiviert.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Relay konnte nicht umgeschaltet werden.")
    } finally {
      setToggling(false)
    }
  }

  const deleteRelay = async () => {
    if (!window.confirm(
      `Relay "${relay.label}" wirklich löschen? Zugangsdaten und Konto-Freigaben werden entfernt; externe Systeme können darüber nicht mehr senden.`,
    )) return
    setDeleting(true)
    try {
      await invokeRenderer(IPCChannels.Email.DeleteSmtpRelay, relay.id)
      onDeleted(relay.id)
      toast.success("Relay gelöscht.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Relay konnte nicht gelöscht werden.")
    } finally {
      setDeleting(false)
    }
  }

  const activeCredentials = relay.credentials.filter((credential) => !credential.revokedAt).length

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{relay.label}</p>
            {!relay.enabled ? <Badge variant="outline">Deaktiviert</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {relay.allowedAccounts.length} Konten · {activeCredentials} aktive Zugangsdaten ·
            Erstellt: {formatRelayDateTime(relay.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            checked={relay.enabled}
            disabled={!isAdmin || toggling}
            onCheckedChange={(enabled) => void toggleEnabled(enabled)}
            aria-label={`Relay ${relay.label} aktiv`}
          />
          <Button type="button" variant="ghost" size="sm" onClick={onToggleExpand}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Details
          </Button>
          {isAdmin ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void deleteRelay()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Löschen
            </Button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="space-y-6 border-t p-4">
          <RelayConfigForm relay={relay} isAdmin={isAdmin} workflows={workflows} onChanged={onChanged} />
          <RelayAccountsSection relay={relay} accounts={accounts} isAdmin={isAdmin} onChanged={onChanged} />
          <RelayCredentialsSection
            relayId={relay.id}
            credentials={relay.credentials}
            isAdmin={isAdmin}
            onCredentialsChanged={(credentials) => onChanged({ ...relay, credentials })}
          />
          <RelaySubmissionsSection relayId={relay.id} />
        </div>
      ) : null}
    </div>
  )
}

const TRACKING_MODE_LABELS: Record<SmtpRelayTrackingMode, string> = {
  off: "Aus",
  rule: "Regelbasiert",
  always: "Immer",
}

function RelayConfigForm(props: {
  relay: SmtpRelay
  isAdmin: boolean
  workflows: WorkflowOption[]
  onChanged(next: SmtpRelay): void
}) {
  const { relay, isAdmin, workflows, onChanged } = props
  const [label, setLabel] = useState(relay.label)
  const [trackingMode, setTrackingMode] = useState<SmtpRelayTrackingMode>(relay.trackingMode)
  const [patterns, setPatterns] = useState(relay.trackingSubjectPatterns ?? "")
  const [allowHeaderOverride, setAllowHeaderOverride] = useState(relay.allowHeaderOverride)
  const [maxRecipients, setMaxRecipients] = useState(relay.maxRecipients)
  const [maxMessageBytes, setMaxMessageBytes] = useState(relay.maxMessageBytes)
  const [rateLimitPerMin, setRateLimitPerMin] = useState(relay.rateLimitPerMin)
  const [followupWorkflowId, setFollowupWorkflowId] = useState<number | null>(relay.followupWorkflowId)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) {
      toast.error("Label darf nicht leer sein.")
      return
    }
    if (!Number.isInteger(maxRecipients) || maxRecipients < 1 || maxRecipients > 1000) {
      toast.error("Max. Empfänger muss zwischen 1 und 1000 liegen.")
      return
    }
    if (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1) {
      toast.error("Max. Nachrichtengröße muss eine positive Ganzzahl (Bytes) sein.")
      return
    }
    if (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin < 1) {
      toast.error("Rate-Limit muss eine positive Ganzzahl sein.")
      return
    }
    setSaving(true)
    try {
      const next = await invokeRenderer(IPCChannels.Email.UpdateSmtpRelay, {
        relayId: relay.id,
        label: trimmedLabel,
        trackingMode,
        trackingSubjectPatterns: patterns.trim().length > 0 ? patterns : null,
        allowHeaderOverride,
        maxRecipients,
        maxMessageBytes,
        rateLimitPerMin,
        followupWorkflowId,
      }) as SmtpRelay
      onChanged(next)
      toast.success("Relay gespeichert.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  const followupValue = followupWorkflowId === null ? "none" : String(followupWorkflowId)
  const followupInList = followupWorkflowId === null
    || workflows.some((workflow) => workflow.id === followupWorkflowId)

  return (
    <section className="space-y-4">
      <h4 className="text-sm font-medium">Konfiguration</h4>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`relay-label-${relay.id}`}>Label</Label>
          <Input
            id={`relay-label-${relay.id}`}
            value={label}
            disabled={!isAdmin}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`relay-tracking-mode-${relay.id}`}>Nachverfolgung</Label>
          <Select
            value={trackingMode}
            disabled={!isAdmin}
            onValueChange={(value) => setTrackingMode(value as SmtpRelayTrackingMode)}
          >
            <SelectTrigger id={`relay-tracking-mode-${relay.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TRACKING_MODE_LABELS) as SmtpRelayTrackingMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>{TRACKING_MODE_LABELS[mode]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`relay-patterns-${relay.id}`}>Betreff-Muster für Nachverfolgung</Label>
        <Textarea
          id={`relay-patterns-${relay.id}`}
          value={patterns}
          disabled={!isAdmin}
          rows={3}
          onChange={(event) => setPatterns(event.target.value)}
          placeholder={"Mahnung\n/^\\[dringend\\]/i"}
        />
        <p className="text-xs text-muted-foreground">
          Ein Muster pro Zeile, nur im Modus „Regelbasiert“ wirksam. Normale Zeilen matchen als
          Teiltext ohne Groß-/Kleinschreibung; <code>/ausdruck/flags</code> wird als regulärer
          Ausdruck ausgewertet. Vorgabe <code>Mahnung</code> trackt z. B. alle Mahnstufen.
        </p>
      </div>

      <div className="flex min-h-10 items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={`relay-header-override-${relay.id}`}>
            X-SimpleCRM-Track Header respektieren
          </Label>
          <p className="text-xs text-muted-foreground">
            Absender können die Nachverfolgung pro Nachricht per Header{" "}
            <code>X-SimpleCRM-Track: on/off</code> erzwingen oder unterdrücken.
          </p>
        </div>
        <Switch
          id={`relay-header-override-${relay.id}`}
          checked={allowHeaderOverride}
          disabled={!isAdmin}
          onCheckedChange={setAllowHeaderOverride}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          id={`relay-max-recipients-${relay.id}`}
          label="Max. Empfänger je Nachricht"
          value={maxRecipients}
          min={1}
          max={1000}
          disabled={!isAdmin}
          onChange={setMaxRecipients}
        />
        <NumberField
          id={`relay-max-bytes-${relay.id}`}
          label="Max. Größe (Bytes)"
          value={maxMessageBytes}
          min={1}
          max={2_147_483_647}
          disabled={!isAdmin}
          onChange={setMaxMessageBytes}
        />
        <NumberField
          id={`relay-rate-limit-${relay.id}`}
          label="Rate-Limit (Mails/Minute)"
          value={rateLimitPerMin}
          min={1}
          max={100000}
          disabled={!isAdmin}
          onChange={setRateLimitPerMin}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`relay-followup-${relay.id}`}>Follow-up-Workflow</Label>
        <Select
          value={followupValue}
          disabled={!isAdmin}
          onValueChange={(value) => setFollowupWorkflowId(value === "none" ? null : Number(value))}
        >
          <SelectTrigger id={`relay-followup-${relay.id}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Kein Follow-up</SelectItem>
            {!followupInList && followupWorkflowId !== null ? (
              <SelectItem value={String(followupWorkflowId)}>
                Workflow #{followupWorkflowId}
              </SelectItem>
            ) : null}
            {workflows.filter((workflow) => workflow.trigger === "relay").map((workflow) => (
              <SelectItem key={workflow.id} value={String(workflow.id)}>
                {workflow.name}
                {workflow.trigger ? ` (${workflow.trigger})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Wird nach erfolgreich weitergeleiteten, getrackten Nachrichten mit dem Trigger{" "}
          <code>relay</code> ausgeführt (z. B. „Mahnung ohne Reaktion nachfassen“).
        </p>
      </div>

      {isAdmin ? (
        <div className="flex justify-end border-t pt-4">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Speichern
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function RelayAccountsSection(props: {
  relay: SmtpRelay
  accounts: AccountOption[]
  isAdmin: boolean
  onChanged(next: SmtpRelay): void
}) {
  const { relay, accounts, isAdmin, onChanged } = props
  const [accountId, setAccountId] = useState("")
  const [fromAddress, setFromAddress] = useState("")
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)

  const available = accounts.filter((account) =>
    !relay.allowedAccounts.some((allowed) => allowed.accountId === account.id))

  const addAccount = async () => {
    const parsedId = Number(accountId)
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      toast.error("Bitte ein Konto auswählen.")
      return
    }
    setAdding(true)
    try {
      const added = await invokeRenderer(IPCChannels.Email.AddSmtpRelayAccount, {
        relayId: relay.id,
        accountId: parsedId,
        fromAddress: fromAddress.trim() ? fromAddress.trim() : null,
      }) as SmtpRelayAllowedAccount
      onChanged({ ...relay, allowedAccounts: [...relay.allowedAccounts, added] })
      setAccountId("")
      setFromAddress("")
      toast.success("Konto freigegeben.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Konto konnte nicht freigegeben werden.")
    } finally {
      setAdding(false)
    }
  }

  const removeAccount = async (allowedAccountId: number) => {
    setRemovingId(allowedAccountId)
    try {
      await invokeRenderer(IPCChannels.Email.RemoveSmtpRelayAccount, {
        relayId: relay.id,
        accountId: allowedAccountId,
      })
      onChanged({
        ...relay,
        allowedAccounts: relay.allowedAccounts.filter((allowed) =>
          allowed.accountId !== allowedAccountId),
      })
      toast.success("Freigabe entfernt.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Freigabe konnte nicht entfernt werden.")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Freigegebene Konten</h4>
        <p className="text-xs text-muted-foreground">
          Nur freigegebene Konten dürfen als Absender (From) verwendet werden; der Versand läuft
          über deren SMTP-Zugang.
        </p>
      </div>

      {relay.allowedAccounts.length ? (
        <div className="divide-y rounded-lg border">
          {relay.allowedAccounts.map((allowed) => (
            <div
              key={allowed.accountId}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">{allowed.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {allowed.emailAddress}
                  {allowed.fromAddress ? ` · From-Override: ${allowed.fromAddress}` : ""}
                </p>
              </div>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void removeAccount(allowed.accountId)}
                  disabled={removingId === allowed.accountId}
                >
                  {removingId === allowed.accountId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Entfernen
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Noch keine Konten freigegeben — das Relay lehnt jede Einlieferung ab.
        </p>
      )}

      {isAdmin ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={`relay-add-account-${relay.id}`}>Konto</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id={`relay-add-account-${relay.id}`}>
                <SelectValue placeholder="Konto wählen" />
              </SelectTrigger>
              <SelectContent>
                {available.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.display_name} ({account.email_address})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={`relay-add-from-${relay.id}`}>From-Override (optional)</Label>
            <Input
              id={`relay-add-from-${relay.id}`}
              type="email"
              value={fromAddress}
              onChange={(event) => setFromAddress(event.target.value)}
              placeholder="mahnwesen@example.de"
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void addAccount()} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Konto hinzufügen
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const SUBMISSION_STATUS: Record<SmtpRelaySubmission["status"], {
  label: string
  variant: "outline" | "secondary" | "destructive"
}> = {
  received: { label: "Angenommen", variant: "outline" },
  relayed: { label: "Weitergeleitet", variant: "secondary" },
  failed: { label: "Fehlgeschlagen", variant: "destructive" },
}

function RelaySubmissionsSection({ relayId }: { relayId: string }) {
  const [submissions, setSubmissions] = useState<SmtpRelaySubmission[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListSmtpRelaySubmissions, {
        relayId,
        limit: 50,
      }) as SmtpRelaySubmission[]
      setSubmissions(list)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Einlieferungen konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [relayId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Letzte Einlieferungen</h4>
          <p className="text-xs text-muted-foreground">Die letzten 50 über dieses Relay eingelieferten Nachrichten.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Aktualisieren
        </Button>
      </div>

      {submissions === null ? (
        <p className="text-sm text-muted-foreground">Einlieferungen werden geladen…</p>
      ) : submissions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Noch keine Einlieferungen.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {submissions.map((submission) => (
            <div key={submission.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={SUBMISSION_STATUS[submission.status].variant}>
                  {SUBMISSION_STATUS[submission.status].label}
                </Badge>
                <span>{formatRelayDateTime(submission.createdAt)}</span>
                <span>
                  {submission.recipientCount === 1
                    ? "1 Empfänger"
                    : `${submission.recipientCount} Empfänger`}
                </span>
                {submission.trackingApplied ? <Badge variant="outline">Tracking aktiv</Badge> : null}
              </div>
              {submission.errorText ? (
                <p className="text-xs text-destructive">{submission.errorText}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function NumberField(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange(value: number): void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (Number.isInteger(value)) props.onChange(value)
        }}
      />
    </div>
  )
}
