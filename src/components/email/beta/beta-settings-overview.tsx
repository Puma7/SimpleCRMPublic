"use client"

import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import {
  AtSign,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import {
  BETA_SETTINGS_SECTIONS,
  type BetaSettingsSection,
} from "./beta-settings-sections"

type AiProfileSummary = { id: number; label: string; isDefault: boolean; hasApiKey?: boolean }

export function BetaSettingsOverview({
  onOpenSection,
}: {
  onOpenSection: (section: BetaSettingsSection) => void
}) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [aiProfiles, setAiProfiles] = useState<AiProfileSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [accs, ai] = await Promise.all([
        invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts),
        invokeIpc<{ profiles?: AiProfileSummary[] }>(IPCChannels.Email.GetAiSettings),
      ])
      setAccounts(accs)
      setAiProfiles(ai.profiles ?? [])
    } catch {
      setAccounts([])
      setAiProfiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const defaultProfile = aiProfiles.find((p) => p.isDefault) ?? aiProfiles[0]
  const hasAiKey = aiProfiles.some((p) => p.hasApiKey)
  const imapCount = accounts.filter((a) => (a.protocol ?? "imap") === "imap").length
  const pop3Count = accounts.length - imapCount

  const cards = [
    {
      title: "Postfächer",
      value: loading ? "…" : String(accounts.length),
      detail:
        accounts.length === 0
          ? "Noch kein Konto — zuerst Postfach anlegen."
          : `${imapCount} IMAP · ${pop3Count} POP3`,
      ok: accounts.length > 0,
      section: "mailboxes" as const,
      icon: AtSign,
    },
    {
      title: "KI-Profil",
      value: loading ? "…" : defaultProfile?.label ?? "—",
      detail: hasAiKey
        ? "API-Key hinterlegt (mindestens ein Profil)."
        : "Kein API-Key — unter KI & Wissen eintragen.",
      ok: hasAiKey,
      section: "intelligence" as const,
      icon: BrainCircuit,
    },
    {
      title: "Automatisierung",
      value: "Workflows",
      detail: "Regeln im Workflow-Editor; API unter Automatisierung.",
      ok: true,
      section: "automation" as const,
      icon: Workflow,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">E-Mail-Setup</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Beta-Oberfläche: Einstellungen nach Aufgaben gruppiert (Postfach → Versand → KI →
          Automatisierung). Alle Funktionen sind dieselben wie in der klassischen Ansicht.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => onOpenSection(c.section)}
              className="rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className="h-5 w-5 text-primary" />
                {c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <CircleAlert className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</p>
              <p className="text-sm font-medium">{c.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
            </button>
          )
        })}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bereiche
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {BETA_SETTINGS_SECTIONS.filter((s) => s.id !== "overview").map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSection(s.id)}
                className="flex items-start gap-3 rounded-lg border bg-card/80 p-3 text-left transition-colors hover:bg-muted/40"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-dashed bg-muted/20 p-4">
        <p className="w-full text-xs text-muted-foreground">
          Workflows und Postfach nutzen weiterhin die bewährte Oberfläche — nur die
          Einstellungen sind in der Beta neu strukturiert.
        </p>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/email/workflows">Workflows öffnen</Link>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenSection("delivery")}>
          Versand prüfen
        </Button>
      </div>
    </div>
  )
}
