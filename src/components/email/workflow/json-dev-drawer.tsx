"use client"

import { type Dispatch, type SetStateAction, useMemo, useState } from "react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  open: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  /** Kompilierte Regel-Definition (beim Speichern aus dem Graph erzeugt). */
  jsonValue: string
  onJsonChange: (value: string) => void
  /** Roh-Graph aus dem Editor (nur Lesen). */
  graphJson?: string
}

export function JsonDevDrawer({
  open,
  onOpenChange,
  jsonValue,
  onJsonChange,
  graphJson = "",
}: Props) {
  const [tab, setTab] = useState<"graph" | "compiled">("graph")
  const formattedGraph = useMemo(() => {
    if (!graphJson.trim()) return "{\n  \"nodes\": [],\n  \"edges\": []\n}"
    try {
      return JSON.stringify(JSON.parse(graphJson), null, 2)
    } catch {
      return graphJson
    }
  }, [graphJson])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[75vh]">
        <DrawerHeader>
          <DrawerTitle>Workflow-Quelltext (nur Lesen)</DrawerTitle>
          <DrawerDescription>
            Graph-Ansicht zeigt den Roh-Graph aus dem Editor. Die kompilierte Definition wird beim Speichern
            automatisch neu erzeugt — manuelle Änderungen dort werden beim nächsten Speichern überschrieben.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "graph" | "compiled")}>
            <TabsList className="mb-3">
              <TabsTrigger value="graph">Graph (JSON)</TabsTrigger>
              <TabsTrigger value="compiled">Kompiliert</TabsTrigger>
            </TabsList>
            <TabsContent value="graph">
              <Textarea
                readOnly
                value={formattedGraph}
                className="min-h-[280px] font-mono text-xs"
              />
            </TabsContent>
            <TabsContent value="compiled">
              <Textarea
                value={jsonValue}
                onChange={(e) => onJsonChange(e.target.value)}
                className="min-h-[280px] font-mono text-xs"
              />
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
