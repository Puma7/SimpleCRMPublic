"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { ClipboardCopy, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { invokeRenderer } from "@/services/transport"

type ServerLogEntry = {
  time: string
  level: "warn" | "error" | "fatal"
  message: string
  source: string
}

/** Central server log (warnings + errors), persisted across restarts, with
 *  copy/export and clear — server edition only. */
export function ServerLogsSection() {
  const [entries, setEntries] = useState<ServerLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [level, setLevel] = useState<"warn" | "error">("warn")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const items = (await invokeRenderer(IPCChannels.Diagnostics.GetServerLogs, { level, limit: 1000 })) as ServerLogEntry[]
      setEntries(Array.isArray(items) ? items : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Server-Logs konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [level])

  useEffect(() => {
    void load()
  }, [load])

  const copyAll = async () => {
    const text = entries.map((e) => `${e.time} [${e.level}] (${e.source}) ${e.message}`).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${entries.length} Einträge kopiert.`)
    } catch {
      toast.error("Kopieren fehlgeschlagen.")
    }
  }

  const clearLogs = async () => {
    if (!window.confirm("Alle gesammelten Server-Logs löschen?")) return
    try {
      await invokeRenderer(IPCChannels.Diagnostics.ClearServerLogs, undefined)
      setEntries([])
      toast.success("Server-Logs geleert.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Leeren fehlgeschlagen.")
    }
  }

  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Server-Logs (Warnungen &amp; Fehler)</p>
          <p className="text-xs text-muted-foreground">
            Zentral gesammelt und über Neustarts/Neubauten hinweg gespeichert. {entries.length} Einträge.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as "warn" | "error")}
            aria-label="Log-Stufe"
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="warn">Warnungen + Fehler</option>
            <option value="error">Nur Fehler</option>
          </select>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="Aktualisieren">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyAll()} disabled={entries.length === 0}>
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> Kopieren
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void clearLogs()} aria-label="Server-Logs leeren">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Warnungen oder Fehler. 🎉</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
          {entries.map((entry, index) => (
            <div
              key={`${entry.time}-${index}`}
              className={entry.level === "warn" ? "text-amber-600 dark:text-amber-400" : "text-destructive"}
            >
              <span className="text-muted-foreground">{entry.time}</span> [{entry.level}] {entry.message}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
