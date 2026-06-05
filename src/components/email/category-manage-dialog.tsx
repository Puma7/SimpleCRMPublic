"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Plus } from "lucide-react"
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
import type { CategoryRow } from "./types"
import { invokeRenderer } from "@/services/transport"
import { CategorySortableList } from "./category-sortable-list"
import { flattenCategoryTree } from "./category-tree-utils"

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

  const flat = flattenCategoryTree(categories)
  const parentOptions = flat.filter((c) => c.depth < 2)

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const parentId = newParentId === "none" ? null : parseInt(newParentId, 10)
      const r = await invokeRenderer(
        IPCChannels.Email.CreateCategory,
        { name, parentId: Number.isFinite(parentId) ? parentId : null },
      ) as { success: boolean; error?: string; id?: number }
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
      const r = await invokeRenderer(
        IPCChannels.Email.UpdateCategory,
        { categoryId: editingId, name },
      ) as { success: boolean; error?: string }
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
      const r = await invokeRenderer(
        IPCChannels.Email.DeleteCategory,
        id,
      ) as { success: boolean; error?: string }
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

  const handleReorder = async (
    updates: { id: number; parentId: number | null; sortOrder: number }[],
  ) => {
    setBusy(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.ReorderCategories,
        { updates },
      ) as { success: boolean; error?: string }
      if (!r.success) {
        toast.error(r.error ?? "Sortieren fehlgeschlagen")
        return
      }
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kategorien verwalten</DialogTitle>
          <DialogDescription>
            Reihenfolge und Hierarchie per Drag-and-drop anpassen (bis zu 3 Ebenen). E-Mails können
            per Drag-and-drop auf eine Kategorie in der Seitenleiste gezogen werden.
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
                {parentOptions.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {"\u00a0".repeat(c.depth * 2)}
                    {c.depth > 0 ? "↳ " : ""}
                    {c.name}
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

          <div className="space-y-2">
            <Label className="text-xs">Reihenfolge &amp; Hierarchie</Label>
            {editingId != null ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 flex-1 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveEdit()
                    if (e.key === "Escape") setEditingId(null)
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  disabled={busy}
                  onClick={() => void handleSaveEdit()}
                >
                  Speichern
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setEditingId(null)}
                >
                  Abbrechen
                </Button>
              </div>
            ) : null}
            <CategorySortableList
              categories={categories}
              disabled={busy}
              editingId={editingId}
              onReorder={handleReorder}
              onEdit={(id, name) => {
                setEditingId(id)
                setEditName(name)
              }}
              onDelete={(id) => void handleDelete(id)}
            />
          </div>
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
