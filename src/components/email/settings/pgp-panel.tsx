"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  getRendererTransport,
  invokeRenderer,
  isMailPgpKeyRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"

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
  const [rotationIdentityId, setRotationIdentityId] = useState<number | null>(null)
  const [rotationCurrentPassphrase, setRotationCurrentPassphrase] = useState("")
  const [rotationNextPassphrase, setRotationNextPassphrase] = useState("")
  const serverClientMode = getRendererTransport().kind === "http"

  const reload = useCallback(async () => {
    const ids = await invokeRenderer(IPCChannels.Pgp.ListIdentities, undefined)
    const pk = await invokeRenderer(IPCChannels.Pgp.ListPeerKeys, undefined)
    if (Array.isArray(ids)) setIdentities(ids as Identity[])
    if (Array.isArray(pk)) setPeers(pk as PeerKey[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!serverClientMode) return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailPgpKeyRefreshEvent(event)) void reload()
      },
    })
    return () => subscription.unsubscribe()
  }, [reload, serverClientMode])

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
              await invokeRenderer(IPCChannels.Pgp.GenerateIdentity, {
                email: genEmail.trim(),
                passphrase: genPass,
              })
              setGenPass("")
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
        {serverClientMode && identities.some((i) => i.has_private_key) ? (
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div>
              <Label htmlFor="pgp-rotation-identity">Identitaet</Label>
              <select
                id="pgp-rotation-identity"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={rotationIdentityId ?? ""}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setRotationIdentityId(Number.isFinite(value) && value !== 0 ? value : null)
                  setRotationCurrentPassphrase("")
                  setRotationNextPassphrase("")
                }}
              >
                <option value="">Auswaehlen</option>
                {identities.filter((identity) => identity.has_private_key).map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pgp-current-pass">Aktuelle Passphrase</Label>
              <Input
                id="pgp-current-pass"
                type="password"
                value={rotationCurrentPassphrase}
                onChange={(event) => setRotationCurrentPassphrase(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pgp-next-pass">Neue Passphrase</Label>
              <Input
                id="pgp-next-pass"
                type="password"
                value={rotationNextPassphrase}
                onChange={(event) => setRotationNextPassphrase(event.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={rotationIdentityId === null}
                onClick={async () => {
                  if (rotationIdentityId === null) return
                  try {
                    await invokeRenderer(IPCChannels.Pgp.RotateIdentityPassphrase, {
                      id: rotationIdentityId,
                      currentPassphrase: rotationCurrentPassphrase,
                      nextPassphrase: rotationNextPassphrase,
                    })
                    toast.success("Passphrase aktualisiert")
                    setRotationIdentityId(null)
                    setRotationCurrentPassphrase("")
                    setRotationNextPassphrase("")
                    void reload()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Rotation fehlgeschlagen")
                  }
                }}
              >
                Aktualisieren
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRotationIdentityId(null)
                  setRotationCurrentPassphrase("")
                  setRotationNextPassphrase("")
                }}
              >
                Leeren
              </Button>
            </div>
          </div>
        ) : null}
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
              await invokeRenderer(IPCChannels.Pgp.ImportPeerKey, { armored: importArmor })
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
                  await invokeRenderer(IPCChannels.Pgp.DeletePeerKey, { id: p.id })
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
