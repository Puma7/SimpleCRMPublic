"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { hasElectron, invokeIpc } from "@/components/email/types"

type Identity = {
  id: number
  email: string
  fingerprint: string
  has_private_key: number
  is_primary: number
}

type PeerKey = {
  id: number
  email: string
  fingerprint: string
  trust_level: string
  source: string
}

export function PgpPanel() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [peers, setPeers] = useState<PeerKey[]>([])
  const [genEmail, setGenEmail] = useState("")
  const [genPass, setGenPass] = useState("")
  const [importArmor, setImportArmor] = useState("")

  const reload = useCallback(async () => {
    if (!hasElectron()) return
    const ids = await invokeIpc(IPCChannels.Pgp.ListIdentities, undefined)
    const pk = await invokeIpc(IPCChannels.Pgp.ListPeerKeys, undefined)
    if (Array.isArray(ids)) setIdentities(ids as Identity[])
    if (Array.isArray(pk)) setPeers(pk as PeerKey[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">PGP-Schlüsselbund</h2>
        <p className="text-sm text-muted-foreground">
          Eigene Identitäten und öffentliche Empfänger-Schlüssel für Verschlüsselung beim Versand.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Eigene Identität erzeugen</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="pgp-email">E-Mail</Label>
            <Input id="pgp-email" value={genEmail} onChange={(e) => setGenEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pgp-pass">Passphrase</Label>
            <Input
              id="pgp-pass"
              type="password"
              value={genPass}
              onChange={(e) => setGenPass(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            try {
              await invokeIpc(IPCChannels.Pgp.GenerateIdentity, {
                email: genEmail.trim(),
                passphrase: genPass,
              })
              toast.success("Identität erzeugt")
              void reload()
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Fehler")
            }
          }}
        >
          Schlüssel erzeugen
        </Button>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {identities.map((i) => (
            <li key={i.id}>
              {i.email} — {i.fingerprint.slice(0, 20)}…
              {i.has_private_key ? " (privat)" : ""}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Empfänger-Schlüssel importieren</h3>
        <Textarea
          value={importArmor}
          onChange={(e) => setImportArmor(e.target.value)}
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
          rows={6}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await invokeIpc(IPCChannels.Pgp.ImportPeerKey, { armored: importArmor })
              toast.success("Schlüssel importiert")
              setImportArmor("")
              void reload()
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Import fehlgeschlagen")
            }
          }}
        >
          Öffentlichen Schlüssel importieren
        </Button>
        <ul className="divide-y text-sm">
          {peers.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>
                {p.email} <span className="text-muted-foreground">({p.trust_level})</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await invokeIpc(IPCChannels.Pgp.DeletePeerKey, { id: p.id })
                  void reload()
                }}
              >
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
