"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Download, Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getRendererTransport,
  invokeRenderer,
  isWorkflowKnowledgeRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { hasLocalIpc, invokeIpc } from "../types"
import { KnowledgeMarkdownEditor } from "./knowledge-markdown-editor"
import {
  AccountScopeToolbar,
  ScopeBadge,
  listPayloadForScope,
  mutationScopeFields,
  type AccountScopeValue,
} from "./account-scope-toolbar"
import { KNOWLEDGE_CONTEXT_LABELS, KNOWLEDGE_CONTEXTS, type KnowledgeContext } from "@shared/knowledge-context"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AccountOverrideActions } from "./account-override-actions"
import {
  createKnowledgeBaseAccountOverride,
  resetKnowledgeBaseAccountOverride,
} from "./account-override-mutations"

type Kb = {
  id: number
  name: string
  description: string | null
  account_id?: number | null
  override_key?: string | null
  knowledge_context?: string | null
}

function safeMarkdownFileName(fileName: string, fallback: string): string {
  const base = (fileName.trim() || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  const safe = base || fallback
  return safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`
}

function downloadMarkdown(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = fileName
  link.rel = "noopener"
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}

export function KnowledgePanel() {
  const serverClientMode = getRendererTransport().kind === "http"
  const browserImportInputRef = useRef<HTMLInputElement | null>(null)
  const [list, setList] = useState<Kb[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState("")
  const [markdown, setMarkdown] = useState("")
  const [fileName, setFileName] = useState("")
  const [dirty, setDirty] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scope, setScope] = useState<AccountScopeValue>("all")
  const [contextFilter, setContextFilter] = useState<"all" | KnowledgeContext>("all")

  const filteredList = list.filter((kb) => {
    if (contextFilter === "all") return true
    return kb.knowledge_context === contextFilter
  })

  const loadList = useCallback(async () => {
    try {
      const rows = await invokeRenderer(
        IPCChannels.Email.ListKnowledgeBases,
        listPayloadForScope(scope),
      ) as Kb[]
      setList(rows)
    } catch (e) {
      console.error(e)
      toast.error("Wissensbasen konnten nicht geladen werden.")
    }
  }, [scope])

  const loadDocument = useCallback(async (kbId: number) => {
    setLoadingDoc(true)
    try {
      const r = (await invokeRenderer(
        IPCChannels.Email.GetKnowledgeBaseDocument,
        kbId,
      )) as
        | { success: true; content: string; fileName: string }
        | { success: false; error?: string }
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
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (!isWorkflowKnowledgeRefreshEvent(event)) return
        void loadList()
        if (selectedId == null) return
        if (
          event.entityType === "workflow_knowledge_base"
          && event.type === "workflow_knowledge_base.deleted"
          && event.entityId === String(selectedId)
        ) {
          setSelectedId(null)
          return
        }
        if (!dirty && isWorkflowKnowledgeRefreshEvent(event, selectedId)) {
          void loadDocument(selectedId)
        }
      },
    })
    return () => subscription.unsubscribe()
  }, [dirty, loadDocument, loadList, selectedId])

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
      const r = (await invokeRenderer(
        IPCChannels.Email.CreateKnowledgeBase,
        {
          name: newName.trim(),
          ...mutationScopeFields(scope),
        },
      )) as { success: boolean; id?: number; error?: string }
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
      const r = (await invokeRenderer(
        IPCChannels.Email.SaveKnowledgeBaseDocument,
        { knowledgeBaseId: selectedId, content: markdown },
      )) as { success: boolean; error?: string }
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
    if (!hasLocalIpc()) {
      const current = list.find((kb) => kb.id === selectedId)
      downloadMarkdown(
        markdown,
        safeMarkdownFileName(fileName, current?.name ?? `knowledge-base-${selectedId}`),
      )
      toast.success("Markdown heruntergeladen.")
      return
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
    if (!hasLocalIpc()) {
      browserImportInputRef.current?.click()
      return
    }
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

  const handleBrowserImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ""
    if (!file || selectedId == null) return
    try {
      const content = await file.text()
      const r = await invokeRenderer(
        IPCChannels.Email.SaveKnowledgeBaseDocument,
        { knowledgeBaseId: selectedId, content },
      ) as { success: boolean; error?: string }
      if (!r.success) {
        toast.error(r.error ?? "Import fehlgeschlagen.")
        return
      }
      toast.success("Markdown-Datei importiert und ueberschrieben.")
      await loadDocument(selectedId)
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Import fehlgeschlagen.")
    }
  }

  const deleteKb = async (id: number, name: string) => {
    const ok = window.confirm(`Wissensbasis „${name}" inkl. Markdown-Datei wirklich löschen?`)
    if (!ok) return
    try {
      await invokeRenderer(IPCChannels.Email.DeleteKnowledgeBase, id)
      if (selectedId === id) setSelectedId(null)
      toast.success("Wissensbasis gelöscht.")
      await loadList()
    } catch (e) {
      console.error(e)
      toast.error("Löschen fehlgeschlagen.")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <div>
        <h3 className="text-base font-semibold">KI-Wissensbasis</h3>
        <p className="text-sm text-muted-foreground">
          {serverClientMode ? (
            <>
              Jeder Bereich ist ein serverseitiges Markdown-Dokument. Bearbeiten im Editor,
              herunterladen, extern ändern und wieder hochladen (überschreibt den Inhalt). Für
              Workflow-Agenten wird der Text indexiert (Stichwort + Embedding).
            </>
          ) : (
            <>
              Jeder Bereich ist eine <strong>Markdown-Datei</strong> (lokal unter{" "}
              <code className="text-xs">workflow-knowledge/</code>). Bearbeiten im Editor, exportieren,
              extern ändern und wieder importieren (überschreibt den Inhalt). Für Workflow-Agenten wird
              der Text indexiert (Stichwort + Embedding).
            </>
          )}
        </p>
      </div>

      <AccountScopeToolbar
        value={scope}
        onChange={(next) => {
          setScope(next)
          setSelectedId(null)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground">Kontext-Filter</Label>
        <Select
          value={contextFilter}
          onValueChange={(v) => setContextFilter(v as "all" | KnowledgeContext)}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kontexte</SelectItem>
            {KNOWLEDGE_CONTEXTS.map((ctx) => (
              <SelectItem key={ctx} value={ctx}>
                {KNOWLEDGE_CONTEXT_LABELS[ctx]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <ul className="max-h-48 shrink-0 divide-y overflow-y-auto rounded-lg border lg:max-h-56">
        {filteredList.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">
            {list.length === 0 ? "Noch keine Wissensbasis." : "Keine Treffer für diesen Kontext."}
          </li>
        ) : (
          filteredList.map((kb) => (
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
                <span className="flex flex-wrap items-center gap-2">
                  {kb.name}
                  <ScopeBadge row={kb} />
                  {kb.knowledge_context && kb.knowledge_context in KNOWLEDGE_CONTEXT_LABELS ? (
                    <Badge variant="outline" className="text-[10px]">
                      {KNOWLEDGE_CONTEXT_LABELS[kb.knowledge_context as KnowledgeContext]}
                    </Badge>
                  ) : null}
                </span>
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
        <div className="flex min-h-0 flex-1 flex-col space-y-3 rounded-lg border p-4">
          {(() => {
            const selectedKb = list.find((k) => k.id === selectedId)
            if (!selectedKb) return null
            return (
              <AccountOverrideActions
                row={selectedKb}
                scope={scope}
                onCreateOverride={async (_row, accountId) => {
                  const id = await createKnowledgeBaseAccountOverride(selectedKb, accountId)
                  toast.success("Konto-Override angelegt.")
                  await loadList()
                  if (id) setSelectedId(id)
                }}
                onResetOverride={async (row) => {
                  await resetKnowledgeBaseAccountOverride(row.id)
                  toast.success("Auf globalen Eintrag zurückgesetzt.")
                  await loadList()
                  setSelectedId(null)
                }}
              />
            )
          })()}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {list.find((k) => k.id === selectedId)?.name ?? "Wissensbasis"}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{fileName}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={browserImportInputRef}
                type="file"
                accept=".md,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => void handleBrowserImportFile(event)}
              />
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
            <div className="flex min-h-[280px] flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Lädt Markdown…
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Inhalt (Markdown)</Label>
              <div className="min-h-[280px] flex-1">
                <KnowledgeMarkdownEditor
                  value={markdown}
                  onChange={(v) => {
                    setMarkdown(v)
                    setDirty(true)
                  }}
                  height="100%"
                />
              </div>
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
