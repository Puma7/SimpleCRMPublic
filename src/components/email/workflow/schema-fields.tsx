"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type {
  WorkflowNodeFieldSchema,
} from "@shared/workflow-node-schema"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import type { WorkflowVariableInfo } from "@shared/workflow-variables"
import { validateNodeConfig } from "@shared/workflow-config-validate"
import { AppMonacoEditor } from "@/components/shared/app-monaco-editor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"
import { AiProfileSelect, profileIdFromConfig } from "../ai-profile-select"
import { WorkflowCategorySelect } from "./workflow-category-select"
import { VariablePicker } from "./variable-picker"
import type { AiPrompt } from "../types"

type PatchFn = (p: Record<string, unknown>) => void

type Props = {
  entry: WorkflowNodeCatalogEntry
  config: Record<string, unknown>
  patch: PatchFn
  /** Verfügbare Variablen an dieser Graph-Position (Kontext + Upstream). */
  variables: WorkflowVariableInfo[]
}

function setConfig(patch: PatchFn, config: Record<string, unknown>, key: string, value: unknown) {
  patch({ config: { ...config, [key]: value } })
}

function fieldVisible(field: WorkflowNodeFieldSchema, config: Record<string, unknown>): boolean {
  if (!field.showIf) return true
  return config[field.showIf.field] === field.showIf.equals
}

function FieldShell({
  field,
  issue,
  children,
  inline = false,
}: {
  field: WorkflowNodeFieldSchema
  issue: string | null
  children: React.ReactNode
  inline?: boolean
}) {
  return (
    <div className="space-y-1.5">
      {inline ? (
        <div className="flex items-start gap-2">{children}</div>
      ) : (
        <>
          <Label className="text-xs">{field.label}</Label>
          {children}
        </>
      )}
      {field.help ? <p className="text-[11px] text-muted-foreground">{field.help}</p> : null}
      {field.example && !field.help?.includes(field.example) ? (
        <p className="text-[11px] text-muted-foreground/80">
          z. B. <code className="text-[10px]">{field.example}</code>
        </p>
      ) : null}
      {issue ? <p className="text-[11px] text-destructive">{issue}</p> : null}
    </div>
  )
}

/** Textfeld mit optionaler {{Variablen}}-Einfüge-Hilfe an der Cursorposition. */
function TextWithVariables({
  field,
  value,
  onChange,
  variables,
  multiline,
}: {
  field: WorkflowNodeFieldSchema
  value: string
  onChange: (v: string) => void
  variables: WorkflowVariableInfo[]
  multiline: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const insertAtCursor = (text: string) => {
    const el = multiline ? textareaRef.current : inputRef.current
    if (!el) {
      onChange(value + text)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + text + value.slice(end))
  }

  const withPicker = field.interpolate === true && variables.length > 0

  const control = multiline ? (
    <Textarea
      ref={textareaRef}
      className="min-h-[80px] text-sm"
      placeholder={field.placeholder ?? ""}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <Input
      ref={inputRef}
      className="h-9 text-sm"
      placeholder={field.placeholder ?? ""}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )

  if (!withPicker) return control
  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <VariablePicker variables={variables} mode="template" onPick={insertAtCursor} />
      </div>
      {control}
    </div>
  )
}

/** Select, dessen Optionen per IPC geladen werden (Profile, Prompts, Konten, …). */
function AsyncOptionsSelect({
  load,
  value,
  onChange,
  emptyLabel,
  noneOption,
}: {
  load: () => Promise<{ value: string; label: string }[]>
  value: string
  onChange: (v: string) => void
  emptyLabel: string
  noneOption?: { value: string; label: string }
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null)
  useEffect(() => {
    let active = true
    void load()
      .then((opts) => {
        if (active) setOptions(opts)
      })
      .catch(() => {
        if (active) setOptions([])
      })
    return () => {
      active = false
    }
    // Optionen einmal pro Mount laden; `load` ist pro Feldtyp konstant.
  }, [])

  const items = options ?? []
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={options === null ? "Lade…" : emptyLabel} />
      </SelectTrigger>
      <SelectContent>
        {noneOption ? <SelectItem value={noneOption.value}>{noneOption.label}</SelectItem> : null}
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
        {options !== null && items.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : null}
      </SelectContent>
    </Select>
  )
}

