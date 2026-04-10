"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { hasElectron, invokeIpc, type TeamMember } from "../types"

export function TeamPanel() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setTeam(await invokeIpc<TeamMember[]>(IPCChannels.Email.ListTeamMembers))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Team &amp; Zuweisung</h3>
        <p className="text-sm text-muted-foreground">
          Mitglieder, denen Nachrichten im Metadaten-Panel zugewiesen werden können.
        </p>
      </div>
      <div className="space-y-2">
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Mitglieder.</p>
        ) : (
          team.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-mono text-xs text-muted-foreground">{t.id}</span> ·{" "}
                {t.display_name}
              </span>
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
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-[140px] font-mono text-xs"
          placeholder="ID"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <Input
          className="min-w-[160px] flex-1"
          placeholder="Anzeigename"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            if (!newId.trim() || !newName.trim()) return
            await invokeIpc(IPCChannels.Email.SaveTeamMember, {
              id: newId.trim(),
              displayName: newName.trim(),
            })
            setNewId("")
            setNewName("")
            await load()
            toast.success("Mitglied gespeichert")
          }}
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  )
}
