"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
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
import { BASE_CONTEXT_VARIABLES } from "@shared/workflow-variables"
import { WORKFLOW_TRIGGER_LABELS } from "./trigger-labels"
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

/** Central reference for everything the workflow editor offers: a layperson
 *  primer (Grundlagen), the catalog-driven node reference (incl. docs, ports
 *  and outputs from the node schemas), all trigger kinds, the variable list
 *  (generated from BASE_CONTEXT_VARIABLES + catalog outputs), a step-by-step
 *  walkthrough for automatic AI replies, and best-practice notes. */
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
            (entry.description ?? "").toLowerCase().includes(q) ||
            (entry.docs?.longHelp ?? "").toLowerCase().includes(q),
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
            Grundlagen für den Einstieg, alle Knoten und Auslöser, verfügbare Variablen und die
            Anleitung für automatische KI-Antworten.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="basics" className="space-y-3">
          <TabsList>
            <TabsTrigger value="basics">Grundlagen</TabsTrigger>
            <TabsTrigger value="nodes">Knoten</TabsTrigger>
            <TabsTrigger value="triggers">Auslöser</TabsTrigger>
            <TabsTrigger value="variables">Variablen</TabsTrigger>
            <TabsTrigger value="auto-reply">KI-Antwort</TabsTrigger>
            <TabsTrigger value="best-practices">Best Practices</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="space-y-3">
            <ScrollArea className="h-[480px] rounded-md border p-3">
              <BasicsReference />
            </ScrollArea>
          </TabsContent>

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
                          <NodeEntry key={entry.type} entry={entry} />
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
              <VariablesReference catalog={catalog} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="auto-reply" className="space-y-3">
            <ScrollArea className="h-[480px] rounded-md border p-3">
              <AutoReplyReference />
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

/** One node card: description + schema docs (longHelp, prerequisites, ports,
 *  outputs) so laypeople see prerequisites and outputs without opening the
 *  properties panel. */
