"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  is_active: number
}

export function UsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [inviteLink, setInviteLink] = useState("")
  const [inviteDelivery, setInviteDelivery] = useState("")
  const [busy, setBusy] = useState(false)
  const serverClientMode = getRendererTransport().kind === "http"

  const load = useCallback(async () => {
    const rows = await invokeRenderer(IPCChannels.Auth.ListUsers, undefined)
    if (Array.isArray(rows)) setUsers(rows as UserRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createUser = async () => {
    if (!username.trim() || !passphrase) return
    setBusy(true)
    try {
      await invokeRenderer(IPCChannels.Auth.SaveUser, {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        role: "agent",
        passphrase,
      })
      setUsername("")
      setDisplayName("")
      setPassphrase("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const createInvite = async () => {
    if (!username.trim()) return
    setBusy(true)
    try {
      const result = await invokeRenderer(IPCChannels.Auth.CreateInvite, {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        role: "agent",
        expiresInDays: 7,
      }) as { acceptPath?: string; token?: string; delivery?: unknown }
      const link = buildInviteLink(result.acceptPath, result.token)
      setInviteLink(link)
      setInviteDelivery(inviteDeliveryMessage(result.delivery))
      if (link && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(link).catch(() => undefined)
      }
      setPassphrase("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benutzer</CardTitle>
        <CardDescription>
          Konten fuer Anmeldung, Rollen und Audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex justify-between gap-2 border-b py-1">
              <span>
                {u.display_name} ({u.username}) — {u.role}
              </span>
              <span className="text-muted-foreground">{u.is_active ? "aktiv" : "inaktiv"}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Benutzername / E-Mail</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <Label>Anzeigename</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Passphrase</Label>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
        </div>
        <Button type="button" disabled={busy} onClick={() => void createUser()}>
          Benutzer anlegen
        </Button>
        {serverClientMode ? (
          <div className="space-y-2">
            <Button type="button" variant="outline" disabled={busy || !username.trim()} onClick={() => void createInvite()}>
              Einladungslink erstellen
            </Button>
            {inviteLink ? (
              <div className="space-y-1">
                <Label htmlFor="auth-invite-link">Einladungslink</Label>
                <Input id="auth-invite-link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                {inviteDelivery ? (
                  <p className="text-sm text-muted-foreground">{inviteDelivery}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function buildInviteLink(acceptPath: string | undefined, token: string | undefined): string {
  const path = acceptPath ?? (token ? `/login?invite=${encodeURIComponent(token)}` : "")
  if (!path) return ""
  if (typeof window === "undefined") return path
  try {
    return new URL(path, window.location.origin).toString()
  } catch {
    return path
  }
}

function inviteDeliveryMessage(delivery: unknown): string {
  if (!delivery || typeof delivery !== "object") {
    return ""
  }
  const status = "status" in delivery ? delivery.status : undefined
  if (status === "sent") {
    const recipient = "recipient" in delivery && typeof delivery.recipient === "string" ? delivery.recipient : ""
    return recipient ? `E-Mail an ${recipient} versendet.` : "Einladungs-E-Mail versendet."
  }
  if (status === "failed") {
    return "Einladung erstellt, E-Mail-Versand fehlgeschlagen."
  }
  if (status === "not_configured") {
    return "SMTP fuer Einladungen ist nicht konfiguriert; Link wurde kopiert."
  }
  return ""
}
