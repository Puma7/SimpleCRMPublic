"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hasElectron, invokeIpc } from "../types"

export function AutomationPanel() {
  const [imapDeleteOptIn, setImapDeleteOptIn] = useState(false)
  const [httpAllowlist, setHttpAllowlist] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const s = await invokeIpc<{ imapDeleteOptIn: boolean; httpAllowlist: string }>(
        IPCChannels.Email.GetWorkflowAutomationSettings,
      )
      setImapDeleteOptIn(s.imapDeleteOptIn)
      setHttpAllowlist(s.httpAllowlist)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!hasElectron()) return
    await invokeIpc(IPCChannels.Email.SetWorkflowAutomationSettings, {
      imapDeleteOptIn,
      httpAllowlist,
    })
    toast.success("Workflow-Automatisierung gespeichert.")
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Workflow-Automatisierung</h3>
        <p className="text-sm text-muted-foreground">
          Sicherheitsrelevante Optionen für IMAP-Löschung und HTTP-Integrationen in Workflows.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="imap-delete-opt-in">IMAP-Löschung auf dem Server</Label>
          <p className="text-xs text-muted-foreground">
            Erlaubt den Workflow-Knoten „Auf Server löschen“. Ohne Opt-in schlägt die Aktion fehl.
          </p>
        </div>
        <Switch
          id="imap-delete-opt-in"
          checked={imapDeleteOptIn}
          disabled={loading}
          onCheckedChange={setImapDeleteOptIn}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="http-allowlist">HTTP-Allowlist (Hosts)</Label>
        <p className="text-xs text-muted-foreground">
          Kommagetrennte Hostnamen (z. B. api.example.com, hooks.zapier.com). Leer = alle HTTP-Knoten
          blockiert.
        </p>
        <Input
          id="http-allowlist"
          value={httpAllowlist}
          disabled={loading}
          onChange={(e) => setHttpAllowlist(e.target.value)}
          placeholder="api.example.com, hooks.zapier.com"
        />
      </div>

      <Button type="button" onClick={() => void save()} disabled={loading}>
        Speichern
      </Button>
    </div>
  )
}
