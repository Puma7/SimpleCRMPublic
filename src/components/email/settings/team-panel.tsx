"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { hasElectron, invokeIpc, type TeamMember } from "../types"
import { AccountSignaturesSection } from "./account-signatures-section"

export function TeamPanel() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [newSignature, setNewSignature] = useState(
    "<p>Mit freundlichen Grüßen<br/>Ihr Kundenservice</p>",
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSignature, setEditSignature] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setTeam(await invokeIpc<TeamMember[]>(IPCChannels.Email.ListTeamMembers))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveMember = async (payload: {
    id: string
    displayName: string
    signatureHtml?: string | null
  }) => {
    await invokeIpc(IPCChannels.Email.SaveTeamMember, {
      id: payload.id,
      displayName: payload.displayName,
      signatureHtml: payload.signatureHtml,
    })
    await load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Team, Zuweisung &amp; Signaturen</h3>
        <p className="text-sm text-muted-foreground">
          Mitglieder können Nachrichten zugewiesen bekommen. Unter „Signatur pro Konto“ legen Sie
          Shop-spezifische Fußzeilen fest; die Team-Signatur dient als Fallback.
        </p>
      </div>
      <AccountSignaturesSection />
      <div className="space-y-2">
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Mitglieder.</p>
        ) : (
          team.map((t) => (
            <div key={t.id} className="space-y-2 rounded border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-mono text-xs text-muted-foreground">{t.id}</span> ·{" "}
                  {t.display_name}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(t.id)
                      setEditSignature(t.signature_html ?? "")
                    }}
                  >
                    Signatur
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await invokeIpc(IPCChannels.Email.DeleteTeamMember, t.id)
                      await load()
                    }}
                  >
                    Entfernen
                  </Button>
                </div>
              </div>
              {editingId === t.id ? (
                <div className="space-y-2 border-t pt-2">
                  <Label className="text-xs">Signatur (HTML)</Label>
                  <Textarea
                    rows={4}
                    value={editSignature}
                    onChange={(e) => setEditSignature(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      void saveMember({
                        id: t.id,
                        displayName: t.display_name,
                        signatureHtml: editSignature,
                      }).then(() => {
                        setEditingId(null)
                        toast.success("Signatur gespeichert")
                      })
                    }
                  >
                    Signatur speichern
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Neues Mitglied</p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-[140px] font-mono text-xs"
            placeholder="ID (z. B. agent-2)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <Input
            className="min-w-[160px] flex-1"
            placeholder="Anzeigename"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Signatur (HTML)</Label>
          <Textarea
            rows={3}
            value={newSignature}
            onChange={(e) => setNewSignature(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            if (!newId.trim() || !newName.trim()) return
            await saveMember({
              id: newId.trim(),
              displayName: newName.trim(),
              signatureHtml: newSignature,
            })
            setNewId("")
            setNewName("")
            toast.success("Mitglied gespeichert")
          }}
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  )
}
