"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SignatureQuillEditor } from "../signature-quill-editor"
import {
  getRendererTransport,
  invokeRenderer,
  isMailAccountDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { TeamMember } from "../types"
import { useMailWorkspace } from "../workspace-context"
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html"

export function TeamPanel() {
  const { bumpAccountsRevision } = useMailWorkspace()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [newSignature, setNewSignature] = useState(
    "<p>Mit freundlichen Grüßen<br/>Ihr Kundenservice</p>",
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSignature, setEditSignature] = useState("")

  const load = useCallback(async () => {
    setTeam(await invokeRenderer(IPCChannels.Email.ListTeamMembers) as TeamMember[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (getRendererTransport().kind !== "http") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailAccountDataRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load])

  const saveMember = async (payload: {
    id: string
    displayName: string
    signatureHtml?: string | null
  }) => {
    await invokeRenderer(IPCChannels.Email.SaveTeamMember, {
      id: payload.id,
      displayName: payload.displayName,
      signatureHtml:
        typeof payload.signatureHtml === "string"
          ? sanitizeEmailHtml(payload.signatureHtml)
          : payload.signatureHtml,
    })
    await load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Team &amp; Zuweisung</h3>
        <p className="text-sm text-muted-foreground">
          Mitglieder können Nachrichten zugewiesen bekommen. Die Team-Signatur dient als Fallback,
          wenn für ein Postfach keine eigene Signatur hinterlegt ist (unter Konten → Signatur).
        </p>
      </div>
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
                      setEditSignature(sanitizeEmailHtml(t.signature_html ?? ""))
                    }}
                  >
                    Signatur
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await invokeRenderer(IPCChannels.Email.DeleteTeamMember, t.id)
                      await load()
                    }}
                  >
                    Entfernen
                  </Button>
                </div>
              </div>
              {editingId === t.id ? (
                <div className="space-y-2 border-t pt-2">
                  <Label className="text-xs">Signatur</Label>
                  <SignatureQuillEditor
                    value={editSignature}
                    onChange={setEditSignature}
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
                        bumpAccountsRevision()
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
          <Label className="text-xs">Signatur</Label>
          <SignatureQuillEditor value={newSignature} onChange={setNewSignature} />
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
            bumpAccountsRevision()
            toast.success("Mitglied gespeichert")
          }}
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  )
}
