"use client"

import { useState } from "react"
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"

/** Sanitized credential record (never contains the password). */
export type SmtpRelayCredential = {
  id: string
  username: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

type RevealedCredential = {
  id: string
  username: string
  password: string
}

export function formatRelayDateTime(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/**
 * SMTP-AUTH credentials of a single relay: mint (reveal-once dialog), list and
 * revoke. Mirrors the automation panel's server API keys — the generated
 * password is shown exactly once and never persisted client-side.
 */
export function RelayCredentialsSection(props: {
  relayId: string
  credentials: SmtpRelayCredential[]
  isAdmin: boolean
  onCredentialsChanged(next: SmtpRelayCredential[]): void
}) {
  const { relayId, credentials, isAdmin, onCredentialsChanged } = props
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null)

  const createCredential = async () => {
    setCreating(true)
    try {
      const created = await invokeRenderer(IPCChannels.Email.CreateSmtpRelayCredential, {
        relayId,
      }) as RevealedCredential
      setRevealed(created)
      onCredentialsChanged([
        ...credentials,
        {
          id: created.id,
          username: created.username,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zugangsdaten konnten nicht erzeugt werden.")
    } finally {
      setCreating(false)
    }
  }

  const revokeCredential = async (credential: SmtpRelayCredential) => {
    if (!window.confirm(
      `Zugangsdaten "${credential.username}" wirklich widerrufen? Externe Systeme können sich damit nicht mehr anmelden.`,
    )) return
    setRevokingId(credential.id)
    try {
      const result = await invokeRenderer(IPCChannels.Email.RevokeSmtpRelayCredential, {
        relayId,
        credentialId: credential.id,
      }) as { revoked: true; credential: SmtpRelayCredential }
      onCredentialsChanged(credentials.map((entry) =>
        entry.id === credential.id ? result.credential : entry,
      ))
      toast.success("Zugangsdaten widerrufen.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Widerruf fehlgeschlagen.")
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Zugangsdaten (SMTP AUTH)</h4>
          <p className="text-xs text-muted-foreground">
            Anmeldedaten für externe Systeme, die über dieses Relay senden.
          </p>
        </div>
        {isAdmin ? (
          <Button type="button" size="sm" onClick={() => void createCredential()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Zugangsdaten erzeugen
          </Button>
        ) : null}
      </div>

      {credentials.length ? (
        <div className="divide-y rounded-lg border">
          {credentials.map((credential) => (
            <div
              key={credential.id}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-1 text-xs">{credential.username}</code>
                  {credential.revokedAt ? (
                    <Badge variant="destructive">Widerrufen</Badge>
                  ) : (
                    <Badge variant="secondary">Aktiv</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Erstellt: {formatRelayDateTime(credential.createdAt)}
                  {" · "}
                  {credential.lastUsedAt
                    ? `Zuletzt verwendet: ${formatRelayDateTime(credential.lastUsedAt)}`
                    : "Nie verwendet"}
                  {credential.revokedAt
                    ? ` · Widerrufen: ${formatRelayDateTime(credential.revokedAt)}`
                    : ""}
                </p>
              </div>
              {isAdmin && !credential.revokedAt ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void revokeCredential(credential)}
                  disabled={revokingId === credential.id}
                >
                  {revokingId === credential.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Widerrufen
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Noch keine Zugangsdaten. Ohne aktive Zugangsdaten kann sich kein externes System anmelden.
        </p>
      )}

      <RelayConnectionHelp />

      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue SMTP-Zugangsdaten</DialogTitle>
            <DialogDescription>
              Passwort wird nur einmal angezeigt. Jetzt kopieren und sicher im externen System
              (z. B. JTL-Wawi) hinterlegen — es kann später nicht erneut abgerufen werden.
            </DialogDescription>
          </DialogHeader>
          {revealed ? (
            <div className="space-y-3">
              <CredentialField label="Benutzername" value={revealed.username} />
              <CredentialField label="Passwort" value={revealed.password} />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setRevealed(null)}>
              Fertig
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * Connection cheat-sheet for the external system: host, ports, AUTH source and
 * the From-must-match-allowed-account rule.
 */
export function RelayConnectionHelp() {
  const host = relayHostHint()
  return (
    <div className="space-y-1 rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
      <p className="text-sm font-medium text-foreground">Verbindung für externe Systeme</p>
      <p>
        SMTP-Host: <code className="rounded bg-muted px-1">{host || "<Server-Hostname>"}</code>
      </p>
      <p>Port 587 (STARTTLS) oder Port 465 (SSL/TLS)</p>
      <p>Anmeldung: SMTP AUTH mit Benutzername und Passwort aus den erzeugten Zugangsdaten</p>
      <p>Die Absenderadresse (From) muss einem freigegebenen Konto des Relays entsprechen.</p>
    </div>
  )
}

/**
 * The relay listens on the SimpleCRM server. Prefer the configured server URL
 * (correct in Electron server-client mode); the browser app falls back to its
 * own hostname, which IS the server host there.
 */
function relayHostHint(): string {
  const transport = getRendererTransport()
  if (transport.kind === "http" && transport.serverBaseUrl) {
    try {
      return new URL(transport.serverBaseUrl).hostname
    } catch {
      // fall through to window.location below
    }
  }
  return typeof window !== "undefined" ? window.location.hostname : ""
}

function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{value}</code>
        <Button type="button" variant="outline" size="sm" onClick={() => void copyText(value, label)}>
          <Copy className="h-4 w-4" />
          Kopieren
        </Button>
      </div>
    </div>
  )
}

async function copyText(value: string, label: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.error("Zwischenablage ist nicht verfügbar.")
    return
  }
  await navigator.clipboard.writeText(value)
  toast.success(`${label} kopiert.`)
}
