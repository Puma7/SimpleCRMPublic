"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Download, Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { hasElectron, invokeIpc } from "../types"
import { KnowledgeMarkdownEditor } from "./knowledge-markdown-editor"

type Kb = { id: number; name: string; description: string | null }

export function KnowledgePanel() {
  const [list, setList] = useState<Kb[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState("")
  const [markdown, setMarkdown] = useState("")
  const [fileName, setFileName] = useState("")
  const [dirty, setDirty] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadList = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const rows = await invokeIpc<Kb[]>(IPCChannels.Email.ListKnowledgeBases)
      setList(rows)
    } catch (e) {
      console.error(e)
      toast.error("Wissensbasen konnten nicht geladen werden.")
    }
  }, [])

  const loadDocument = useCallback(async (kbId: number) => {
    if (!hasElectron()) return
    setLoadingDoc(true)
    try {
      const r = await invokeIpc<
        | { success: true; content: string; fileName: string }
        | { success: false; error?: string }
      >(IPCChannels.Email.GetKnowledgeBaseDocument, kbId)
      if (!r.success) {
        toast.error(r.error ?? "Dokument konnte nicht geladen werden.")
        return
      }
      setMarkdown(r.content)
      setFileName(r.fileName)
      setDirty(false)
    } catch (e) {
      console.error(e)
      toast.error("Dokument konnte nicht geladen werden.")
    } finally {
      setLoadingDoc(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selectedId != null) {
      void loadDocument(selectedId)
    } else {
      setMarkdown("")
      setFileName("")
      setDirty(false)
    }
  }, [selectedId, loadDocument])

  const createKb = async () => {
    if (!newName.trim()) {
      toast.error("Bitte einen Namen eingeben.")
      return
    }
    try {
      const r = await invokeIpc<{ success: boolean; id?: number; error?: string }>(
        IPCChannels.Email.CreateKnowledgeBase,
        { name: newName.trim() },
      )
      if (r && "success" in r && r.success === false) {
        toast.error(r.error ?? "Anlegen fehlgeschlagen.")
        return
      }
      setNewName("")
      toast.success("Wissensbasis angelegt (mit leerer Markdown-Vorlage).")
      await loadList()
      if (r?.id) setSelectedId(r.id)
    } catch (e) {
      console.error(e)
      toast.error("Wissensbasis konnte nicht angelegt werden.")
    }
  }

  const saveDocument = async () => {
    if (selectedId == null) return
    setSaving(true)
    try {
      const r = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.SaveKnowledgeBaseDocument,
        { knowledgeBaseId: selectedId, content: markdown },
      )
      if (!r.success) {
        toast.error(r.error ?? "Speichern fehlgeschlagen.")
        return
      }
      setDirty(false)
      toast.success("Wissensbasis gespeichert.")
      await loadDocument(selectedId)
    } catch (e) {
      console.error(e)
      toast.error("Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  const exportMd = async () => {
    if (selectedId == null) return
    if (dirty) {
      const ok = window.confirm("Ungespeicherte Änderungen. Zuerst speichern?")
      if (ok) await saveDocument()
    }
    try {
      const r = await invokeIpc<
        { success: true; path: string | null } | { success: false; error?: string }
      >(IPCChannels.Email.ExportKnowledgeBaseDocument, selectedId)
      if (!r.success) {
        toast.error(r.error ?? "Export fehlgeschlagen.")
        return
      }
      if (r.path) toast.success(`Gespeichert: ${r.path}`)
    } catch (e) {
      console.error(e)
      toast.error("Export fehlgeschlagen.")
    }
  }

  const importMd = async () => {
    if (selectedId == null) return
    const ok = window.confirm(
      "Die hochgeladene Datei überschreibt den gesamten Inhalt dieser Wissensbasis. Fortfahren?",
    )
    if (!ok) return
    try {
      const r = await invokeIpc<{ success: boolean; id: number | null; error?: string }>(
        IPCChannels.Email.ImportKnowledgeFile,
        { knowledgeBaseId: selectedId },
      )
      if (!r.success) {
        toast.error(r.error ?? "Import fehlgeschlagen.")
        return
      }
      if (r.id == null) return
      toast.success("Markdown-Datei importiert und überschrieben.")
      await loadDocument(selectedId)
    } catch (e) {
      console.error(e)
      toast.error("Import fehlgeschlagen.")
    }
  }

  const deleteKb = async (id: number, name: string) => {
    const ok = window.confirm(`Wissensbasis „${name}" inkl. Markdown-Datei wirklich löschen?`)
    if (!ok) return
    try {
      await invokeIpc(IPCChannels.Email.DeleteKnowledgeBase, id)
      if (selectedId === id) setSelectedId(null)
      toast.success("Wissensbasis gelöscht.")
      await loadList()
    } catch (e) {
      console.error(e)
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">KI-Wissensbasis</h3>
        <p className="text-sm text-muted-foreground">
          Jeder Bereich ist eine <strong>Markdown-Datei</strong> (lokal unter{" "}
          <code className="text-xs">workflow-knowledge/</code>). Bearbeiten im Editor, exportieren,
          extern ändern und wieder importieren (überschreibt den Inhalt). Für Workflow-Agenten wird
          der Text indexiert (Stichwort + Embedding).
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Neuer Bereich (z. B. Retouren, Versand)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="button" onClick={() => void createKb()}>
          Anlegen
        </Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {list.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">Noch keine Wissensbasis.</li>
        ) : (
          list.map((kb) => (
            <li
              key={kb.id}
              className={`flex items-center gap-2 px-3 py-2 text-sm ${
                selectedId === kb.id ? "bg-muted" : ""
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left font-medium"
                onClick={() => setSelectedId(kb.id)}
              >
                {kb.name}
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-destructive"
                title="Löschen"
                onClick={() => void deleteKb(kb.id, kb.name)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))
        )}
      </ul>

      {selectedId != null ? (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {list.find((k) => k.id === selectedId)?.name ?? "Wissensbasis"}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{fileName}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void exportMd()}>
                <Download className="mr-1 h-3.5 w-3.5" />
                .md speichern
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void importMd()}>
                <Upload className="mr-1 h-3.5 w-3.5" />
                .md hochladen
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !dirty}
                onClick={() => void saveDocument()}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Speichern…
                  </>
                ) : (
                  "Speichern"
                )}
              </Button>
            </div>
          </div>

          {loadingDoc ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Lädt Markdown…
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Inhalt (Markdown)</Label>
              <KnowledgeMarkdownEditor
                value={markdown}
                onChange={(v) => {
                  setMarkdown(v)
                  setDirty(true)
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Wählen Sie links einen Bereich oder legen Sie einen neuen an.
        </p>
      )}
    </div>
  )
}
