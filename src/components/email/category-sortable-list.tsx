"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { CategoryRow } from "./types"
import {
  flattenCategoryTree,
  flatToReorderUpdates,
  indentFlatCategory,
  outdentFlatCategory,
  type FlatCategory,
} from "./category-tree-utils"

type Props = {
  categories: CategoryRow[]
  disabled?: boolean
  editingId?: number | null
  onReorder: (
    updates: { id: number; parentId: number | null; sortOrder: number }[],
  ) => void | Promise<void>
  onEdit?: (id: number, name: string) => void
  onDelete?: (id: number) => void
}

function SortableCategoryRow({
  item,
  disabled,
  editingId,
  onIndent,
  onOutdent,
  onEdit,
  onDelete,
}: {
  item: FlatCategory
  disabled?: boolean
  editingId?: number | null
  onIndent: () => void
  onOutdent: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/50",
        isDragging && "z-10 bg-muted shadow-sm",
      )}
    >
      <button
        type="button"
        className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span
        className="min-w-0 flex-1 truncate text-sm"
        style={{ paddingLeft: item.depth * 14 }}
        title={item.name}
      >
        {item.name}
      </span>
      <div className="flex shrink-0 gap-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || item.depth <= 0}
          aria-label="Eine Ebene höher"
          onClick={onOutdent}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={disabled || item.depth >= 2}
          aria-label="Als Unterkategorie einrücken"
          onClick={onIndent}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {onEdit ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={disabled || editingId != null}
            aria-label="Bearbeiten"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            disabled={disabled}
            aria-label="Löschen"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function CategorySortableList({
  categories,
  disabled,
  editingId,
  onReorder,
  onEdit,
  onDelete,
}: Props) {
  const flattened = useMemo(() => flattenCategoryTree(categories), [categories])
  const [flat, setFlat] = useState<FlatCategory[]>(flattened)

  useEffect(() => {
    setFlat(flattened)
  }, [flattened])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const persist = async (next: FlatCategory[]) => {
    setFlat(next)
    await onReorder(flatToReorderUpdates(next))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = flat.findIndex((c) => c.id === active.id)
    const newIndex = flat.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const overItem = flat[newIndex]!
    const moved = flat[oldIndex]!
    const nestUnder = event.activatorEvent instanceof MouseEvent && event.activatorEvent.shiftKey
    const targetDepth = nestUnder
      ? Math.min(overItem.depth + 1, 2)
      : overItem.depth
    const reordered = arrayMove(flat, oldIndex, newIndex).map((c) =>
      c.id === moved.id ? { ...c, depth: targetDepth } : c,
    )
    void persist(reordered)
  }

  if (flat.length === 0) {
    return <p className="px-2 py-2 text-sm text-muted-foreground">Noch keine Kategorien.</p>
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={flat.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-2">
          {flat.map((item) => (
            <SortableCategoryRow
              key={item.id}
              item={item}
              disabled={disabled}
              editingId={editingId}
              onIndent={() => void persist(indentFlatCategory(flat, item.id))}
              onOutdent={() => void persist(outdentFlatCategory(flat, item.id))}
              onEdit={onEdit ? () => onEdit(item.id, item.name) : undefined}
              onDelete={onDelete ? () => onDelete(item.id) : undefined}
            />
          ))}
        </ul>
      </SortableContext>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Ziehen zum Sortieren. Shift+Ziehen auf eine Zeile = als Unterkategorie. Pfeile = Einrücken /
        Ausrücken (max. 3 Ebenen).
      </p>
    </DndContext>
  )
}
