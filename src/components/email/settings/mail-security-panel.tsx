"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { useAuth } from "@/components/auth/auth-context"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  invokeRenderer,
  isMailSpamListRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"

type MailSecuritySettings = {
  mailauthEnabled: boolean
  rspamdEnabled: boolean
  rspamdUrl: string
  rspamdTimeoutMs: number
  rspamdSpamScore: number
  autoSpamDmarcFail: boolean
  autoSpamSpfFail: boolean
  autoSpamRspamd: boolean
  senderWhitelist: string
  senderBlacklist: string
  spamScoreThreshold: number
  spamEngineEnabled: boolean
  spamReviewThreshold: number
  spamSpamThreshold: number
  localLearningEnabled: boolean
  rspamdContributionEnabled: boolean
  rspamdLearningEnabled: boolean
  aiSpamWorkflowEnabled: boolean
}

type SpamListEntry = {
  id: number
  list_type: "allow" | "block"
  pattern_type: "email" | "domain"
  pattern: string
  account_id: number | null
  note: string | null
}

export function MailSecurityPanel() {
  // A delegated settings.manage / email_settings.manage holder may edit these settings, but the
  // Rspamd connection test route stays admin-only (it fetches the URL — SSRF),
  // so the test button is admin-only to avoid a guaranteed 403.
  const { user, canManageSettings } = useAuth()
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const canEdit = canManageSettings
  const [s, setS] = useState<MailSecuritySettings | null>(null)
  const [entries, setEntries] = useState<SpamListEntry[]>([])
  // Die Liste braucht eine eigene Mail-Berechtigung; ohne sie bleibt der
  // Abschnitt sichtbar, aber ausdruecklich nicht bedienbar.
  const [spamListAvailable, setSpamListAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [testingRspamd, setTestingRspamd] = useState(false)
  const [newListType, setNewListType] = useState<"allow" | "block">("allow")
  const [newPattern, setNewPattern] = useState("")
  const [newNote, setNewNote] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const settings = await invokeRenderer(IPCChannels.Email.GetMailSecuritySettings) as MailSecuritySettings
      setS(settings)
    } catch (e) {
      console.error(e)
      toast.error("Mail-Sicherheit konnte nicht geladen werden.")
    }
    // GETRENNT laden: die Allow-/Blocklist haengt an der Mail-Policy
    // (mail.metadata.read ueber den gesamten Workspace), die Einstellungen
    // daneben an settings.view/manage. Ein delegierter Einstellungsnutzer ohne
    // vollen Mail-Scope bekommt hier 403 — in einem gemeinsamen Promise.all
    // haette der auch die erfolgreich geladenen Sicherheitseinstellungen
    // verworfen und das ganze Panel leer gelassen.
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListSpamListEntries, "all") as SpamListEntry[]
      setEntries(list)
      setSpamListAvailable(true)
    } catch (e) {
      console.error(e)
      setEntries([])
      setSpamListAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailSpamListRefreshEvent(event)) {
          void load()
        }
      },
    })
    return () => subscription.unsubscribe()
  }, [load])

  const patch = (partial: Partial<MailSecuritySettings>) => {
    if (!canEdit) return
    setS((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const save = async () => {
    if (!s || !canEdit) return
    try {
      await invokeRenderer(IPCChannels.Email.SetMailSecuritySettings, s)
      toast.success("Mail-Sicherheit gespeichert.")
      await load()
    } catch (e) {
      console.error(e)
      toast.error("Speichern fehlgeschlagen.")
    }
  }

  const addEntry = async () => {
    if (!canEdit || !spamListAvailable) return
    const pattern = newPattern.trim()
    if (!pattern) return
    const result = await invokeRenderer(IPCChannels.Email.SaveSpamListEntry, {
      listType: newListType,
      pattern,
      note: newNote.trim() || null,
    }) as { success: true; entry: SpamListEntry } | { success: false; error?: string }
    if (!result.success) {
      toast.error(result.error ?? "Eintrag konnte nicht gespeichert werden.")
      return
    }
    setNewPattern("")
    setNewNote("")
    toast.success("Listen-Eintrag gespeichert.")
    await load()
  }

  const deleteEntry = async (id: number) => {
    if (!canEdit) return
    try {
      const result = await invokeRenderer(IPCChannels.Email.DeleteSpamListEntry, id) as { success: boolean; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Listen-Eintrag konnte nicht geloescht werden.")
        return
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Listen-Eintrag konnte nicht geloescht werden.")
      return
    }
    toast.success("Listen-Eintrag geloescht.")
    await load()
  }

  const testRspamd = async () => {
    if (!s) return
    setTestingRspamd(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.TestRspamdConnection,
        { rspamdUrl: s.rspamdUrl, rspamdTimeoutMs: s.rspamdTimeoutMs },
      ) as { success: boolean; message?: string; error?: string }
      if (r.success) toast.success(r.message ?? "Rspamd OK")
      else toast.error(r.error ?? "Rspamd nicht erreichbar")
    } finally {
      setTestingRspamd(false)
    }
  }

  if (loading || !s) {
    return <p className="text-sm text-muted-foreground">Laedt...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Mail-Sicherheit</h3>
        <p className="text-sm text-muted-foreground">
          SPF, DKIM, DMARC, ARC, Rspamd und die SimpleCRM-Spam-Engine laufen vor eingehenden Workflows.
          Workflows entscheiden danach, ob eine Mail sauber bleibt, in Spam pruefen landet oder als Spam markiert wird.
        </p>
        {!canEdit ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nur Leserechte (`settings.view`) — Änderungen sind deaktiviert.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Mailauth</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">SPF/DKIM/DMARC/ARC pruefen</Label>
          <Switch checked={s.mailauthEnabled} disabled={!canEdit} onCheckedChange={(on) => patch({ mailauthEnabled: on })} />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">SimpleCRM-Spam-Engine</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Engine aktiv</Label>
          <Switch checked={s.spamEngineEnabled} disabled={!canEdit} onCheckedChange={(on) => patch({ spamEngineEnabled: on })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label className="text-xs">Spam pruefen ab</Label>
            <Input
              type="number"
              min={0}
              max={100}
              disabled={!canEdit}
              value={String(s.spamReviewThreshold)}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10)
                patch({ spamReviewThreshold: Number.isFinite(value) ? value : 45 })
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Spam ab</Label>
            <Input
              type="number"
              min={0}
              max={100}
              disabled={!canEdit}
              value={String(s.spamSpamThreshold)}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10)
                patch({ spamSpamThreshold: Number.isFinite(value) ? value : 75 })
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Lernen aus Korrekturen</Label>
          <Switch checked={s.localLearningEnabled} disabled={!canEdit} onCheckedChange={(on) => patch({ localLearningEnabled: on })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Rspamd-Score in SimpleCRM-Score einrechnen</Label>
          <Switch
            checked={s.rspamdContributionEnabled}
            disabled={!canEdit}
            onCheckedChange={(on) => patch({ rspamdContributionEnabled: on })}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Rspamd optional</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Rspamd-Check aktiv</Label>
          <Switch checked={s.rspamdEnabled} disabled={!canEdit} onCheckedChange={(on) => patch({ rspamdEnabled: on })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Rspamd aus Korrekturen lernen lassen</Label>
          <Switch
            checked={s.rspamdLearningEnabled}
            disabled={!canEdit}
            onCheckedChange={(on) => patch({ rspamdLearningEnabled: on })}
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">Controller-URL</Label>
          {/* SSRF-Grenze: der Server erlaubt eine AENDERUNG dieser URL nur
              Administratoren und lehnt sonst das ganze PATCH ab — inklusive der
              uebrigen Felder. Fuer delegierte settings.manage-Halter daher
              gesperrt statt scheinbar editierbar. */}
          <Input
            value={s.rspamdUrl}
            disabled={!canEdit || !isAdmin}
            onChange={(e) => patch({ rspamdUrl: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label className="text-xs">Timeout (ms)</Label>
            <Input
              type="number"
              disabled={!canEdit}
              value={String(s.rspamdTimeoutMs)}
              onChange={(e) => patch({ rspamdTimeoutMs: parseInt(e.target.value, 10) || 8000 })}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Rspamd-Spam ab Score</Label>
            <Input
              type="number"
              step="0.5"
              disabled={!canEdit}
              value={String(s.rspamdSpamScore)}
              onChange={(e) => patch({ rspamdSpamScore: parseFloat(e.target.value) || 15 })}
            />
          </div>
        </div>
        {isAdmin ? (
          <Button type="button" size="sm" variant="outline" disabled={testingRspamd} onClick={() => void testRspamd()}>
            {testingRspamd ? "Teste..." : "Rspamd-Verbindung testen"}
          </Button>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Allowlist / Blocklist</h4>
        {spamListAvailable ? null : (
          <p className="text-xs text-muted-foreground">
            Nicht verfügbar: die Allow-/Blocklist erfordert Zugriff auf alle Postfächer des
            Workspace. Die Sicherheitseinstellungen oben lassen sich unabhängig davon bearbeiten.
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-[140px_1fr_1fr_auto]">
          <div className="flex rounded-md border p-1">
            <Button
              type="button"
              size="sm"
              variant={newListType === "allow" ? "secondary" : "ghost"}
              disabled={!canEdit || !spamListAvailable}
              onClick={() => setNewListType("allow")}
            >
              Allow
            </Button>
            <Button
              type="button"
              size="sm"
              variant={newListType === "block" ? "secondary" : "ghost"}
              disabled={!canEdit || !spamListAvailable}
              onClick={() => setNewListType("block")}
            >
              Block
            </Button>
          </div>
          <Input value={newPattern} disabled={!canEdit || !spamListAvailable} onChange={(e) => setNewPattern(e.target.value)} placeholder="kunde.de oder name@kunde.de" />
          <Input value={newNote} disabled={!canEdit || !spamListAvailable} onChange={(e) => setNewNote(e.target.value)} placeholder="Notiz" />
          <Button type="button" size="icon" disabled={!canEdit || !spamListAvailable} onClick={() => void addEntry()} title="Eintrag hinzufuegen">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="divide-y rounded-md border">
          {entries.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Noch keine Eintraege.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[88px_88px_1fr_auto] items-center gap-2 px-3 py-2 text-sm">
                <span className={entry.list_type === "allow" ? "text-emerald-700" : "text-red-700"}>
                  {entry.list_type === "allow" ? "Allow" : "Block"}
                </span>
                <span className="text-muted-foreground">{entry.pattern_type}</span>
                <span className="min-w-0 truncate" title={entry.note ?? entry.pattern}>
                  {entry.pattern}
                  {entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}
                </span>
                <Button type="button" size="icon" variant="ghost" disabled={!canEdit} onClick={() => void deleteEntry(entry.id)} title="Eintrag loeschen">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <Button type="button" disabled={!canEdit} onClick={() => void save()}>
        Speichern
      </Button>
    </div>
  )
}
