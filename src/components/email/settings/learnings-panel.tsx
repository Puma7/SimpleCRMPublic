"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Loader2, Pencil, Play, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  learningCandidateKindLabel,
  type AiLearningCandidateDto,
  type AiLearningDecisionResultDto,
  type AiLearningDigestDetailDto,
  type AiLearningDigestDto,
  type AiLearningsOverviewDto,
  type AiLearningsRunDigestResultDto,
  type AiLearningsSettingsDto,
  type LearningCandidateKind,
  type LearningsDigestPeriod,
} from "@shared/ai-learnings"
import { useAuth } from "@/components/auth/auth-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { AiProfileSelect } from "../ai-profile-select"
import { KnowledgeMarkdownEditor } from "./knowledge-markdown-editor"
import { LearningsDiffView } from "./learnings-diff-view"

type KnowledgeBaseOption = { id: number; name?: string | null }

const DEFAULT_KB_VALUE = "__default__"
const ALL_KINDS = "__all__"
const POLL_INTERVAL_MS = 4000
const POLL_MAX_ATTEMPTS = 45

const PERIOD_LABELS: Record<LearningsDigestPeriod, string> = {
  since_last: "Seit der letzten Auswertung",
  day: "Letzter Tag",
  week: "Letzte Woche",
  month: "Letzter Monat",
}

const STATUS_LABELS: Record<AiLearningDigestDto["status"], string> = {
  pending: "Offen",
  accepted: "Übernommen",
  rejected: "Verworfen",
  failed: "Fehlgeschlagen",
}