function SchemaField({
  entry,
  field,
  config,
  patch,
  variables,
  issue,
}: {
  entry: WorkflowNodeCatalogEntry
  field: WorkflowNodeFieldSchema
  config: Record<string, unknown>
  patch: PatchFn
  variables: WorkflowVariableInfo[]
  issue: string | null
}) {
  const value = config[field.key]

  switch (field.type) {
    case "boolean":
      return (
        <FieldShell field={field} issue={issue} inline>
          <Switch
            checked={value === true || (value === undefined && entry.defaultConfig?.[field.key] === true)}
            onCheckedChange={(v) => setConfig(patch, config, field.key, v)}
          />
          <div className="space-y-0.5">
            <Label className="text-xs font-normal">{field.label}</Label>
          </div>
        </FieldShell>
      )

    case "number":
    case "duration":
      return (
        <FieldShell field={field} issue={issue}>
          <Input
            type="number"
            className="h-9"
            min={field.validation?.min}
            max={field.validation?.max}
            placeholder={field.placeholder ?? ""}
            value={value == null || value === "" ? "" : String(value)}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === "") {
                setConfig(patch, config, field.key, null)
                return
              }
              const parsed = Number(raw)
              setConfig(patch, config, field.key, Number.isFinite(parsed) ? parsed : raw)
            }}
          />
        </FieldShell>
      )

    case "select":
      return (
        <FieldShell field={field} issue={issue}>
          <Select
            value={String(value ?? entry.defaultConfig?.[field.key] ?? "")}
            onValueChange={(v) => setConfig(patch, config, field.key, v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      )

    case "aiProfile":
      return (
        <div className="space-y-1.5">
          <AiProfileSelect
            value={profileIdFromConfig(config)}
            onChange={(profileId) => setConfig(patch, config, field.key, profileId)}
            label={field.label}
            hint={field.help ?? ""}
          />
          {issue ? <p className="text-[11px] text-destructive">{issue}</p> : null}
        </div>
      )

    case "promptId":
      return (
        <FieldShell field={field} issue={issue}>
          <AsyncOptionsSelect
            load={async () => {
              const rows = (await invokeRenderer(IPCChannels.Email.ListAiPrompts)) as AiPrompt[]
              return rows.map((p) => ({ value: String(p.id), label: p.label }))
            }}
            value={String(Number(value ?? 0) || 0)}
            onChange={(v) => setConfig(patch, config, field.key, parseInt(v, 10) || 0)}
            emptyLabel="Keine Prompts angelegt (Einstellungen → E-Mail → KI)"
            noneOption={{ value: "0", label: "Standard (erster Prompt / eingebaut)" }}
          />
        </FieldShell>
      )

    case "knowledgeBase":
      return (
        <FieldShell field={field} issue={issue}>
          <AsyncOptionsSelect
            load={async () => {
              const rows = (await invokeRenderer(IPCChannels.Email.ListKnowledgeBases)) as {
                id: number
                title?: string | null
                name?: string | null
              }[]
              return rows.map((k) => ({
                value: String(k.id),
                label: k.title ?? k.name ?? `Wissensbasis #${k.id}`,
              }))
            }}
            value={value == null || Number(value) <= 0 ? "0" : String(value)}
            onChange={(v) => {
              const id = parseInt(v, 10)
              setConfig(patch, config, field.key, id > 0 ? id : null)
            }}
            emptyLabel="Keine Wissensbasis angelegt (Einstellungen → E-Mail → KI)"
            noneOption={{ value: "0", label: "Automatisch (passend zur Richtung)" }}
          />
        </FieldShell>
      )

    case "teamMember":
      return (
        <FieldShell field={field} issue={issue}>
          <AsyncOptionsSelect
            load={async () => {
              const rows = (await invokeRenderer(IPCChannels.Email.ListTeamMembers)) as {
                id: string
                name?: string | null
                email?: string | null
              }[]
              return rows.map((m) => ({
                value: m.id,
                label: m.name ? `${m.name}${m.email ? ` (${m.email})` : ""}` : m.id,
              }))
            }}
            value={String(value ?? "")}
            onChange={(v) => setConfig(patch, config, field.key, v)}
            emptyLabel="Keine Team-Mitglieder angelegt"
          />
        </FieldShell>
      )

    case "account":
      return (
        <FieldShell field={field} issue={issue}>
          <AsyncOptionsSelect
            load={async () => {
              const rows = (await invokeRenderer(IPCChannels.Email.ListAccounts)) as {
                id: number
                label?: string | null
                email?: string | null
              }[]
              return rows.map((a) => ({
                value: String(a.id),
                label: a.label ?? a.email ?? `Konto #${a.id}`,
              }))
            }}
            value={String(Number(value ?? 0) || 0)}
            onChange={(v) => setConfig(patch, config, field.key, parseInt(v, 10) || 0)}
            emptyLabel="Keine E-Mail-Konten eingerichtet"
            noneOption={{ value: "0", label: "Alle Konten / Konto der Nachricht" }}
          />
        </FieldShell>
      )

    case "workflowRef":
      return (
        <FieldShell field={field} issue={issue}>
          <AsyncOptionsSelect
            load={async () => {
              const rows = (await invokeRenderer(IPCChannels.Email.ListWorkflows)) as {
                id: number
                name?: string | null
              }[]
              return rows.map((w) => ({ value: String(w.id), label: w.name ?? `Workflow #${w.id}` }))
            }}
            value={String(Number(value ?? 0) || 0)}
            onChange={(v) => setConfig(patch, config, field.key, parseInt(v, 10) || 0)}
            emptyLabel="Keine Workflows vorhanden"
            noneOption={{ value: "0", label: "— bitte wählen —" }}
          />
        </FieldShell>
      )

    case "variableRef":
      return (
        <FieldShell field={field} issue={issue}>
          <div className="flex items-center gap-2">
            <Input
              className="h-9 font-mono text-sm"
              placeholder={field.placeholder ?? ""}
              value={String(value ?? "")}
              onChange={(e) => setConfig(patch, config, field.key, e.target.value)}
            />
            <VariablePicker
              variables={variables}
              mode="value"
              onPick={(name) => setConfig(patch, config, field.key, name)}
              triggerTitle="Aus verfügbaren Variablen wählen"
            />
          </div>
        </FieldShell>
      )

    case "variableName":
      return (
        <FieldShell field={field} issue={issue}>
          <Input
            className="h-9 font-mono text-sm"
            placeholder={field.placeholder ?? ""}
            value={String(value ?? "")}
            onChange={(e) => setConfig(patch, config, field.key, e.target.value)}
          />
        </FieldShell>
      )

    case "categoryPath":
      return (
        <FieldShell field={field} issue={issue}>
          <WorkflowCategorySelect
            path={String(value ?? "")}
            categorySourceSqliteId={
              typeof config.categorySourceSqliteId === "number"
                ? config.categorySourceSqliteId
                : undefined
            }
            onChange={(next) =>
              patch({
                config: {
                  ...config,
                  [field.key]: next.path,
                  categorySourceSqliteId: next.categorySourceSqliteId ?? null,
                },
              })
            }
          />
        </FieldShell>
      )

    case "cron":
      return (
        <FieldShell field={field} issue={issue}>
          <Input
            className="h-9 font-mono text-sm"
            placeholder={field.placeholder ?? "*/15 * * * *"}
            value={String(value ?? "")}
            onChange={(e) => setConfig(patch, config, field.key, e.target.value)}
          />
        </FieldShell>
      )

    case "code":
      return (
        <FieldShell field={field} issue={issue}>
          <AppMonacoEditor
            language={field.language ?? "javascript"}
            value={String(value ?? "")}
            onChange={(text) => setConfig(patch, config, field.key, text ?? "")}
            height="260px"
          />
        </FieldShell>
      )

    case "textarea":
      return (
        <FieldShell field={field} issue={issue}>
          <TextWithVariables
            field={field}
            value={String(value ?? "")}
            onChange={(v) => setConfig(patch, config, field.key, v)}
            variables={variables}
            multiline
          />
        </FieldShell>
      )

    case "text":
    default:
      return (
        <FieldShell field={field} issue={issue}>
          <TextWithVariables
            field={field}
            value={String(value ?? "")}
            onChange={(v) => setConfig(patch, config, field.key, v)}
            variables={variables}
            multiline={false}
          />
        </FieldShell>
      )
  }
}

