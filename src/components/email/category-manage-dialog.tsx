"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeIpc, type CategoryRow } from "./types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: CategoryRow[]
  onChanged: () => void | Promise<void>
}

export function CategoryManageDialog({ open, onOpenChange, categories, onChanged }: Props) {
  const [newName, setNewName] = useState("")
  const [newParentId, setNewParentId] = useState<string>("none")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [busy, setBusy] = useState(false)

  const roots = categories.filter((c) => c.parent_id == null)

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const parentId = newParentId === "none" ? null : parseInt(newParentId, 10)
      const r = await invokeIpc<{ success: boolean; error?: string; id?: number }>(
        IPCChannels.Email.CreateCategory,
        { name, parentId: Number.isFinite(parentId) ? parentId : null },
      )
      if (!r.success) {
        toast.error(r.error ?? "Kategorie konnte nicht angelegt werden")
        return
      }
      setNewName("")
      setNewParentId("none")
      await onChanged()
      toast.success("Kategorie angelegt")
    } finally {
      setBusy(false)
    }
  }

  const handleSaveEdit = async () => {
    if (editingId == null) return
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    try {
      const r = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.UpdateCategory,
        { categoryId: editingId, name },
      )
      if (!r.success) {
        toast.error(r.error ?? "Speichern fehlgeschlagen")
        return
      }
      setEditingId(null)
      await onChanged()
      toast.success("Kategorie gespeichert")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: number) => {
    setBusy(true)
    try {
      const r = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.DeleteCategory,
        id,
      )
      if (!r.success) {
        toast.error(r.error ?? "Löschen fehlgeschlagen")
        return
      }
      if (editingId === id) setEditingId(null)
      await onChanged()
      toast.success("Kategorie gelöscht")
    } finally {
      setBusy(false)
    }
  }

  const categoryLabel = (c: CategoryRow) => {
    if (c.parent_id == null) return c.name
    const parent = categories.find((p) => p.id === c.parent_id)
    return parent ? `${parent.name} / ${c.name}` : c.name
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kategorien verwalten</DialogTitle>
          <DialogDescription>
            Kategorien filtern den Posteingang in der Seitenleiste. Pro Nachricht kann eine
            Kategorie zugewiesen werden (Details-Panel).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-xs">Neue Kategorie</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name…"
              className="h-9"
            />
            <Select value={newParentId} onValueChange={setNewParentId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Übergeordnet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Hauptkategorie —</SelectItem>
                {roots.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    Unter „{c.name}"
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="w-full gap-2"
              disabled={busy || !newName.trim()}
              onClick={() => void handleCreate()}
            >
              <Plus className="h-4 w-4" />
              Anlegen
            </Button>
          </div>

          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {categories.length === 0 ? (
              <li className="px-2 py-2 text-muted-foreground">Noch keine Kategorien.</li>
            ) : (
              categories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                >
                  {editingId === c.id ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 flex-1 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveEdit()
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{categoryLabel(c)}</span>
                  )}
                  <div className="flex shrink-0 gap-0.5">
                    {editingId === c.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => void handleSaveEdit()}
                      >
                        OK
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Bearbeiten"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(c.id)
                          setEditName(c.name)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      aria-label="Löschen"
                      disabled={busy}
                      onClick={() => void handleDelete(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