const STATUS_CLASSES: Record<AiLearningDigestDto["status"], string> = {
  pending: "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100",
  accepted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  rejected: "border-slate-500/40 bg-slate-500/10 text-slate-800 dark:text-slate-200",
  failed: "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-100",
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("de-DE")
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function candidateText(candidate: AiLearningCandidateDto): { label: string; text: string }[] {
  const parts: { label: string; text: string }[] = []
  if (candidate.questionText) parts.push({ label: "Anfrage", text: candidate.questionText })
  if (candidate.aiText) parts.push({ label: "KI-Entwurf", text: candidate.aiText })
  if (candidate.humanText) {
    parts.push({ label: candidate.kind === "draft_edit" ? "Gesendet" : "Antwort", text: candidate.humanText })
  }
  if (candidate.noteText) parts.push({ label: "Notiz", text: candidate.noteText })
  return parts
}

/** Wer Learnings verwalten darf: Server workflows.manage, Desktop Owner/Admin. */
export function useCanManageLearnings(): boolean {
  const { user, hasCapability } = useAuth()
  const serverClientMode = getRendererTransport().kind === "http"
  if (serverClientMode) return Boolean(hasCapability?.("workflows.manage"))
  return user?.role === "owner" || user?.role === "admin"
}

export function LearningsPanel() {
  const canManage = useCanManageLearnings()
  if (!canManage) {
    return (
      <div className="space-y-4">
        <PanelHeader />
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Nur für Owner und Admins</AlertTitle>
          <AlertDescription>
            Gesammelte Learnings einsehen, auswerten und in die Wissensbasis übernehmen dürfen nur Owner und
            Admins (Server: Recht „Workflows verwalten“). „Learning notieren“ in der Leseansicht einer E-Mail
            steht allen offen, die die E-Mail lesen dürfen.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  return <LearningsManager />
}

function PanelHeader() {
  return (
    <div>
      <h3 className="text-base font-semibold">Learnings</h3>
      <p className="text-sm text-muted-foreground">
        Aus geänderten KI-Entwürfen, Antworten Ihres Teams und Notizen entstehen allgemeine Regeln für die
        Wissensbasis. Die KI schlägt eine neue Fassung vor; übernommen wird erst nach Ihrer Freigabe.
      </p>
    </div>
  )
}

function LearningsManager() {
  const serverClientMode = getRendererTransport().kind === "http"
  const [overview, setOverview] = useState<AiLearningsOverviewDto | null>(null)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseOption[]>([])
  const [candidates, setCandidates] = useState<AiLearningCandidateDto[]>([])
  const [kindFilter, setKindFilter] = useState<LearningCandidateKind | typeof ALL_KINDS>(ALL_KINDS)
  const [digests, setDigests] = useState<AiLearningDigestDto[]>([])
  const [pending, setPending] = useState<AiLearningDigestDetailDto | null>(null)
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<"diff" | "edit">("diff")
  const [period, setPeriod] = useState<LearningsDigestPeriod>("since_last")
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  const pendingIdRef = useRef<number | null>(null)

  const loadCandidates = useCallback(async (kind: LearningCandidateKind | typeof ALL_KINDS) => {
    const rows = await invokeRenderer(
      IPCChannels.Email.ListLearningCandidates,
      kind === ALL_KINDS ? {} : { kind },
    ) as AiLearningCandidateDto[]
    setCandidates(Array.isArray(rows) ? rows : [])
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const nextOverview = await invokeRenderer(IPCChannels.Email.GetLearningsOverview) as AiLearningsOverviewDto
      setOverview(nextOverview)
      setRunning(Boolean(nextOverview.running))
      const [digestRows, kbRows] = await Promise.all([
        invokeRenderer(IPCChannels.Email.ListLearningDigests, {}) as Promise<AiLearningDigestDto[]>,
        invokeRenderer(IPCChannels.Email.ListKnowledgeBases) as Promise<KnowledgeBaseOption[]>,
      ])
      setDigests(Array.isArray(digestRows) ? digestRows : [])
      setKnowledgeBases(Array.isArray(kbRows) ? kbRows : [])
      if (nextOverview.pendingDigestId) {
        const detail = await invokeRenderer(
          IPCChannels.Email.GetLearningDigest,
          { id: nextOverview.pendingDigestId },
        ) as AiLearningDigestDetailDto | null
        // Den bearbeiteten Entwurf nur bei einem NEUEN Vorschlag zurücksetzen.
        if (pendingIdRef.current !== (detail?.id ?? null)) {
          setDraft(detail?.proposedContent ?? "")
          setMode("diff")
        }
        pendingIdRef.current = detail?.id ?? null
        setPending(detail)
      } else {
        pendingIdRef.current = null
        setPending(null)
      }
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error, "Learnings konnten nicht geladen werden."))
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    void loadCandidates(kindFilter).catch(() => setCandidates([]))
  }, [kindFilter, loadCandidates])

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) window.clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    let attempts = 0
    pollRef.current = window.setInterval(() => {
      attempts += 1
      void (async () => {
        try {
          const next = await invokeRenderer(IPCChannels.Email.GetLearningsOverview) as AiLearningsOverviewDto
          if (!next.running || attempts >= POLL_MAX_ATTEMPTS) {
            stopPolling()
            await loadAll()
            await loadCandidates(kindFilter)
          }
        } catch {
          stopPolling()
        }
      })()
    }, POLL_INTERVAL_MS)
  }, [kindFilter, loadAll, loadCandidates, stopPolling])

  const saveSettings = async (patch: Partial<AiLearningsSettingsDto>) => {
    try {
      const result = await invokeRenderer(IPCChannels.Email.SaveLearningsSettings, patch) as
        | { success: true; settings: AiLearningsSettingsDto }
        | { success: false; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Einstellung konnte nicht gespeichert werden.")
        return
      }
      setOverview((current) => (current ? { ...current, settings: result.settings } : current))
      toast.success("Einstellung gespeichert.")
      await loadAll()
    } catch (error) {
      toast.error(errorMessage(error, "Einstellung konnte nicht gespeichert werden."))
    }
  }

  const deleteCandidate = async (id: number) => {
    try {
      await invokeRenderer(IPCChannels.Email.DeleteLearningCandidate, { id })
      setCandidates((rows) => rows.filter((row) => row.id !== id))
      await loadAll()
    } catch (error) {
      toast.error(errorMessage(error, "Eintrag konnte nicht gelöscht werden."))
    }
  }

  const runDigest = async () => {
    setRunning(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.RunLearningsDigest, { period }) as AiLearningsRunDigestResultDto
      switch (result.status) {
        case "queued":
          toast.info("Auswertung läuft im Hintergrund …")
          startPolling()
          return
        case "created":
          toast.success(`Vorschlag aus ${result.candidateCount} Einträgen erstellt.`)
          break
        case "skipped_pending":
          toast.info("Es gibt schon einen offenen Vorschlag. Bitte zuerst übernehmen oder verwerfen.")
          break
        case "skipped_no_candidates":
          toast.info("Im gewählten Zeitraum gibt es keine gesammelten Einträge.")
          break
        default:
          toast.error(`Auswertung fehlgeschlagen: ${result.error ?? "unbekannter Fehler"}`)
      }
      setRunning(false)
      await loadAll()
      await loadCandidates(kindFilter)
    } catch (error) {
      setRunning(false)
      toast.error(errorMessage(error, "Auswertung konnte nicht gestartet werden."))
    }
  }

  const accept = async () => {
    if (!pending) return
    setDeciding(true)
    try {
      let result = await invokeRenderer(
        IPCChannels.Email.AcceptLearningDigest,
        { id: pending.id, content: draft },
      ) as AiLearningDecisionResultDto
      if (!result.success && result.code === "knowledge_base_changed") {
        const ok = window.confirm(
          "Die Wissensbasis wurde seit dem Vorschlag geändert. Beim Übernehmen werden diese Änderungen überschrieben. Trotzdem übernehmen?",
        )
        if (!ok) return
        result = await invokeRenderer(
          IPCChannels.Email.AcceptLearningDigest,
          { id: pending.id, content: draft, confirmOverwrite: true },
        ) as AiLearningDecisionResultDto
      }
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Vorschlag in die Wissensbasis übernommen.")
      await loadAll()
      await loadCandidates(kindFilter)
    } catch (error) {
      toast.error(errorMessage(error, "Übernehmen fehlgeschlagen."))
    } finally {
      setDeciding(false)
    }
  }

  const reject = async () => {
    if (!pending) return
    if (!window.confirm("Vorschlag verwerfen? Die ausgewerteten Einträge werden gelöscht.")) return
    setDeciding(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.RejectLearningDigest, { id: pending.id }) as AiLearningDecisionResultDto
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Vorschlag verworfen.")
      await loadAll()
    } catch (error) {
      toast.error(errorMessage(error, "Verwerfen fehlgeschlagen."))
    } finally {
      setDeciding(false)
    }
  }

  const settings = overview?.settings
  const currentContent = pending ? pending.currentContent ?? pending.baseContent : ""
  const draftChanged = pending ? draft !== pending.proposedContent : false
  const knowledgeBaseChanged = pending
    ? (pending.currentContent ?? "") !== pending.baseContent
    : false
  const targetName = useMemo(() => {
    const id = settings?.targetKnowledgeBaseId ?? overview?.effectiveKnowledgeBaseId ?? null
    if (!id) return null
    return knowledgeBases.find((kb) => kb.id === id)?.name ?? `Wissensbasis #${id}`
  }, [knowledgeBases, overview?.effectiveKnowledgeBaseId, settings?.targetKnowledgeBaseId])
  const showGeneralHint = Boolean(
    overview
    && !settings?.targetKnowledgeBaseId
    && overview.generalKnowledgeBaseCount > (overview.effectiveKnowledgeBaseId ? 1 : 0),
  )

  return (
    <div className="space-y-6">
      <PanelHeader />

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-4 rounded-lg border p-4" aria-label="Einstellungen">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="learnings-collect">Learnings sammeln</Label>
            <p className="text-xs text-muted-foreground">
              Beim Versand werden geänderte KI-Entwürfe und Antworten auf eingehende Mails gesammelt. Notizen
              („Learning notieren“ in der Leseansicht) werden immer gespeichert.
            </p>
          </div>
          <Switch
            id="learnings-collect"
            checked={Boolean(settings?.collectEnabled)}
            disabled={!overview}
            onCheckedChange={(checked) => void saveSettings({ collectEnabled: checked })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="learnings-target">Ziel-Wissensbasis</Label>
            <Select
              value={settings?.targetKnowledgeBaseId ? String(settings.targetKnowledgeBaseId) : DEFAULT_KB_VALUE}
              onValueChange={(value) => void saveSettings({
                targetKnowledgeBaseId: value === DEFAULT_KB_VALUE ? null : Number(value),
              })}
            >
              <SelectTrigger id="learnings-target" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_KB_VALUE}>Eigene Wissensbasis „Learnings“</SelectItem>
                {knowledgeBases.map((kb) => (
                  <SelectItem key={kb.id} value={String(kb.id)}>
                    {kb.name ?? `Wissensbasis #${kb.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Leer: SimpleCRM legt beim ersten Vorschlag eine Wissensbasis „Learnings“ (Kontext allgemein) an.
            </p>
          </div>
          <AiProfileSelect
            id="learnings-profile"
            label="KI-Profil (Chat-Modell)"
            hint="Leer = Standard-Profil. Entscheidungsmodelle eignen sich nicht für die Auswertung."
            value={settings?.profileId ?? null}
            onChange={(profileId) => void saveSettings({ profileId })}
          />
        </div>

        {showGeneralHint ? (
          <Alert>
            <AlertTitle>Hinweis zur allgemeinen Wissensbasis</AlertTitle>
            <AlertDescription>
              KI-Bausteine lesen je Kontext nur eine allgemeine Wissensbasis. Es gibt bereits eine allgemeine
              Wissensbasis — wählen Sie sie als Ziel, damit freigegebene Learnings sicher mitgelesen werden.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground" data-testid="learnings-privacy">
          <p className="font-medium text-foreground">Datenschutz</p>
          <p>
            Schon beim Sammeln entfernt SimpleCRM Zitat, Signatur, Anrede und Grußformel und ersetzt
            personenbezogene Daten (Namen, E-Mail-Adressen, Telefonnummern, IBAN, Links, Adressen, Bestell-,
            Kunden- und Rechnungsnummern) durch Platzhalter. Gespeichert wird nur der bereinigte Text; die KI
            soll nur allgemeine Regeln formulieren, ihre Ausgabe läuft erneut durch denselben Filter. Einträge
            werden nach der Entscheidung über den Vorschlag gelöscht, spätestens nach 90 Tagen.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4" aria-label="Gesammelte Einträge">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Gesammelte Einträge</h4>
            <p className="text-xs text-muted-foreground" data-testid="learnings-counts">
              {overview
                ? `${overview.counts.total} offen · ${overview.counts.draft_edit} geänderte KI-Entwürfe · ${overview.counts.human_reply} Antworten · ${overview.counts.note} Notizen`
                : "Lädt …"}
            </p>
          </div>
          <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as typeof kindFilter)}>
            <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Art filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>Alle Arten</SelectItem>
              <SelectItem value="draft_edit">{learningCandidateKindLabel("draft_edit")}</SelectItem>
              <SelectItem value="human_reply">{learningCandidateKindLabel("human_reply")}</SelectItem>
              <SelectItem value="note">{learningCandidateKindLabel("note")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {candidates.length === 0 ? (
            <li className="px-3 py-4 text-sm text-muted-foreground">Keine offenen Einträge.</li>
          ) : (
            candidates.map((candidate) => (
              <li key={candidate.id} className="flex gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {learningCandidateKindLabel(candidate.kind)}
                    </Badge>
                    <span>{formatDate(candidate.createdAt)}</span>
                  </div>
                  {candidateText(candidate).map((part) => (
                    <p key={part.label} className="whitespace-pre-wrap break-words">
                      <span className="font-medium">{part.label}: </span>
                      {part.text}
                    </p>
                  ))}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-destructive"
                  title="Eintrag löschen"
                  aria-label="Eintrag löschen"
                  onClick={() => void deleteCandidate(candidate.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))
          )}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="learnings-period">Zeitraum</Label>
            <Select value={period} onValueChange={(value) => setPeriod(value as LearningsDigestPeriod)}>
              <SelectTrigger id="learnings-period" className="h-9 w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_LABELS) as LearningsDigestPeriod[]).map((value) => (
                  <SelectItem key={value} value={value}>{PERIOD_LABELS[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="gap-2"
            disabled={running || Boolean(pending)}
            onClick={() => void runDigest()}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Auswertung läuft …" : "Learnings jetzt auswerten"}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => void loadAll()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Aktualisieren
          </Button>
        </div>
        {pending ? (
          <p className="text-xs text-muted-foreground">
            Es gibt einen offenen Vorschlag — erst übernehmen oder verwerfen, dann erneut auswerten.
          </p>
        ) : null}
        {serverClientMode ? null : (
          <p className="text-xs text-muted-foreground">
            Die Auswertung läuft auf diesem Rechner und kann je nach Modell bis zu 90 Sekunden dauern.
          </p>
        )}
      </section>

      {pending ? (
        <section className="space-y-3 rounded-lg border border-sky-500/40 p-4" aria-label="Offener Vorschlag">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">
                Offener Vorschlag{targetName ? ` für „${pending.knowledgeBaseName ?? targetName}“` : ""}
              </h4>
              <p className="text-xs text-muted-foreground">
                {formatDate(pending.createdAt)} · {pending.candidateCount} Einträge ausgewertet
                {pending.requestedByName ? ` · angestoßen von ${pending.requestedByName}` : ""}
              </p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Ansicht">
              <Button
                type="button"
                size="sm"
                variant={mode === "diff" ? "secondary" : "ghost"}
                aria-pressed={mode === "diff"}
                onClick={() => setMode("diff")}
              >
                Änderungen
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "edit" ? "secondary" : "ghost"}
                aria-pressed={mode === "edit"}
                className="gap-1.5"
                onClick={() => setMode("edit")}
              >
                <Pencil className="h-3.5 w-3.5" />
                Bearbeiten
              </Button>
            </div>
          </div>
          {pending.summary ? (
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm" data-testid="learnings-summary">
              {pending.summary}
            </p>
          ) : null}
          {knowledgeBaseChanged ? (
            <Alert variant="destructive">
              <AlertTitle>Wissensbasis wurde zwischenzeitlich geändert</AlertTitle>
              <AlertDescription>
                Die Änderungsansicht vergleicht mit dem aktuellen Stand. Beim Übernehmen werden Änderungen, die
                nach dem Vorschlag gemacht wurden, überschrieben — bitte prüfen oder im Bearbeiten-Modus ergänzen.
              </AlertDescription>
            </Alert>
          ) : null}
          {mode === "diff" ? (
            <LearningsDiffView before={currentContent} after={draft} />
          ) : (
            <KnowledgeMarkdownEditor value={draft} onChange={setDraft} height="min(480px, calc(100vh - 18rem))" />
          )}
          {draftChanged ? (
            <p className="text-xs text-muted-foreground">Der Vorschlag wurde bearbeitet.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="gap-2" disabled={deciding || !draft.trim()} onClick={() => void accept()}>
              <Check className="h-4 w-4" />
              Übernehmen
            </Button>
            <Button type="button" variant="outline" className="gap-2" disabled={deciding} onClick={() => void reject()}>
              <X className="h-4 w-4" />
              Verwerfen
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-2" aria-label="Verlauf">
        <h4 className="text-sm font-semibold">Verlauf</h4>
        {digests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Auswertung.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {digests.map((digest) => (
              <li key={digest.id} className="space-y-1 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={STATUS_CLASSES[digest.status]}>
                    {STATUS_LABELS[digest.status]}
                  </Badge>
                  <span>{formatDate(digest.createdAt)}</span>
                  <span className="text-muted-foreground">
                    {digest.knowledgeBaseName ?? `Wissensbasis #${digest.knowledgeBaseId}`} · {digest.candidateCount} Einträge
                    · {digest.trigger === "workflow" ? "Workflow" : digest.requestedByName ?? "manuell"}
                  </span>
                </div>
                {digest.decidedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Entschieden {formatDate(digest.decidedAt)}{digest.decidedByName ? ` von ${digest.decidedByName}` : ""}
                  </p>
                ) : null}
                {digest.error ? <p className="text-xs text-destructive">{digest.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
