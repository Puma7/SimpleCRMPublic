"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth/auth-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { invokeRenderer } from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"

type TrackingLegalBasis = "consent" | "legitimate_interest" | "contract" | "other"

export type EmailTrackingPolicy = {
  enabled: boolean
  trackOpens: boolean
  trackLinks: boolean
  collectDerivedMetadata: boolean
  collectRawMetadata: boolean
  ipInsightsEnabled: boolean
  rawMetadataRetentionDays: number
  eventRetentionDays: number
  tokenTtlDays: number
  legalBasis: TrackingLegalBasis | null
  privacyNoticeUrl: string | null
  complianceAcknowledgedAt: string | null
  publicBaseUrl: string
  updatedAt: string | null
}

export function TrackingSettingsPanel() {
  const { user, loading: authLoading } = useAuth()
  const hasUser = Boolean(user)
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const [policy, setPolicy] = useState<EmailTrackingPolicy | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await invokeRenderer(
        IPCChannels.Email.GetEmailTrackingSettings,
      ) as EmailTrackingPolicy
      setPolicy(next)
      setAcknowledged(Boolean(next.complianceAcknowledgedAt))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nachverfolgung konnte nicht geladen werden."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && hasUser) void load()
  }, [authLoading, hasUser, load])

  const patch = (values: Partial<EmailTrackingPolicy>) => {
    setPolicy((current) => current ? { ...current, ...values } : current)
    setAcknowledged(false)
  }

  const save = async () => {
    if (!policy || !isAdmin) return
    if (policy.enabled && !policy.trackOpens && !policy.trackLinks) {
      toast.error("Wählen Sie mindestens Öffnungen oder Link-Klicks aus.")
      return
    }
    if (policy.enabled && (!policy.legalBasis || !policy.privacyNoticeUrl?.trim() || !acknowledged)) {
      toast.error("Rechtsgrundlage, Datenschutzhinweis und Bestätigung sind zum Aktivieren erforderlich.")
      return
    }
    setSaving(true)
    try {
      const next = await invokeRenderer(IPCChannels.Email.SetEmailTrackingSettings, {
        enabled: policy.enabled,
        trackOpens: policy.trackOpens,
        trackLinks: policy.trackLinks,
        collectDerivedMetadata: policy.collectDerivedMetadata,
        collectRawMetadata: policy.collectRawMetadata,
        ipInsightsEnabled: policy.ipInsightsEnabled,
        rawMetadataRetentionDays: policy.rawMetadataRetentionDays,
        eventRetentionDays: policy.eventRetentionDays,
        tokenTtlDays: policy.tokenTtlDays,
        legalBasis: policy.legalBasis,
        privacyNoticeUrl: policy.privacyNoticeUrl?.trim() || null,
        complianceAcknowledged: acknowledged,
      }) as EmailTrackingPolicy
      setPolicy(next)
      setAcknowledged(Boolean(next.complianceAcknowledgedAt))
      toast.success("Nachverfolgung gespeichert.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Einstellungen werden geladen…
      </div>
    )
  }

  if (!policy) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Nachverfolgung nicht verfügbar</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{loadError ?? "Die Einstellungen konnten nicht geladen werden."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Erneut versuchen
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">E-Mail-Nachverfolgung</h2>
        <p className="text-sm text-muted-foreground">
          Versand-, Zustell- und Interaktionssignale für ausgehende HTML-E-Mails.
        </p>
      </div>

      {!isAdmin ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Nur lesbar</AlertTitle>
          <AlertDescription>Änderungen sind Ownern und Admins vorbehalten.</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-4 border-b pb-6">
        <SettingSwitch
          id="tracking-enabled"
          label="Nachverfolgung aktiv"
          checked={policy.enabled}
          disabled={!isAdmin}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingSwitch
            id="tracking-opens"
            label="Öffnungssignale per Pixel"
            checked={policy.trackOpens}
            disabled={!isAdmin}
            onCheckedChange={(trackOpens) => patch({ trackOpens })}
          />
          <SettingSwitch
            id="tracking-links"
            label="Klicksignale für HTTP(S)-Links"
            checked={policy.trackLinks}
            disabled={!isAdmin}
            onCheckedChange={(trackLinks) => patch({ trackLinks })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Pixelabrufe können von Datenschutz-Proxys oder Sicherheits-Scannern stammen und gelten deshalb nur als Signal.
          PGP-verschlüsselte und reine Textnachrichten werden nicht instrumentiert.
        </p>
      </section>

      <section className="space-y-4 border-b pb-6">
        <h3 className="text-sm font-medium">Metadaten</h3>
        <SettingSwitch
          id="tracking-derived"
          label="Abgeleitete Geräte- und Clientdaten speichern"
          checked={policy.collectDerivedMetadata}
          disabled={!isAdmin || policy.collectRawMetadata}
          onCheckedChange={(collectDerivedMetadata) => patch({
            collectDerivedMetadata,
            ...(!collectDerivedMetadata ? { ipInsightsEnabled: false } : {}),
          })}
        />
        <SettingSwitch
          id="tracking-raw"
          label="IP-Adresse und User-Agent verschlüsselt speichern"
          checked={policy.collectRawMetadata}
          disabled={!isAdmin}
          onCheckedChange={(collectRawMetadata) => patch({
            collectRawMetadata,
            ...(collectRawMetadata ? { collectDerivedMetadata: true } : {}),
            ...(!collectRawMetadata ? { ipInsightsEnabled: false } : {}),
          })}
        />
        <div className="space-y-1">
          <SettingSwitch
            id="tracking-ip-insights"
            label="IP-Insights aus lokalen Datenbanken"
            checked={policy.ipInsightsEnabled}
            disabled={!isAdmin || !policy.collectDerivedMetadata || !policy.collectRawMetadata}
            onCheckedChange={(ipInsightsEnabled) => patch({ ipInsightsEnabled })}
          />
          <p className="text-xs text-muted-foreground">
            Ordnet nur die abrufende Infrastruktur lokal einem Land und Netzwerk zu. Kein Nachweis eines Empfängerstandorts; die Option aktiviert weder Roh- noch abgeleitete Metadaten.
          </p>
          {!policy.collectDerivedMetadata || !policy.collectRawMetadata ? (
            <p className="text-xs text-muted-foreground">Erfordert aktivierte abgeleitete Daten sowie verschlüsselt gespeicherte IP-Adresse und User-Agent.</p>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="tracking-raw-days"
            label="Rohdaten (Tage)"
            value={policy.rawMetadataRetentionDays}
            min={1}
            max={30}
            disabled={!isAdmin}
            onChange={(rawMetadataRetentionDays) => patch({ rawMetadataRetentionDays })}
          />
          <NumberField
            id="tracking-event-days"
            label="Ereignisse (Tage)"
            value={policy.eventRetentionDays}
            min={30}
            max={3650}
            disabled={!isAdmin}
            onChange={(eventRetentionDays) => patch({ eventRetentionDays })}
          />
          <NumberField
            id="tracking-token-days"
            label="Token gültig (Tage)"
            value={policy.tokenTtlDays}
            min={1}
            max={3650}
            disabled={!isAdmin}
            onChange={(tokenTtlDays) => patch({ tokenTtlDays })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium">Datenschutzentscheidung</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tracking-legal-basis">Rechtsgrundlage</Label>
            <Select
              value={policy.legalBasis ?? "none"}
              disabled={!isAdmin}
              onValueChange={(value) => patch({
                legalBasis: value === "none" ? null : value as TrackingLegalBasis,
              })}
            >
              <SelectTrigger id="tracking-legal-basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nicht festgelegt</SelectItem>
                <SelectItem value="consent">Einwilligung</SelectItem>
                <SelectItem value="legitimate_interest">Berechtigtes Interesse</SelectItem>
                <SelectItem value="contract">Vertrag</SelectItem>
                <SelectItem value="other">Andere</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tracking-privacy-url">Datenschutzhinweis (HTTPS)</Label>
            <Input
              id="tracking-privacy-url"
              type="url"
              value={policy.privacyNoticeUrl ?? ""}
              disabled={!isAdmin}
              onChange={(event) => patch({ privacyNoticeUrl: event.target.value })}
              placeholder="https://example.de/datenschutz"
            />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="tracking-ack"
            checked={acknowledged}
            disabled={!isAdmin}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          <Label htmlFor="tracking-ack" className="text-sm font-normal leading-5">
            Die gewählte Konfiguration wurde rechtlich geprüft; Informationspflichten, Widerspruchs- und Löschprozesse sind umgesetzt.
          </Label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">
            Öffentliche Basis: <span className="font-mono">{policy.publicBaseUrl}</span>
            {policy.privacyNoticeUrl ? (
              <a className="ml-2 inline-flex items-center gap-1 underline" href={policy.privacyNoticeUrl} target="_blank" rel="noreferrer">
                Hinweis <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <Button type="button" onClick={() => void save()} disabled={!isAdmin || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Speichern
          </Button>
        </div>
      </section>
    </div>
  )
}

function SettingSwitch(props: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  onCheckedChange(value: boolean): void
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Switch id={props.id} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onCheckedChange} />
    </div>
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
