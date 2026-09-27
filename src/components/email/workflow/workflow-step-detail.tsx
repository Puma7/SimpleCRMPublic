"use client"

import type { ReactNode } from "react"
import {
  parseWorkflowStepDetail,
  workflowStepPortLabel,
  type WorkflowStepDetail,
  type WorkflowStepDetailValue,
  type WorkflowStepMailSnapshot,
} from "../../../../packages/core/src/workflow/run-step-detail"

/**
 * Eingang und Ausgang eines Lauf-Schritts (ähnlich n8n): links, womit der
 * Knoten gearbeitet hat, rechts, was dabei herauskam. Gemeinsam genutzt von
 * Lauf-Historie (Workflow-Editor) und Lauf-Detail-Dialog.
 */

const FIELD_LABELS: Record<string, string> = {
  question: "Frage",
  yesCriteria: "Ja-Kriterien",
  noCriteria: "Nein-Kriterien",
  threshold: "Schwelle (%)",
  contextMode: "Mail-Kontext",
  model: "Modell",
  profileId: "KI-Profil",
  answer: "Antwort",
  probability: "Ja-Wahrscheinlichkeit (%)",
  confidence: "Sicherheit (%)",
  reason: "Begründung",
  summary: "Zusammenfassung",
  blockReason: "Sperrgrund",
  items: "Elemente",
  tag: "Tag",
}

const CONTEXT_MODE_LABELS: Record<string, string> = {
  full: "Ganze Mail (Betreff, Absender, Text)",
  metadata: "Nur Kopfdaten",
}

export function readWorkflowStepDetail(value: unknown): WorkflowStepDetail | null {
  return parseWorkflowStepDetail(value)
}

/** Erster Mail-Schnappschuss eines Laufs (steht im ersten Schritt). */
export function firstStepMail(details: readonly (WorkflowStepDetail | null)[]): WorkflowStepMailSnapshot | null {
  for (const detail of details) {
    if (detail?.input?.mail) return detail.input.mail
  }
  return null
}

function formatValue(key: string, value: WorkflowStepDetailValue): string {
  if (value === null) return "—"
  if (typeof value === "boolean") return value ? "ja" : "nein"
  if (typeof value === "number" || typeof value === "string") {
    if (key === "contextMode" && typeof value === "string") return CONTEXT_MODE_LABELS[value] ?? value
    return String(value)
  }
  return JSON.stringify(value, null, 2)
}

function KeyValueList({
  values,
  plainKeys = false,
}: {
  values: Record<string, WorkflowStepDetailValue> | undefined
  /** Schlüssel sind schon deutsche Beschriftungen (z. B. „Von“). */
  plainKeys?: boolean
}) {
  const entries = Object.entries(values ?? {})
  if (entries.length === 0) return null
  return (
    <dl className="space-y-1">
      {entries.map(([key, value]) => {
        const label = plainKeys ? key : FIELD_LABELS[key]
        const text = formatValue(key, value)
        const block = typeof value === "object" && value !== null
        return (
          <div key={key} className="grid grid-cols-[minmax(6rem,38%)_1fr] gap-2">
            <dt className="truncate text-muted-foreground" title={key}>
              {label ?? <span className="font-mono text-[10px]">{key}</span>}
            </dt>
            <dd className={block ? "min-w-0" : "min-w-0 whitespace-pre-wrap break-words"}>
              {block ? (
                <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-1 font-mono text-[10px]">{text}</pre>
              ) : (
                text
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

export function WorkflowStepMailCard({ mail, defaultOpen = false }: { mail: WorkflowStepMailSnapshot; defaultOpen?: boolean }) {
  return (
    <details className="rounded border bg-muted/20 px-2 py-1.5 text-xs" open={defaultOpen}>
      <summary className="cursor-pointer select-none">
        <span className="font-medium">E-Mail:</span> {mail.subject || "(ohne Betreff)"}
        {mail.from ? <span className="text-muted-foreground"> · {mail.from}</span> : null}
      </summary>
      <div className="mt-1 space-y-1">
        <KeyValueList
          plainKeys
          values={{
            ...(mail.direction ? { Richtung: mail.direction === "outbound" ? "ausgehend" : "eingehend" } : {}),
            ...(mail.from ? { Von: mail.from } : {}),
            ...(mail.to ? { An: mail.to } : {}),
            ...(mail.cc ? { CC: mail.cc } : {}),
            ...(mail.date ? { Datum: mail.date } : {}),
            ...(mail.attachments ? { Anhänge: mail.attachments } : {}),
          }}
        />
        {mail.excerpt ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-1.5 font-sans text-[11px]">
            {mail.excerpt}
            {mail.truncated ? "\n… (gekürzt)" : ""}
          </pre>
        ) : null}
      </div>
    </details>
  )
}

/** Eingang | Ausgang eines Schritts. `nodeType` steuert Ausgangs-Labels (z. B. „KI-Fehler“). */
export function WorkflowStepDetailView({
  detail,
  nodeType,
  showMail = true,
}: {
  detail: WorkflowStepDetail | null
  nodeType: string
  showMail?: boolean
}) {
  if (!detail) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Keine Details gespeichert (älterer Lauf oder älter als 30 Tage).
      </p>
    )
  }
  const input = detail.input
  const output = detail.output
  const hasInput = Boolean(
    (showMail && input?.mail) || input?.config || input?.variables || input?.extra,
  )
  return (
    <div className="space-y-2 text-[11px]">
      {detail.continuedFrom ? (
        <p className="rounded bg-sky-500/10 px-2 py-1 text-sky-800 dark:text-sky-300">
          Fortsetzung von Lauf #{detail.continuedFrom.runId}
          {detail.continuedFrom.port
            ? ` (Ausgang „${workflowStepPortLabel(detail.continuedFrom.port, "ai.decide")}“)`
            : ""}
        </p>
      ) : null}
      {output?.note ? (
        <p className="rounded bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">{output.note}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded border p-2">
          <div className="text-xs font-semibold">Eingang</div>
          {!hasInput ? <p className="text-muted-foreground">—</p> : null}
          {showMail && input?.mail ? <WorkflowStepMailCard mail={input.mail} /> : null}
          {input?.extra ? (
            <Section title="Verwendet (Platzhalter eingesetzt)">
              <KeyValueList values={input.extra} />
            </Section>
          ) : null}
          {input?.config ? (
            <Section title="Einstellungen des Knotens">
              <KeyValueList values={input.config} />
            </Section>
          ) : null}
          {input?.variables ? (
            <Section title="Variablen vor dem Schritt">
              <KeyValueList values={input.variables} />
            </Section>
          ) : null}
        </div>
        <div className="space-y-2 rounded border p-2">
          <div className="text-xs font-semibold">Ausgang</div>
          {output?.port !== undefined ? (
            <Section title="Gewählter Ausgang">
              <p>{output.port ? workflowStepPortLabel(output.port, nodeType) : "—"}</p>
            </Section>
          ) : null}
          {output?.result ? (
            <Section title="Ergebnis">
              <KeyValueList values={output.result} />
            </Section>
          ) : null}
          {output?.variables ? (
            <Section title="Gesetzte Variablen">
              <KeyValueList values={output.variables} />
            </Section>
          ) : null}
          {!output ? <p className="text-muted-foreground">—</p> : null}
        </div>
      </div>
      {detail.truncated ? (
        <p className="text-[10px] text-muted-foreground">Details wegen ihrer Größe gekürzt.</p>
      ) : null}
    </div>
  )
}
