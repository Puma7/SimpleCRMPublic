"use client"

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { WorkflowNodeCatalogEntry, WorkflowNodeCategory } from "@shared/workflow-types"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CATEGORY_ORDER: WorkflowNodeCategory[] = ["email", "ai", "logic", "crm", "integration", "code"]

const CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  trigger: "Auslöser",
  email: "E-Mail",
  ai: "KI",
  logic: "Logik & Steuerung",
  crm: "CRM",
  integration: "Integrationen",
  code: "Code & Plugins",
}

/** Central reference for everything the workflow editor offers — node catalog
 *  (grouped + searchable) and best-practice notes for designing reliable
 *  workflows. Surfaces every catalog entry's description, so a contributor only
 *  needs to write good descriptions to keep this page useful. */
export function WorkflowReferenceDialog({ open, onOpenChange }: Props) {
  const { catalog } = useWorkflowNodeCatalog()
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? catalog.filter(
          (entry) =>
            entry.type.toLowerCase().includes(q) ||
            entry.label.toLowerCase().includes(q) ||
            (entry.description ?? "").toLowerCase().includes(q),
        )
      : catalog
    const byCategory = new Map<WorkflowNodeCategory, WorkflowNodeCatalogEntry[]>()
    for (const entry of filtered) {
      const list = byCategory.get(entry.category) ?? []
      list.push(entry)
      byCategory.set(entry.category, list)
    }
    return byCategory
  }, [catalog, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Workflow-Referenz</DialogTitle>
          <DialogDescription>
            Komplette Übersicht aller Knoten, Auslöser-Typen und Best Practices für robuste Workflows.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="nodes" className="space-y-3">
          <TabsList>
            <TabsTrigger value="nodes">Knoten</TabsTrigger>
            <TabsTrigger value="triggers">Auslöser</TabsTrigger>
            <TabsTrigger value="variables">Variablen</TabsTrigger>
            <TabsTrigger value="best-practices">Best Practices</TabsTrigger>
          </TabsList>

          <TabsContent value="nodes" className="space-y-2">
            <Input
              autoFocus
              placeholder="Suche (Name, Typ oder Beschreibung)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9"
            />
            <ScrollArea className="h-[480px] rounded-md border">
              <div className="space-y-4 p-3">
                {CATEGORY_ORDER.map((category) => {
                  const entries = grouped.get(category)
                  if (!entries || entries.length === 0) return null
                  return (
                    <section key={category} className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABELS[category]}
                      </h3>
                      <ul className="space-y-2">
                        {entries.map((entry) => (
                          <li key={entry.type} className="rounded-md border p-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium">{entry.label}</span>
                              <code className="font-mono text-[10px] text-muted-foreground">{entry.type}</code>
                            </div>
                            {entry.description ? (
                              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                {entry.description}
                              </p>
                            ) : null}
                            {entry.defaultConfig && Object.keys(entry.defaultConfig).length > 0 ? (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                                  Default-Konfig
                                </summary>
                                <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[10px]">
                                  {JSON.stringify(entry.defaultConfig, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
                {grouped.size === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Keine Treffer.</p>
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="triggers" className="space-y-3">
            <ScrollArea className="h-[480px] rounded-md border p-3">
              <TriggerReference />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="variables" className="space-y-3">
            <ScrollArea className="h-[480px] rounded-md border p-3">
              <VariablesReference />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="best-practices" className="space-y-3">
            <ScrollArea className="h-[480px] rounded-md border p-3">
              <BestPracticesReference />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function TriggerReference() {
  return (
    <div className="space-y-3 text-sm">
      <Section title="inbound — Eingehende Mail">
        Läuft, sobald eine neue Mail per Sync eintrifft. Variablen: <code>email.from</code>,{" "}
        <code>email.subject</code>, <code>email.body</code>, <code>email.has_attachments</code>,{" "}
        <code>attachment_names</code> u.a.
      </Section>
      <Section title="outbound — Ausgehende Mail (vor Versand)">
        Läuft, sobald der Nutzer „Senden" klickt — vor dem SMTP-Versand. Der Entwurf wird auf{" "}
        <code>outbound_hold=true</code> gestellt und erst gesendet, wenn ein Knoten ihn freigibt
        (<code>email.release_outbound</code> mit <code>autoSend=true</code>).
      </Section>
      <Section title="schedule — Zeitplan (Cron)">
        Läuft per Cron-Expression. Kontext-Variablen: <code>schedule.cron</code>. Praxis: für
        Sync-Anstöße oder regelmäßige Berichte.
      </Section>
      <Section title="manual — Manueller Lauf">
        Wird über den Workflow-Editor per Button gestartet. Praxis: Debugging, einmalige Migration.
      </Section>
      <Section title="crm.deal_stage_changed — Deal-Stage geändert">
        Läuft, sobald eine Deal-Stage im CRM wechselt. Kontext: <code>deal.id</code>,{" "}
        <code>deal.stage</code>, <code>deal.previous_stage</code>.
      </Section>
    </div>
  )
}

function VariablesReference() {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Variablen sind in Folgeknoten als <code>{`{{name}}`}</code> verwendbar (z.B. im SQL-Knoten
        oder als Tag/Kategorie-Pfad). Knoten setzen sie über <code>variables</code> im Lauf-Schritt.
      </p>
      <Section title="Allgemein (jeder Lauf)">
        <code>workspace.id</code>, <code>workflow.id</code>, <code>run.id</code>,{" "}
        <code>trigger</code>, <code>direction</code> (inbound/outbound)
      </Section>
      <Section title="E-Mail-Kontext">
        <code>email.id</code>, <code>email.from</code>, <code>email.to</code>,{" "}
        <code>email.subject</code>, <code>email.body</code>, <code>email.snippet</code>,{" "}
        <code>email.has_attachments</code>, <code>email.outbound_hold</code>,{" "}
        <code>attachment_names</code>
      </Section>
      <Section title="KI-Knoten">
        <code>ai.class</code>, <code>ai.class_confidence</code>, <code>ai.spam_score</code>,{" "}
        <code>ai.text</code> (Transform-Ergebnis), <code>ai.review_block</code>
      </Section>
      <Section title="Forward / Integration">
        <code>forward_copy.ok</code>, <code>forward_copy.to</code>,{" "}
        <code>forward_copy.duplicate</code>, <code>http.status</code>, <code>jtl.*</code>
      </Section>
      <Section title="Schwellwert / Switch">
        Knoten <code>logic.threshold</code> liest eine Variable und routet ja/nein.{" "}
        <code>logic.switch</code> routet nach Wert auf benannte Ports.
      </Section>
    </div>
  )
}

function BestPracticesReference() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <Section title="1. Einen Auslöser pro Workflow">
        Jeder Workflow hat genau einen Trigger-Knoten (inbound/outbound/schedule/manual/crm.*).
        Mehrere Verhaltensweisen für die gleiche Mail-Richtung in mehrere Workflows aufteilen — der
        Server sortiert nach Priorität.
      </Section>
      <Section title="2. Bedingungen vor Aktionen">
        Erst filtern (<code>condition</code> oder <code>logic.threshold</code>), dann handeln.
        Spart KI-Kosten und macht Logs lesbar.
      </Section>
      <Section title="3. KI-Knoten sparsam einsetzen">
        Pro Mail höchstens ein <code>ai.classify</code> + max. eine Folge-KI (z.B.{" "}
        <code>ai.reply_suggestion</code>). Spam vorher per <code>email.sender_filter</code>{" "}
        rauswerfen.
      </Section>
      <Section title="4. Ausgangsprüfung sauber freigeben">
        Outbound-Workflows mit <code>ai.outbound_review</code> brauchen einen{" "}
        <code>email.release_outbound</code>-Knoten am OK-Ausgang. Mit <code>autoSend=true</code>{" "}
        verschickt der Scheduled-Send-Worker den Entwurf sofort.
      </Section>
      <Section title="5. Weiterleitungen mit Loop-Schutz">
        Forward setzt automatisch den <code>Auto-Submitted: auto-forwarded</code>-Header und führt
        eine Dedup-Tabelle (Message × Workflow × Empfänger-Menge). Mehrere Empfänger:
        Komma-getrennt im selben Knoten — nicht pro Empfänger einen Knoten.
      </Section>
      <Section title="6. Outbound-Workflows + Forward">
        Default: Forward umgeht die Ausgangsprüfung (eigener Loop-Schutz reicht). Mit{" "}
        <code>runOutboundReview=true</code> wandert der Forward als Entwurf durch dieselbe
        Prüfung wie eine Hand-getippte Mail.
      </Section>
      <Section title="7. Verzögerungen nutzen">
        <code>logic.delay</code> pausiert sauber bis zur nächsten Worker-Tick — auch über
        App-Neustarts hinweg. Sinnvoll für „nach 1h Folgeaktion".
      </Section>
      <Section title="8. Subflows für Wiederverwendbarkeit">
        <code>workflow.subflow</code> ruft einen anderen Workflow auf. Wiederkehrende Logik (z.B.
        „Kunde verknüpfen + Aktivität loggen") als eigenen Workflow halten.
      </Section>
      <Section title="9. Tests im Editor">
        Lauf-Historie zeigt jeden Knoten-Schritt mit Status, Port und Message. Bei Fehlern: Status
        „error" + die Message-Spalte sind der Einstieg.
      </Section>
      <Section title="10. Schema sicher halten">
        Code-Knoten (<code>code.javascript</code>, <code>code.python</code>) und{" "}
        <code>plugin.custom</code> laufen NICHT im Servermodus — nur in Single-User-Desktop. Wer
        Server-Modus nutzt, baut ohne diese Knoten.
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      <div className="text-[12px] text-muted-foreground">{children}</div>
    </div>
  )
}