/**
 * Generischer Formular-Renderer: baut das Eigenschaften-Formular eines
 * Registry-Knotens aus dessen deklarativem Schema (entry.fields) —
 * inkl. Inline-Validierung, Variablen-Picker und „Erweitert“-Bereich.
 */
export function SchemaFields({ entry, config, patch, variables }: Props) {
  const fields = entry.fields ?? []
  const issues = useMemo(() => validateNodeConfig(entry, config), [entry, config])
  const issueByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const issue of issues) {
      if (!map.has(issue.fieldKey)) map.set(issue.fieldKey, issue.message)
    }
    return map
  }, [issues])

  const visible = fields.filter((f) => fieldVisible(f, config))
  const basic = visible.filter((f) => !f.advanced)
  const advanced = visible.filter((f) => f.advanced)

  if (fields.length === 0) return null

  return (
    <div className="space-y-3 rounded-md border p-3">
      {basic.map((field) => (
        <SchemaField
          key={field.key}
          entry={entry}
          field={field}
          config={config}
          patch={patch}
          variables={variables}
          issue={issueByKey.get(field.key) ?? null}
        />
      ))}
      {advanced.length > 0 ? (
        <details className="space-y-3 border-t pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Erweitert
          </summary>
          <div className="mt-2 space-y-3">
            {advanced.map((field) => (
              <SchemaField
                key={field.key}
                entry={entry}
                field={field}
                config={config}
                patch={patch}
                variables={variables}
                issue={issueByKey.get(field.key) ?? null}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
