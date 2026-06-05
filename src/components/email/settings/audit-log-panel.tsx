"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { invokeRenderer } from "@/services/transport"

type AuditRow = {
  id: number
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  at: string
  row_hash: string
}

export function AuditLogPanel() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [chainOk, setChainOk] = useState<boolean | null>(null)

  const reload = useCallback(async () => {
    const list = await invokeRenderer(IPCChannels.Auth.ListAuditLog, { limit: 100 })
    if (Array.isArray(list)) setRows(list as AuditRow[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Audit-Log</h2>
        <p className="text-sm text-muted-foreground">
          Append-only Protokoll mit Hash-Kette (Admin). Manipulation am Dateisystem bleibt möglich.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
          Aktualisieren
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(IPCChannels.Auth.VerifyAuditChain, undefined)
            if (r && typeof r === "object" && "valid" in r) {
              const v = (r as { valid: boolean }).valid
              setChainOk(v)
              toast[v ? "success" : "error"](
                v ? "Hash-Kette intakt" : "Hash-Kette beschädigt",
              )
            }
          }}
        >
          Integrität prüfen
        </Button>
        {chainOk != null ? (
          <span className={chainOk ? "text-sm text-green-600" : "text-sm text-destructive"}>
            {chainOk ? "Kette OK" : "Kette FEHLER"}
          </span>
        ) : null}
      </div>
      <div className="max-h-96 overflow-auto rounded border text-xs">
        <table className="w-full">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="p-2 text-left">Zeit</th>
              <th className="p-2 text-left">Aktion</th>
              <th className="p-2 text-left">User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{r.at}</td>
                <td className="p-2">{r.action}</td>
                <td className="p-2">{r.user_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