function NodeEntry({ entry }: { entry: WorkflowNodeCatalogEntry }) {
  const docs = entry.docs
  return (
    <li className="rounded-md border p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {entry.label}
          {entry.runtime === "server" ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
              Nur Server-Edition
            </Badge>
          ) : null}
        </span>
        <code className="font-mono text-[10px] text-muted-foreground">{entry.type}</code>
      </div>
      {entry.description ? (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {entry.description}
        </p>
      ) : null}
      {docs?.longHelp ? (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{docs.longHelp}</p>
      ) : null}
      {docs?.prerequisites && docs.prerequisites.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[11px] font-semibold">Voraussetzungen</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {docs.prerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {entry.ports && entry.ports.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[11px] font-semibold">Ausgänge</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
            {entry.ports.map((port) => (
              <li key={port.id}>
                <span className="font-medium text-foreground">{port.label}</span>{" "}
                <code className="font-mono text-[10px]">({port.id})</code>
                {port.description ? <> — {port.description}</> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entry.outputs && entry.outputs.length > 0 ? (
        <div className="mt-1.5">
          <p className="text-[11px] font-semibold">Setzt Variablen</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
            {entry.outputs.map((out) => (
              <li key={out.name}>
                <code className="font-mono text-[10px] text-foreground">{`{{${out.name}}}`}</code>{" "}
                — {out.label}
                {out.dynamicFromField ? " (Name im Knoten frei wählbar)" : ""}
              </li>
            ))}
          </ul>
        </div>
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
  )
}

/** Layperson primer: workflow model, ports/edges, variables, safe testing. */
function BasicsReference() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <Section title="Was ist ein Workflow?">
        Ein Workflow ist eine automatische Abfolge aus drei Bausteinen: Ein{" "}
        <strong>Auslöser</strong> startet ihn (z.&nbsp;B. „eine neue E-Mail ist da“),{" "}
        <strong>Prüfungen</strong> entscheiden, ob es weitergeht (z.&nbsp;B. „steht ‚Rechnung‘ im
        Betreff?“), und <strong>Aktionen</strong> erledigen die Arbeit (Tag setzen, weiterleiten,
        antworten). Auf der Zeichenfläche ist jeder Baustein ein Kästchen (Knoten); die Pfeile
        dazwischen (Kanten) legen die Reihenfolge fest.
      </Section>
      <Section title="Was sind Ausgänge (Ports)?">
        Viele Knoten haben mehrere Ausgänge — z.&nbsp;B. „Erlaubt“/„Blockiert“ oder „ja“/„nein“.
        Knoten mit mehreren Ausgängen zeigen sie direkt am Kästchen auf der Zeichenfläche. Welcher
        Weg weiterläuft, bestimmt die <strong>Beschriftung der Kante</strong>: Eine Kante mit der
        Beschriftung „ja“ läuft nur, wenn der Knoten am Ausgang „ja“ endet. Achtung: Eine Kante{" "}
        <strong>ohne Beschriftung</strong> fängt jeden Ausgang — dann laufen Aktionen auch in
        Fällen, die man eigentlich ausschließen wollte. Deshalb bei Knoten mit mehreren Ausgängen
        jede Kante beschriften.
      </Section>
      <Section title="Was sind Variablen?">
        Variablen sind Platzhalter wie <code>{`{{subject}}`}</code>, die beim Lauf durch den
        echten Wert ersetzt werden (hier: den Betreff der Mail). Sie funktionieren in fast jedem
        Textfeld eines Knotens. Niemand muss die Namen auswendig kennen: Der Knopf{" "}
        <strong>„Variablen“</strong> neben den Eingabefeldern zeigt alles, was an dieser Stelle
        verfügbar ist, und fügt es per Klick ein. Die Gesamtliste steht im Tab „Variablen“.
      </Section>
      <Section title="Testen ohne Risiko">
        <strong>„Dry-Run testen“</strong> führt den Workflow mit einer echten Mail aus, ohne etwas
        zu verändern oder zu versenden — man sieht nur, welchen Weg der Lauf durch die Knoten
        nimmt. <strong>„Jetzt ausführen“</strong> führt dagegen wirklich aus. Nach jedem Lauf
        zeigt die <strong>Lauf-Historie</strong> Schritt für Schritt jeden Knoten mit Status,
        gewähltem Ausgang (Port) und Meldung — der beste Einstieg, wenn etwas nicht wie erwartet
        läuft.
      </Section>
    </div>
  )
}

/** 1-2 German sentences per trigger kind; keys must cover trigger-labels.ts. */
const TRIGGER_DESCRIPTIONS: Record<string, React.ReactNode> = {
  inbound: (
    <>
      Startet für jede neue Mail direkt nach dem Postfach-Abgleich (Sync). Der Standard-Auslöser
      zum Sortieren, Taggen, für Spam-Prüfung und automatische Antworten.
    </>
  ),
  outbound: (
    <>
      Startet, wenn jemand auf „Senden“ klickt — vor dem eigentlichen Versand. Die Mail wird
      angehalten und geht erst raus, wenn ein Knoten sie freigibt (
      <code>email.release_outbound</code>); blockiert der Workflow oder schlägt er fehl, bleibt
      die Mail sicherheitshalber als Entwurf zurück (fail-closed).
    </>
  ),
  draft_created: (
    <>
      Startet, sobald ein neuer Entwurf angelegt wird (z.&nbsp;B. beim Verfassen einer Mail).
      Nützlich, um Entwürfe automatisch vorzubereiten oder zu prüfen.
    </>
  ),
  schedule: (
    <>
      Startet regelmäßig nach Zeitplan (Cron-Ausdruck) — ganz ohne Mail, z.&nbsp;B. für tägliche
      Berichte oder Aufräum-Läufe. Frühestens alle 15 Minuten.
    </>
  ),
  manual: (
    <>
      Startet nur per Klick auf den Button „Jetzt ausführen“ im Editor. Ideal zum Ausprobieren
      neuer Workflows und für einmalige Aktionen.
    </>
  ),
  "crm.deal_stage_changed": (
    <>
      Startet, wenn eine Verkaufschance (Deal) im CRM in eine andere Phase wechselt. Stellt
      u.&nbsp;a. <code>deal.stage</code>, <code>deal.old_stage</code> und <code>customer.id</code>{" "}
      als Variablen bereit.
    </>
  ),
  "task.due": (
    <>
      Startet, wenn eine offene CRM-Aufgabe fällig wird (Fälligkeitsdatum erreicht); jede Aufgabe
      löst höchstens einmal aus. Variablen: <code>task.id</code>, <code>task.title</code>.
    </>
  ),
  "calendar.event_start": (
    <>
      Startet kurz vor Beginn eines Kalender-Termins (im 15-Minuten-Fenster vor der Startzeit) —
      z.&nbsp;B. für Erinnerungen. Variablen: <code>calendar.title</code>, ggf.{" "}
      <code>customer.id</code>.
    </>
  ),
  "webhook.incoming": (
    <>
      Startet, wenn ein externes System die Automation-API aufruft (HTTP-Aufruf mit
      Webhook-Secret). Der mitgeschickte Inhalt steht als Variable <code>webhook_body</code>{" "}
      (JSON-Text) zur Verfügung.
    </>
  ),
  "crm.customer_created": (
    <>
      Startet, wenn im CRM ein neuer Kunde angelegt wird — z.&nbsp;B. für eine
      Willkommens-Aufgabe. Variablen: <code>customer.id</code>, <code>customer.name</code>,{" "}
      <code>customer.email</code>.
    </>
  ),
  relay: (
    <>
      Nur Server-Edition: Startet, nachdem das SMTP-Relay eine Mail erfolgreich versendet hat —
      die Mail ist also schon raus. Ideal für Nachfass-Workflows, die später den Versandstatus
      lesen (<code>email.read_tracking_evidence</code>) und z.&nbsp;B. ohne Reaktion eine
      Aufgabe anlegen.
    </>
  ),
}

function TriggerReference() {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-[12px] text-muted-foreground">
        Jeder Workflow hat genau einen Auslöser. Er bestimmt, wann ein Lauf startet und welche
        Daten (Variablen) dabei mitkommen.
      </p>
      {Object.entries(WORKFLOW_TRIGGER_LABELS).map(([kind, label]) => (
        <Section
          key={kind}
          title={
            <>
              {label}{" "}
              <code className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                {kind}
              </code>
            </>
          }
        >
          {TRIGGER_DESCRIPTIONS[kind] ?? null}
        </Section>
      ))}
    </div>
  )
}

/** Variable list generated from BASE_CONTEXT_VARIABLES + catalog outputs —
 *  stays current without hand maintenance. */
function VariablesReference({ catalog }: { catalog: WorkflowNodeCatalogEntry[] }) {
  const nodesWithOutputs = useMemo(
    () => catalog.filter((entry) => (entry.outputs?.length ?? 0) > 0),
    [catalog],
  )
  return (
    <div className="space-y-4 text-sm">
      <p className="text-[12px] text-muted-foreground">
        Variablen sind Platzhalter wie <code>{`{{subject}}`}</code> — beim Lauf werden sie durch
        den echten Wert ersetzt. In den Eingabefeldern fügt der Knopf „Variablen“ sie per Klick
        ein; dort erscheinen nur die Variablen, die an der jeweiligen Stelle wirklich verfügbar
        sind.
      </p>
      <section className="space-y-1.5">
        <h4 className="text-[13px] font-semibold">Immer verfügbar (Basis-Kontext)</h4>
        <ul className="space-y-1">
          {BASE_CONTEXT_VARIABLES.map((v) => (
            <li key={v.name} className="text-[12px] text-muted-foreground">
              <code className="font-mono text-[11px] text-foreground">{`{{${v.name}}}`}</code> —{" "}
              {v.label}
              {v.example ? <span> (z.&nbsp;B. „{v.example}“)</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h4 className="text-[13px] font-semibold">Von Knoten gesetzt</h4>
        <p className="text-[12px] text-muted-foreground">
          Diese Variablen gibt es erst, nachdem der jeweilige Knoten im Workflow gelaufen ist —
          sie stehen allen Knoten dahinter zur Verfügung.
        </p>
        {nodesWithOutputs.map((entry) => (
          <div key={entry.type} className="rounded-md border p-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium">{entry.label}</span>
              <code className="font-mono text-[10px] text-muted-foreground">{entry.type}</code>
            </div>
            <ul className="mt-1 space-y-0.5">
              {(entry.outputs ?? []).map((out) => (
                <li key={out.name} className="text-[12px] text-muted-foreground">
                  <code className="font-mono text-[11px] text-foreground">{`{{${out.name}}}`}</code>{" "}
                  — {out.label}
                  {out.example ? <span> (z.&nbsp;B. „{out.example}“)</span> : null}
                  {out.dynamicFromField ? <span> — Name im Knoten frei wählbar</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {nodesWithOutputs.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Knoten-Katalog noch nicht geladen — Dialog kurz schließen und erneut öffnen.
          </p>
        ) : null}
      </section>
    </div>
  )
}

/** Step-by-step walkthrough for the two auto-reply templates. */
function AutoReplyReference() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <p className="text-[12px] text-muted-foreground">
        Unter „Vorlagen“ gibt es zwei fertige Workflows, mit denen die KI eingehende Mails
        automatisch beantwortet. Empfohlen ist{" "}
        <strong>„Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)“</strong>: Eine zweite KI
        liest jede entworfene Antwort gegen, und im Zweifel wartet der Entwurf auf einen Menschen
        — es geht nichts Ungeprüftes raus. Die schlankere Variante „Eingehend: KI antwortet mit
        Textbaustein (mit Gate)“ verschickt vorbereitete Textbausteine ohne Gegenprüfung.
      </p>
      <Section title="Schritt 1: Voraussetzungen einrichten">
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <strong>Auto-Antwort-Schalter einschalten:</strong> Einstellungen → Automatisierung →
            „Automatische KI-Antworten erlauben“. Solange er aus ist (Standard), erstellen
            Workflows höchstens Entwürfe — es wird nie automatisch versendet. Dort steht auch das
            Tageslimit „Max. automatische Antworten pro Absender und Tag“ (Standard: 1).
          </li>
          <li>
            <strong>KI-Profil mit API-Schlüssel</strong> (Einstellungen → E-Mail → KI): ohne
            Schlüssel können die KI-Knoten nicht arbeiten.
          </li>
          <li>
            <strong>Je nach Vorlage:</strong> Für die Textbaustein-Variante mindestens einen
            Textbaustein anlegen (Einstellungen → E-Mail → Textbausteine); für die Variante mit
            Gegenprüfung ist eine Wissensbasis empfohlen, damit die KI konkret und korrekt
            antworten kann.
          </li>
        </ul>
      </Section>
      <Section title="Schritt 2: Vorlage laden">
        Im Workflow-Editor einen Workflow auswählen, auf „Vorlagen“ klicken und „Eingehend:
        KI-Antwort mit Gegenprüfung (empfohlen)“ laden. Die Vorlagen-Liste zeigt pro Vorlage eine
        Checkliste, ob die Voraussetzungen aus Schritt 1 schon erfüllt sind. Vor dem Aktivieren
        lohnt ein Blick auf die Knoten — z.&nbsp;B. die Kategorien der KI-Klassifizierung an das
        eigene Postfach anpassen.
      </Section>
      <Section title="Schritt 3: So entscheidet das Gate">
        Vor jeder automatischen Antwort prüft der Knoten „Auto-Antwort (Gate)“ vier Dinge — in
        dieser Reihenfolge:
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>Ist der Auto-Antwort-Schalter in den Einstellungen an?</li>
          <li>
            Ist der Absender kein Automat? No-Reply-Adressen und automatisch erzeugte Mails
            (Newsletter, Abwesenheitsnotizen) werden nie beantwortet.
          </li>
          <li>
            Ist das Tageslimit für diesen Absender noch nicht erreicht? Das verhindert
            Antwort-Schleifen zwischen zwei automatischen Systemen.
          </li>
          <li>
            Ist die KI sich sicher genug? Die Sicherheit aus der KI-Klassifizierung (0–100) muss
            die eingestellte Mindest-Sicherheit erreichen (in den Vorlagen: 80).
          </li>
        </ol>
        Nur wenn alles zutrifft, geht es am Ausgang „Erlaubt“ weiter. Sonst nimmt der Lauf den
        Ausgang „Blockiert“ — die Vorlagen setzen dort den Tag <code>ki-manuell</code>, damit die
        Mail sichtbar bleibt und von Hand beantwortet wird.
      </Section>
      <Section title="Schritt 4: Entwurf und Gegenprüfung">
        Am Ausgang „Erlaubt“ entwirft die erste KI eine Antwort (Anrede und Signatur werden
        automatisch ergänzt, die Wissensbasis wird einbezogen). Danach liest die zweite KI den
        Entwurf gegen und entscheidet: Ausgang „senden“ — die Antwort geht sofort raus; Ausgang
        „halten“ — der Entwurf bekommt den Tag <code>ki-freigabe</code>, es entsteht eine Aufgabe
        „KI-Entwurf prüfen“ und die Antwort wartet auf einen Menschen.
      </Section>
      <Section title="„Wartet auf Freigabe“ — was tun?">
        Zurückgehaltene Antworten erkennt man am blauen Hinweis <strong>„Wartet auf
        Freigabe“</strong> in der Mail-Ansicht (im Posteingang die betreffende Mail öffnen). Dort
        gibt es zwei Knöpfe: <strong>„Jetzt senden“</strong> verschickt den KI-Entwurf sofort;{" "}
        <strong>„Als Entwurf behalten“</strong> hält ihn zurück, um ihn erst zu bearbeiten oder zu
        verwerfen.
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

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      <div className="text-[12px] text-muted-foreground">{children}</div>
    </div>
  )
}
