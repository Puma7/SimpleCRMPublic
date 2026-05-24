"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { hasElectron, invokeIpc } from "../types"

type Kb = { id: number; name: string; description: string | null }

export function KnowledgePanel() {
  const [list, setList] = useState<Kb[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState("")
  const [chunkTitle, setChunkTitle] = useState("")
  const [chunkBody, setChunkBody] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    const rows = await invokeIpc<Kb[]>(IPCChannels.Email.ListKnowledgeBases)
    setList(rows)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createKb = async () => {
    if (!newName.trim()) return
    await invokeIpc(IPCChannels.Email.CreateKnowledgeBase, {
      name: newName.trim(),
    })
    setNewName("")
    toast.success("Wissensbasis angelegt.")
    await load()
  }

  const addChunk = async () => {
    if (selectedId == null || !chunkBody.trim()) return
    await invokeIpc(IPCChannels.Email.AddKnowledgeChunk, {
      knowledgeBaseId: selectedId,
      title: chunkTitle.trim() || "Eintrag",
      content: chunkBody,
    })
    setChunkBody("")
    toast.success("Eintrag hinzugefügt.")
  }

  const importFile = async () => {
    if (selectedId == null) return
    const r = await invokeIpc<{ success: boolean; id: number | null }>(
      IPCChannels.Email.ImportKnowledgeFile,
      { knowledgeBaseId: selectedId },
    )
    if (r.id) toast.success("Datei importiert.")
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">KI-Wissensbasis</h3>
        <p className="text-sm text-muted-foreground">
          Texte für den Agent-Knoten (einfache Stichwortsuche, lokal in SQLite).
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Name der Wissensbasis"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="button" onClick={() => void createKb()}>
          Anlegen
        </Button>
      </div>
      <ul className="divide-y rounded-lg border">
        {list.map((kb) => (
          <li
            key={kb.id}
            className={`cursor-pointer px-3 py-2 text-sm ${selectedId === kb.id ? "bg-muted" : ""}`}
            onClick={() => setSelectedId(kb.id)}
          >
            {kb.name}
          </li>
        ))}
      </ul>
      {selectedId != null ? (
        <div className="space-y-2 rounded-lg border p-4">
          <Label>Eintrag hinzufügen</Label>
          <Input
            placeholder="Titel"
            value={chunkTitle}
            onChange={(e) => setChunkTitle(e.target.value)}
          />
          <Textarea
            placeholder="Inhalt (FAQ, Retouren-Link, …)"
            value={chunkBody}
            onChange={(e) => setChunkBody(e.target.value)}
            rows={5}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void addChunk()}>
              Speichern
            </Button>
            <Button type="button" variant="outline" onClick={() => void importFile()}>
              Datei importieren…
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
