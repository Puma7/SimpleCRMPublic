"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import DOMPurify from "dompurify"
import {
  ComposeQuillEditor,
  type ComposeQuillEditorHandle,
} from "./compose-quill-editor"
import {
  recipientFieldFromJson,
  validateRecipientField,
} from "@shared/email-recipient-parse"
import { Loader2, Paperclip, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { resolveComposeAccountId } from "@shared/mail-account-scope"
import { buildReplyAllRecipients, primaryReplyRecipient } from "@shared/email-reply-addresses"
import { parseDraftAttachmentPathsJson } from "@shared/compose-draft-attachments"
import {
  buildReplyComposeHtml,
  mergeComposeHtml,
  plainTextToReplyHtml,
  splitComposeHtml,
} from "@shared/compose-body"
import {
  applyCannedTemplate,
  firstAddress,
  type EmailAccount,
  formatFrom,
  hasElectron,
  invokeIpc,
  stripHtmlToText,
  type AiPrompt,
  type CannedResponse,
  type CustomerOpt,
  type EmailMessage,
} from "./types"

function customerOptFromDbRow(row: Record<string, unknown>): CustomerOpt {
  const name =
    (typeof row.name === "string" && row.name) ||
    [row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
    (typeof row.company === "string" ? row.company : "") ||
    "Unbekannt"
  return {
    id: Number(row.id),
    name,
    firstName: typeof row.firstName === "string" ? row.firstName : undefined,
    email: typeof row.email === "string" ? row.email : undefined,
  }
}
import { logError } from "./log"
import { useMailWorkspace, type ComposeIntent } from "./workspace-context"
import { useComposeDialogSize } from "./use-compose-dialog-size"

type Props = {
  accounts: EmailAccount[]
  cannedList: CannedResponse[]
  aiPrompts: AiPrompt[]
  onSent: (opts?: { preserveSelection?: boolean }) => void | Promise<void>
}

function getComposeContextMessageId(
  intent: ComposeIntent,
  replyToId: number | null,
): number | null {
  if (
    intent.mode === "reply" ||
    intent.mode === "reply-all" ||
    intent.mode === "forward"
  ) {
    return intent.message.id
  }
  return replyToId
}

function sanitizeComposeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function ComposeDialog({ accounts, cannedList, aiPrompts, onSent }: Props) {
  const {
    composeIntent,
    setComposeIntent,
    selectedAccountId,
    selectedMessage,
    setMailView,
    setSelectedMessage,
  } = useMailWorkspace()

  const isOpen = composeIntent.mode !== "closed"

  const [draftId, setDraftId] = useState<number | null>(null)
  const [replyToId, setReplyToId] = useState<number | null>(null)
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [sending, setSending] = useState(false)
  const [checkingOutbound, setCheckingOutbound] = useState(false)
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([])
  /** Resolved SMTP account for the open draft (never "all"). */
  const [composeAccountId, setComposeAccountId] = useState<number | null>(null)

  // Track which composeIntent the dialog has initialised for.
  // Re-init when the intent actually changes (user clicks Reply on another mail),
  // but NOT when unrelated context values (e.g. selectedAccountId) change while
  // the dialog is open — that would clobber typed content.
  const initialisedDraftKeyRef = useRef<string | null>(null)
  // Guards against Radix firing onOpenChange(false) multiple times (e.g. rapid
  // ESC, or close-button double-click) which could otherwise kick off two
  // parallel saveDraft → closeDialog chains with stale closures.
  const closingRef = useRef(false)
  const editorRef = useRef<ComposeQuillEditorHandle>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped to re-run draft bootstrap (e.g. „Von“-Konto gewechselt) without stale-effect cancel. */
  const [draftBootstrapGen, setDraftBootstrapGen] = useState(0)
  const [draftBootstrapping, setDraftBootstrapping] = useState(false)
  const [aiPromptSelectKey, setAiPromptSelectKey] = useState(0)
  const [scheduledSendAt, setScheduledSendAt] = useState("")
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const { width: composeDialogWidth, startResize: startComposeWidthResize } =
    useComposeDialogSize()

  useEffect(() => {
    if (!isOpen) {
      initialisedDraftKeyRef.current = null
      setDraftBootstrapping(false)
      return
    }
    let messageAccountId: number | undefined
    if (
      composeIntent.mode === "reply" ||
      composeIntent.mode === "reply-all" ||
      composeIntent.mode === "forward"
    ) {
      messageAccountId = composeIntent.message.account_id
    }
    const resolvedAccountId = resolveComposeAccountId(selectedAccountId, {
      messageAccountId,
      firstAccountId: accounts[0]?.id,
    })
    const accountIdAtOpen =
      composeIntent.mode === "new" && composeAccountId != null
        ? composeAccountId
        : resolvedAccountId
    const draftInitKey = `${composeIntent.mode}:${accountIdAtOpen ?? ""}:${composeIntent.mode === "draft" ? composeIntent.messageId : ""}:g${draftBootstrapGen}`
    if (initialisedDraftKeyRef.current === draftInitKey) return
    if (!hasElectron()) return
    if (accountIdAtOpen == null) {
      toast.error(
        "Bitte wählen Sie ein E-Mail-Konto in der Seitenleiste (nicht „Alle Konten“, sofern mehrere Konten aktiv sind).",
      )
      return
    }
    setComposeAccountId(accountIdAtOpen)
    let cancelled = false
    setDraftBootstrapping(true)
    void (async () => {
      try {
        if (composeIntent.mode === "draft") {
          setDraftId(composeIntent.messageId)
          const existing = await invokeIpc<EmailMessage | null>(
            IPCChannels.Email.GetMessage,
            composeIntent.messageId,
          )
          if (cancelled) return
          if (!existing) {
            toast.error("Entwurf nicht gefunden.")
            return
          }
          initialisedDraftKeyRef.current = draftInitKey
          setComposeAccountId(existing.account_id)
          setReplyToId(
            (existing as EmailMessage & { reply_parent_message_id?: number | null })
              .reply_parent_message_id ?? null,
          )
          setTo(recipientFieldFromJson(existing.to_json))
          setCc(recipientFieldFromJson(existing.cc_json))
          setBcc(recipientFieldFromJson(existing.bcc_json))
          setSubject(existing.subject ?? "")
          const html = existing.body_html
            ? sanitizeComposeHtml(existing.body_html)
            : existing.body_text
              ? sanitizeComposeHtml(
                  `<p>${existing.body_text.replace(/\n/g, "<br/>")}</p>`,
                )
              : ""
          setBodyHtml(html)
          setAttachmentPaths(parseDraftAttachmentPathsJson(existing.draft_attachment_paths_json))
          return
        }

        const sourceMsg: EmailMessage | null =
          composeIntent.mode === "reply" ||
          composeIntent.mode === "reply-all" ||
          composeIntent.mode === "forward"
            ? composeIntent.message
            : null
        const isForward = composeIntent.mode === "forward"
        const isReplyAll = composeIntent.mode === "reply-all"
        const ownEmails = accounts.map((a) => a.email_address).filter(Boolean)
        let toAddr = ""
        let ccAddr = ""
        if (isReplyAll && sourceMsg) {
          const all = buildReplyAllRecipients(sourceMsg, ownEmails)
          toAddr = all.to
          ccAddr = all.cc
        } else if (composeIntent.mode === "reply" && sourceMsg) {
          toAddr = primaryReplyRecipient(sourceMsg)
        }
        const subj = sourceMsg?.subject
          ? isForward
            ? sourceMsg.subject.toLowerCase().startsWith("fwd:")
              ? sourceMsg.subject
              : `Fwd: ${sourceMsg.subject}`
            : sourceMsg.subject.toLowerCase().startsWith("re:")
              ? sourceMsg.subject
              : `Re: ${sourceMsg.subject}`
          : ""
        const quoted = sourceMsg
          ? `\n\n---\n${isForward ? "Weitergeleitete Nachricht" : "Am"} ${
              sourceMsg.date_received
                ? new Date(sourceMsg.date_received).toLocaleString("de-DE")
                : "?"
            }${isForward ? "" : " schrieb"} ${formatFrom(sourceMsg.from_json)}:\n${(
              sourceMsg.body_text ||
              sourceMsg.snippet ||
              ""
            ).trim()}`
          : ""

        const sigRes = await invokeIpc<{ html: string | null }>(
          IPCChannels.Email.GetComposeSignature,
          { accountId: accountIdAtOpen },
        )
        const sigHtml =
          composeIntent.mode === "new" && sigRes.html
            ? sanitizeComposeHtml(sigRes.html)
            : ""
        const res = await invokeIpc<
          { success: boolean; id?: number; error?: string }
        >(IPCChannels.Email.CreateComposeDraft, {
          accountId: accountIdAtOpen,
          subject: subj,
          bodyText: quoted,
          to: toAddr,
        })
        if (cancelled) return
        if (res.success && res.id != null) {
          initialisedDraftKeyRef.current = draftInitKey
          setDraftId(res.id)
          const replyParentId =
            composeIntent.mode === "reply" || composeIntent.mode === "reply-all"
              ? sourceMsg?.id ?? null
              : null
          setReplyToId(replyParentId)
          let forwardPaths: string[] = []
          if (isForward && sourceMsg) {
            const atts = await invokeIpc<
              { storage_path: string; filename_display: string }[]
            >(IPCChannels.Email.ListMessageAttachments, sourceMsg.id)
            forwardPaths = atts.map((a) => a.storage_path).filter(Boolean)
          }
          setAttachmentPaths(forwardPaths)
          await invokeIpc(IPCChannels.Email.UpdateComposeDraft, {
            messageId: res.id,
            ...(forwardPaths.length > 0 ? { draftAttachmentPaths: forwardPaths } : {}),
            ...(replyParentId != null ? { replyParentMessageId: replyParentId } : {}),
          })
          setTo(toAddr)
          setCc(ccAddr)
          setBcc("")
          setSubject(subj)
          const initialReplyHtml =
            (composeIntent.mode === "reply" || composeIntent.mode === "reply-all") &&
            composeIntent.initialReplyHtml
              ? composeIntent.initialReplyHtml
              : composeIntent.mode === "reply" ||
                  composeIntent.mode === "reply-all" ||
                  composeIntent.mode === "forward"
                ? "<p><br></p>"
                : ""
          const composed = buildReplyComposeHtml({
            replyHtml: initialReplyHtml
              ? sanitizeComposeHtml(initialReplyHtml)
              : "",
            quotedPlain: quoted,
            signatureHtml:
              sigHtml && composeIntent.mode !== "forward" ? sigHtml : undefined,
          })
          setBodyHtml(composed || sigHtml || "")
        } else {
          toast.error(res.error ?? "Entwurf konnte nicht angelegt werden.")
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Entwurf konnte nicht angelegt werden.")
      } finally {
        if (!cancelled) setDraftBootstrapping(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, composeIntent, selectedAccountId, accounts, draftBootstrapGen])

  const getEditorHtml = useCallback(() => editorRef.current?.getHtml() ?? bodyHtml, [bodyHtml])

  const closeDialog = () => {
    setComposeIntent({ mode: "closed" })
    setComposeAccountId(null)
    setDraftId(null)
    setReplyToId(null)
    setTo("")
    setCc("")
    setBcc("")
    setSubject("")
    setBodyHtml("")
    setAttachmentPaths([])
    closingRef.current = false
  }

  const finishComposeClose = async (contextMessageId: number | null) => {
    closeDialog()
    await onSent(contextMessageId != null ? { preserveSelection: true } : undefined)
    if (contextMessageId != null && hasElectron()) {
      try {
        const full = await invokeIpc<EmailMessage | null>(
          IPCChannels.Email.GetMessage,
          contextMessageId,
        )
        if (full) setSelectedMessage(full)
      } catch (e) {
        logError("compose-dialog: restore context message", e)
      }
    }
  }

  const requestClose = () => {
    if (closingRef.current || sending) return
    if (!hasElectron() || draftId == null) {
      const contextId = getComposeContextMessageId(composeIntent, replyToId)
      void finishComposeClose(contextId)
      return
    }
    setCloseConfirmOpen(true)
  }

  const handleCloseCancel = () => {
    setCloseConfirmOpen(false)
  }

  const handleCloseSaveDraft = () => {
    if (closingRef.current) return
    closingRef.current = true
    setCloseConfirmOpen(false)
    const contextId = getComposeContextMessageId(composeIntent, replyToId)
    void (async () => {
      try {
        const ok = await saveDraft({ silent: true })
        if (ok) toast.success("Entwurf in „Entwürfe“ gespeichert")
        await finishComposeClose(contextId)
      } finally {
        closingRef.current = false
      }
    })()
  }

  const handleCloseDiscard = () => {
    if (closingRef.current) return
    closingRef.current = true
    setCloseConfirmOpen(false)
    const contextId = getComposeContextMessageId(composeIntent, replyToId)
    void (async () => {
      try {
        if (hasElectron() && draftId != null) {
          const r = await invokeIpc<{ success: boolean; error?: string }>(
            IPCChannels.Email.DeleteComposeDraft,
            draftId,
          )
          if (!r.success) {
            toast.error(r.error ?? "Entwurf konnte nicht gelöscht werden.")
            return
          }
        }
        await finishComposeClose(contextId)
      } finally {
        closingRef.current = false
      }
    })()
  }

  const saveDraft = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!hasElectron() || draftId == null) return false
      try {
        const rawHtml = getEditorHtml()
        if (rawHtml !== bodyHtml) setBodyHtml(rawHtml)
        const safeHtml = sanitizeComposeHtml(rawHtml)
        const plain = stripHtmlToText(safeHtml)
        await invokeIpc(IPCChannels.Email.UpdateComposeDraft, {
          messageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || undefined,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          draftAttachmentPaths: attachmentPaths,
          replyParentMessageId: replyToId,
        })
        return true
      } catch (e) {
        logError("compose-dialog: save draft", e)
        if (!opts?.silent) {
          toast.error("Entwurf konnte nicht gespeichert werden.")
        }
        return false
      }
    },
    [draftId, subject, to, cc, bcc, bodyHtml, attachmentPaths, getEditorHtml],
  )

  useEffect(() => {
    if (!isOpen || draftId == null || initialisedDraftKeyRef.current == null) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraft({ silent: true })
    }, 2000)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [isOpen, draftId, to, cc, bcc, subject, bodyHtml, attachmentPaths, saveDraft])

  const handleCheckOutbound = async () => {
    if (!hasElectron() || draftId == null) return
    const toCheck = validateRecipientField(to, "An")
    if (!toCheck.ok) {
      toast.error(toCheck.error)
      return
    }
    if (cc.trim()) {
      const ccCheck = validateRecipientField(cc, "Cc")
      if (!ccCheck.ok) {
        toast.error(ccCheck.error)
        return
      }
    }
    setCheckingOutbound(true)
    try {
      const saved = await saveDraft()
      if (!saved) return

      type WfRow = { trigger: string; enabled: number }
      const workflows = await invokeIpc<WfRow[]>(IPCChannels.Email.ListWorkflows)
      const outboundActive = workflows.filter(
        (w) => w.trigger === "outbound" && w.enabled === 1,
      )
      if (outboundActive.length === 0) {
        toast.info(
          "Keine aktiven Ausgangs-Workflows. Legen Sie unter Einstellungen → Workflows einen Workflow mit Auslöser „Ausgang“ an.",
        )
        return
      }

      const rawHtml = getEditorHtml()
      const safeHtml = sanitizeComposeHtml(rawHtml)
      const plain = stripHtmlToText(safeHtml)
      if (!plain.trim() && !safeHtml.replace(/<[^>]+>/g, "").trim()) {
        toast.error("Bitte zuerst einen Nachrichtentext eingeben.")
        return
      }

      const r = await invokeIpc<{ success: boolean; allowed?: boolean; reason?: string | null }>(
        IPCChannels.Email.ValidateOutbound,
        {
          messageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || undefined,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          attachmentCount: attachmentPaths.length,
        },
      )
      if (!r.success) {
        toast.error("Ausgangsprüfung fehlgeschlagen")
        return
      }
      if (r.allowed) {
        toast.success(
          `Ausgangsprüfung: OK (${outboundActive.length} Workflow${outboundActive.length === 1 ? "" : "s"}) — Versand erlaubt.`,
        )
      } else {
        toast.warning(r.reason ?? "Ausgangsprüfung: Versand würde blockiert.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Prüfung fehlgeschlagen.")
    } finally {
      setCheckingOutbound(false)
    }
  }

  const handleSend = async () => {
    if (!hasElectron() || draftId == null || composeAccountId == null) return
    const toCheck = validateRecipientField(to, "An")
    if (!toCheck.ok) {
      toast.error(toCheck.error)
      return
    }
    if (cc.trim()) {
      const ccCheck = validateRecipientField(cc, "Cc")
      if (!ccCheck.ok) {
        toast.error(ccCheck.error)
        return
      }
    }
    if (bcc.trim()) {
      const bccCheck = validateRecipientField(bcc, "Bcc")
      if (!bccCheck.ok) {
        toast.error(bccCheck.error)
        return
      }
    }
    setSending(true)
    try {
      const saved = await saveDraft()
      if (!saved) return
      const safeHtml = sanitizeComposeHtml(getEditorHtml())
      const plain = stripHtmlToText(safeHtml)
      const r = await invokeIpc<{
        success: boolean
        error?: string
        warning?: string
        recoveredSentAppend?: boolean
      }>(
        IPCChannels.Email.SendCompose,
        {
          accountId: composeAccountId,
          draftMessageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || null,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          inReplyToMessageId: replyToId,
          attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        },
      )
      if (!r.success) {
        const blocked = (r.error ?? "").length > 0
        if (blocked) {
          toast.warning(
            r.error ??
              "Versand blockiert — Entwurf mit Ihrem Text liegt im Posteingang (Bearbeiten).",
          )
          closeDialog()
          setMailView("inbox")
          await onSent()
          try {
            const full = await invokeIpc<EmailMessage | null>(
              IPCChannels.Email.GetMessage,
              draftId,
            )
            if (full) {
              setSelectedMessage(full)
              setComposeIntent({ mode: "draft", messageId: full.id })
            }
          } catch (e) {
            logError("compose-dialog: load blocked draft", e)
          }
        } else {
          toast.error("Versand fehlgeschlagen")
        }
        return
      }
      if (r.recoveredSentAppend) {
        toast.success("Nachricht wurde nachträglich in „Gesendet“ übernommen.")
      } else if (r.warning) {
        toast.warning(r.warning)
      } else {
        toast.success("E-Mail gesendet.")
      }
      const contextId = getComposeContextMessageId(composeIntent, replyToId)
      await finishComposeClose(contextId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Versand fehlgeschlagen.")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        className="relative flex max-h-[92vh] flex-col gap-3 p-0 sm:max-w-[96vw]"
        style={{ width: composeDialogWidth, maxWidth: "96vw" }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Dialogbreite anpassen"
          title="Breite ziehen"
          className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize rounded-r-lg hover:bg-primary/10"
          onMouseDown={startComposeWidthResize}
        />
        <DialogHeader className="border-b px-6 pt-6 pb-3">
          <DialogTitle>
            {composeIntent.mode === "reply"
              ? "Antwort verfassen"
              : composeIntent.mode === "reply-all"
                ? "Allen antworten"
                : composeIntent.mode === "forward"
                  ? "Weiterleiten"
                  : composeIntent.mode === "draft"
                    ? "Entwurf bearbeiten"
                    : "Neue Nachricht"}
          </DialogTitle>
          <DialogDescription>
            Textbausteine und „KI auf Text“ (Prompt aus Einstellungen → E-Mail → KI-Prompts) bearbeiten
            den Nachrichtentext. Zum Senden wird zuerst ein lokaler Entwurf angelegt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6">
          {draftBootstrapping || (draftId == null && hasElectron()) ? (
            <div
              className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
              role="status"
            >
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              {draftBootstrapping
                ? "Entwurf wird vorbereitet…"
                : "Entwurf konnte nicht geladen werden. Dialog schließen und erneut „Verfassen“ wählen."}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Select
              disabled={draftId == null || draftBootstrapping}
              onValueChange={(id) => {
                void (async () => {
                  const c = cannedList.find((x) => x.id === parseInt(id, 10))
                  if (!c) return
                  let customer: CustomerOpt | null = null
                  const cid = selectedMessage?.customer_id
                  if (cid && hasElectron()) {
                    try {
                      const row = (await invokeIpc(
                        IPCChannels.Db.GetCustomer,
                        cid,
                      )) as Record<string, unknown> | null
                      if (row && row.id != null) customer = customerOptFromDbRow(row)
                    } catch (e) {
                      logError("compose: load customer for template", e)
                    }
                  }
                  const block = applyCannedTemplate(c.body, customer)
                  const frag = sanitizeComposeHtml(
                    `<p>${block.replace(/\n/g, "<br/>")}</p>`,
                  )
                  setBodyHtml((prev) => {
                    const { editableHtml, quotedHtml } = splitComposeHtml(prev)
                    return mergeComposeHtml(`${editableHtml}${frag}`, quotedHtml)
                  })
                })()
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Textbaustein" />
              </SelectTrigger>
              <SelectContent>
                {cannedList.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              key={aiPromptSelectKey}
              disabled={draftId == null || draftBootstrapping || aiPrompts.length === 0}
              onValueChange={(id) => {
                void (async () => {
                  const pid = parseInt(id, 10)
                  if (!Number.isFinite(pid)) return
                  const rawHtml = getEditorHtml()
                  const { editableHtml, quotedHtml } = splitComposeHtml(rawHtml)
                  const src = stripHtmlToText(editableHtml)
                  if (!src.trim()) {
                    toast.error(
                      "Bitte zuerst Ihren Antworttext oberhalb des Zitats eingeben, dann einen KI-Prompt wählen.",
                    )
                    setAiPromptSelectKey((k) => k + 1)
                    return
                  }
                  try {
                    const r = await invokeIpc<{
                      success: boolean
                      text?: string
                      error?: string
                    }>(IPCChannels.Email.AiTransformText, {
                      promptId: pid,
                      text: src,
                      customerId: selectedMessage?.customer_id ?? null,
                    })
                    if (r.success && r.text?.trim()) {
                      const transformed = sanitizeComposeHtml(
                        plainTextToReplyHtml(r.text),
                      )
                      setBodyHtml(mergeComposeHtml(transformed, quotedHtml))
                      toast.success("KI-Text eingefügt (Zitat unverändert)")
                    } else {
                      toast.error(
                        r.error ??
                          "KI-Antwort leer. Prüfen Sie Einstellungen → E-Mail → KI (API-Schlüssel und Prompts).",
                      )
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "KI-Fehler")
                  } finally {
                    setAiPromptSelectKey((k) => k + 1)
                  }
                })()
              }}
            >
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue
                  placeholder={
                    aiPrompts.length === 0 ? "Keine KI-Prompts" : "KI auf Text…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {aiPrompts
                  .filter((p) => p.target !== "reply")
                  .map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {accounts.length > 1 && composeIntent.mode === "new" && composeAccountId != null ? (
            <div className="grid grid-cols-[60px_1fr] items-center gap-x-3">
              <Label className="justify-self-end text-xs text-muted-foreground">Von</Label>
              <Select
                value={String(composeAccountId)}
                onValueChange={(v) => {
                  void (async () => {
                    const id = parseInt(v, 10)
                    if (!Number.isFinite(id)) return
                    await saveDraft({ silent: true })
                    initialisedDraftKeyRef.current = null
                    setDraftId(null)
                    setComposeAccountId(id)
                    setDraftBootstrapGen((g) => g + 1)
                  })()
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Konto" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-[60px_1fr] items-center gap-x-3 gap-y-2">
            <Label className="justify-self-end text-xs text-muted-foreground">An</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9"
              placeholder="empfänger@example.com"
            />
            <Label className="justify-self-end text-xs text-muted-foreground">Cc</Label>
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="h-9"
              placeholder="optional"
            />
            <Label className="justify-self-end text-xs text-muted-foreground">Bcc</Label>
            <Input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="h-9"
              placeholder="Blindkopie, optional"
            />
            <Label className="justify-self-end text-xs text-muted-foreground">Betreff</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="compose-quill compose-editor-resize rounded-md border bg-background [&_.ql-container]:rounded-b-md [&_.ql-container]:border-border [&_.ql-container]:bg-background [&_.ql-editor]:text-foreground [&_.ql-toolbar]:rounded-t-md [&_.ql-toolbar]:border-border [&_.ql-toolbar]:bg-muted">
            <ComposeQuillEditor
              ref={editorRef}
              value={bodyHtml}
              onChange={setBodyHtml}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Dialog rechts am Rand und den Nachrichtenbereich unten ziehen, um Breite und Höhe
            anzupassen. Änderungen werden automatisch im Entwurf gespeichert.
          </p>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={async () => {
                  if (!hasElectron()) return
                  const r = await invokeIpc<{ success: boolean; paths: string[] }>(
                    IPCChannels.Email.PickComposeAttachments,
                  )
                  if (r.paths?.length) {
                    setAttachmentPaths((prev) => [...prev, ...r.paths])
                  }
                }}
              >
                <Paperclip className="h-4 w-4" />
                Anhang hinzufügen
              </Button>
            </div>
            {attachmentPaths.length > 0 ? (
              <ul className="space-y-1">
                {attachmentPaths.map((p) => (
                  <li
                    key={p}
                    className="flex items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="truncate">{p.split(/[/\\]/).pop()}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() =>
                        setAttachmentPaths((prev) => prev.filter((x) => x !== p))
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-muted/30 px-6 py-3">
          <Button type="button" variant="ghost" onClick={requestClose}>
            Schließen
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void saveDraft().then((ok) => {
                if (ok) toast.success("Entwurf gespeichert")
              })
            }
          >
            Entwurf speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={checkingOutbound || sending || draftId == null}
            onClick={() => void handleCheckOutbound()}
          >
            {checkingOutbound ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Ausgang prüfen
          </Button>
          <Input
            type="datetime-local"
            className="h-9 w-[200px] text-xs"
            value={scheduledSendAt}
            onChange={(e) => setScheduledSendAt(e.target.value)}
            title="Geplante Versendung"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!scheduledSendAt || draftId == null}
            onClick={() => {
              if (!draftId || !scheduledSendAt) return
              void (async () => {
                await saveDraft({ silent: true })
                const iso = new Date(scheduledSendAt).toISOString()
                await invokeIpc(IPCChannels.Email.ScheduleDraftSend, {
                  messageId: draftId,
                  sendAt: iso,
                })
                toast.success("Versand geplant — Entwurf bleibt gespeichert.")
                const contextId = getComposeContextMessageId(composeIntent, replyToId)
                void finishComposeClose(contextId)
              })()
            }}
          >
            Später senden
          </Button>
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || draftId == null || draftBootstrapping || composeAccountId == null}
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Senden
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Verfassen schließen?</AlertDialogTitle>
          <AlertDialogDescription>
            Möchten Sie den Entwurf in „Entwürfe“ behalten oder verwerfen? Bei „Verwerfen“ wird der
            Entwurf endgültig gelöscht.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel type="button" onClick={handleCloseCancel}>
            Abbrechen
          </AlertDialogCancel>
          <Button type="button" variant="outline" onClick={() => handleCloseDiscard()}>
            Verwerfen
          </Button>
          <AlertDialogAction type="button" onClick={() => handleCloseSaveDraft()}>
            Als Entwurf speichern
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
