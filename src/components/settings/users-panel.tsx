"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeIpc, hasElectron } from "@/components/email/types"
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
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) return
    const rows = await invokeIpc(IPCChannels.Auth.ListUsers, undefined)
    if (Array.isArray(rows)) setUsers(rows as UserRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createUser = async () => {
    if (!username.trim() || !passphrase) return
    setBusy(true)
    await invokeIpc(IPCChannels.Auth.SaveUser, {
      username: username.trim(),
      displayName: displayName.trim() || username.trim(),
      role: "agent",
      passphrase,
    })
    setUsername("")
    setDisplayName("")
    setPassphrase("")
    setBusy(false)
    await load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benutzer</CardTitle>
        <CardDescription>
          Lokale Konten (Profil + Audit). Keine Verschlüsselung gegen andere Nutzer mit
          Dateizugriff.
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
            <Label>Benutzername</Label>
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
      </CardContent>
    </Card>
  )
}
