"use client"

import { type Dispatch, type SetStateAction } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  open: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  jsonValue: string
  onJsonChange?: (value: string) => void
  readOnly?: boolean
}

export function JsonDevDrawer({
  open,
  onOpenChange,
  jsonValue,
  onJsonChange,
  readOnly = false,
}: Props) {
  const editable = !readOnly && typeof onJsonChange === "function"
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[70vh]">
        <DrawerHeader>
          <DrawerTitle>Kompilierte Workflow-Definition (JSON)</DrawerTitle>
          <DrawerDescription>
            Entwickler-Ansicht. Wird beim Speichern automatisch aus dem Graph neu generiert. Manuelle
            Änderungen werden beim nächsten Speichern überschrieben.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6">
          <Textarea
            value={jsonValue}
            onChange={(e) => {
              if (editable) onJsonChange(e.target.value)
            }}
            readOnly={!editable}
            className="min-h-[260px] font-mono text-xs"
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
