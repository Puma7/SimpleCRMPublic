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
import { CircleHelp, Loader2, Paperclip, X } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  getRendererTransport,
  invokeRenderer,
  uploadServerComposeAttachment,
} from "@/services/transport"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { resolveComposeAccountId } from "@shared/mail-account-scope"
import { buildReplyAllRecipients, primaryReplyRecipient } from "@shared/email-reply-addresses"
import { parseDraftAttachmentPathsJson } from "@shared/compose-draft-attachments"
import {
  buildReplyComposeHtml,
  composeAiContextText,
  mergeComposeHtml,
  mergeComposeZones,
  plainTextToReplyHtml,
  splitComposeHtml,
  splitComposeZones,
} from "@shared/compose-body"
import {
  aiDraftLikelyIncludesGreeting,
  buildReplyGreeting,
  replyGreetingPlainToHtml,
} from "@shared/email-reply-greeting"
import { interpolateSignatureTemplate } from "@shared/signature-template"
import { WorkflowRunDetailDialog } from "./workflow/workflow-run-detail-dialog"
import {
  applyCannedTemplate,
  firstAddress,
  type EmailAccount,
  formatFrom,
  hasLocalIpc,
  invokeIpc,
  stripHtmlToText,
  type AiPrompt,
  type CannedResponse,
  type CustomerOpt,
  type EmailMessage,
} from "./types"

function getInboundContextText(sourceMsg: EmailMessage | null): string {
  if (!sourceMsg) return ""
  const raw = (sourceMsg.body_text ?? sourceMsg.snippet ?? stripHtmlToText(sourceMsg.body_html ?? "")).trim()
  return raw.slice(0, 12_000)
}

function getComposeSourceMessage(intent: ComposeIntent): EmailMessage | null {
  if (intent.mode === "reply" || intent.mode === "reply-all" || intent.mode === "forward") {
    return intent.message
  }
  return null
}

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

const MAX_SERVER_CLIENT_ATTACHMENT_BYTES = 25 * 1024 * 1024

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."))
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const comma = result.indexOf(",")
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
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
  const serverClientMode = getRendererTransport().kind === "http"
  const localAttachmentPickerAvailable = !serverClientMode && hasLocalIpc()
  const resendFinalizeDescription = serverClientMode
    ? "Die Mail wurde per SMTP versendet, die serverseitige Finalisierung (Gesendet-Ordner) ist ausstehend. Senden erneut klicken - es wird kein zweites Mal an SMTP gesendet."
    : "Die Mail wurde per SMTP versendet, die lokale Finalisierung (Gesendet-Ordner) ist ausstehend. Senden erneut klicken - es wird kein zweites Mal an SMTP gesendet."

  const [draftId, setDraftId] = useState<number | null>(null)
  const [replyToId, setReplyToId] = useState<number | null>(null)
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [sending, setSending] = useState(false)
  const [pgpEncrypt, setPgpEncrypt] = useState(false)
  const [pgpSign, setPgpSign] = useState(false)
  const [pgpPassphrase, setPgpPassphrase] = useState("")
  const [recipientKeyHint, setRecipientKeyHint] = useState<string | null>(null)
  const [checkingOutbound, setCheckingOutbound] = useState(false)
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
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
  const serverAttachmentInputRef = useRef<HTMLInputElement>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped to re-run draft bootstrap (e.g. „Von“-Konto gewechselt) without stale-effect cancel. */
  const [draftBootstrapGen, setDraftBootstrapGen] = useState(0)
  const [draftBootstrapping, setDraftBootstrapping] = useState(false)
  const [aiPromptSelectKey, setAiPromptSelectKey] = useState(0)
  const [rewriteContextOpen, setRewriteContextOpen] = useState(false)
  const [rewriteContextText, setRewriteContextText] = useState("")
  const [rewriteContextBusy, setRewriteContextBusy] = useState(false)
  const [scheduledSendAt, setScheduledSendAt] = useState("")
  const [scheduledSendFailed, setScheduledSendFailed] = useState<{
    lastError: string
  } | null>(null)
  const [composeRecovery, setComposeRecovery] = useState<{
    needsResendFinalize: boolean
  } | null>(null)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [workflowRunDetailId, setWorkflowRunDetailId] = useState<number | null>(null)
  const [workflowRunDetailOpen, setWorkflowRunDetailOpen] = useState(false)
  /** When replying: keep original in inbox as open (do not set done on send). */
  const [keepReplyOpenInInbox, setKeepReplyOpenInInbox] = useState(false)
  const {
    width: composeDialogWidth,
    dialogHeightCss,
    startResize: startComposeWidthResize,
    startHeightResize: startComposeHeightResize,
  } = useComposeDialogSize()

  const isReplyCompose =
    composeIntent.mode === "reply" || composeIntent.mode === "reply-all"

  useEffect(() => {
    if (!draftId) {
      setScheduledSendFailed(null)
      setComposeRecovery(null)
      return
    }
    void invokeRenderer(IPCChannels.Email.GetScheduledSendDraftState, draftId)
      .then((r) => {
        const state = r as {
          success: true
          failureCount: number
          status: "ok" | "pending" | "failed"
          lastError: string | null
        }
        if (state.status === "failed") {
          setScheduledSendFailed({
            lastError: state.lastError ?? "Geplanter Versand fehlgeschlagen",
          })
        } else {
          setScheduledSendFailed(null)
        }
      })
      .catch(() => setScheduledSendFailed(null))
    void invokeRenderer(IPCChannels.Email.GetComposeDraftRecoveryState, draftId)
      .then((r) => {
        const state = r as {
          success: true
          smtpCommitted: boolean
          needsResendFinalize: boolean
        }
        if (state.needsResendFinalize) {
          setComposeRecovery({ needsResendFinalize: true })
        } else {
          setComposeRecovery(null)
        }
      })
      .catch(() => setComposeRecovery(null))
  }, [draftId])

  useEffect(() => {
    if (!isOpen) {
      initialisedDraftKeyRef.current = null
      setDraftBootstrapping(false)
      setKeepReplyOpenInInbox(false)
      return
    }
    if (composeIntent.mode === "reply" || composeIntent.mode === "reply-all") {
      setKeepReplyOpenInInbox(false)
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
          const existing = await invokeRenderer(
            IPCChannels.Email.GetMessage,
            composeIntent.messageId,
          ) as EmailMessage | null
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

        const sigRes = await invokeRenderer(
          IPCChannels.Email.GetComposeSignature,
          { accountId: accountIdAtOpen },
        ) as { html: string | null }
        let customerForSig: CustomerOpt | null = null
        let customerSalutation: string | null = null
        if (sourceMsg?.customer_id) {
          try {
            const row = await invokeRenderer(
              IPCChannels.Db.GetCustomer,
              sourceMsg.customer_id,
            ) as Record<string, unknown> | null
            if (row) {
              customerForSig = customerOptFromDbRow(row)
              customerSalutation = typeof row.salutation === "string" ? row.salutation : null
            }
          } catch {
            customerForSig = null
          }
        }
        const accountRow = accounts.find((a) => a.id === accountIdAtOpen)
        const sigRaw =
          sigRes.html && composeIntent.mode !== "forward"
            ? interpolateSignatureTemplate(sigRes.html, {
                accountDisplayName: accountRow?.display_name ?? "",
                customerName: customerForSig?.name ?? "",
                customerFirstName: customerForSig?.firstName ?? "",
                customerEmail: customerForSig?.email ?? "",
              })
            : ""
        const sigHtml = sigRaw ? sanitizeComposeHtml(sigRaw) : ""
        const res = await invokeRenderer(IPCChannels.Email.CreateComposeDraft, {
          accountId: accountIdAtOpen,
          subject: subj,
          bodyText: quoted,
          to: toAddr,
        }) as { success: boolean; id?: number; error?: string }
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
            const atts = await invokeRenderer(
              IPCChannels.Email.ListMessageAttachments,
              sourceMsg.id,
            ) as { storage_path: string; filename_display: string }[]
            forwardPaths = atts.map((a) => a.storage_path).filter(Boolean)
          }
          setAttachmentPaths(forwardPaths)
          await invokeRenderer(IPCChannels.Email.UpdateComposeDraft, {
            messageId: res.id,
            ...(forwardPaths.length > 0 ? { draftAttachmentPaths: forwardPaths } : {}),
            ...(replyParentId != null ? { replyParentMessageId: replyParentId } : {}),
          })
          setTo(toAddr)
          setCc(ccAddr)
          setBcc("")
          setSubject(subj)
          const hasAiInitial =
            (composeIntent.mode === "reply" || composeIntent.mode === "reply-all") &&
            !!composeIntent.initialReplyHtml?.trim()
          let greetingHtml = ""
          if (
            (composeIntent.mode === "reply" || composeIntent.mode === "reply-all") &&
            sourceMsg &&
            !hasAiInitial
          ) {
            greetingHtml = replyGreetingPlainToHtml(
              buildReplyGreeting({
                customer: customerForSig
                  ? {
                      salutation: customerSalutation,
                      name: customerForSig.name,
                      firstName: customerForSig.firstName,
                    }
                  : null,
                fromJson: sourceMsg.from_json,
              }),
            )
          }
          const initialReplyHtml = hasAiInitial
            ? composeIntent.initialReplyHtml!
            : composeIntent.mode === "reply" ||
                composeIntent.mode === "reply-all" ||
                composeIntent.mode === "forward"
              ? "<p><br></p>"
              : ""
          const composed = buildReplyComposeHtml({
            greetingHtml: hasAiInitial && aiDraftLikelyIncludesGreeting(composeIntent.initialReplyHtml!)
              ? ""
              : greetingHtml,
            replyHtml: initialReplyHtml
              ? sanitizeComposeHtml(
                  hasAiInitial ? composeIntent.initialReplyHtml! : initialReplyHtml,
                )
              : "",
            quotedPlain: quoted,
            signatureHtml: sigHtml || undefined,
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

  const resolveComposeCustomerId = useCallback(() => {
    const src = getComposeSourceMessage(composeIntent)
    return src?.customer_id ?? selectedMessage?.customer_id ?? null
  }, [composeIntent, selectedMessage?.customer_id])

  const runAiComposeTransform = useCallback(
    async (opts: { promptId: number; userContext?: string; rewriteBody?: boolean }) => {
      const rawHtml = getEditorHtml()
      const zones = splitComposeZones(rawHtml)
      const bodyText = stripHtmlToText(zones.bodyHtml)
      const aiContext = composeAiContextText(zones)
      const selectionText = editorRef.current?.getSelectionText() ?? null
      const useSelection = !opts.rewriteBody && !!selectionText?.trim()
      const src = opts.rewriteBody ? bodyText : useSelection ? selectionText! : bodyText
      if (!src.trim()) {
        toast.error(
          "Bitte zuerst Ihren Antworttext eingeben (oder eine Stelle markieren), dann einen KI-Prompt wählen.",
        )
        return false
      }
      const sourceMsg = getComposeSourceMessage(composeIntent)
      const r = await invokeRenderer(IPCChannels.Email.AiTransformText, {
        promptId: opts.promptId,
        text: src,
        contextText: aiContext || undefined,
        inboundContextText: getInboundContextText(sourceMsg) || undefined,
        userContext: opts.userContext?.trim() || undefined,
        customerId: resolveComposeCustomerId(),
      }) as { success: boolean; text?: string; error?: string }
      if (r.success && r.text?.trim()) {
        if (useSelection && editorRef.current?.replaceSelectionText(r.text.trim())) {
          toast.success("KI hat den markierten Text ersetzt")
        } else if (opts.rewriteBody) {
          const transformed = sanitizeComposeHtml(plainTextToReplyHtml(r.text))
          setBodyHtml(
            mergeComposeZones({
              ...zones,
              bodyHtml: transformed,
            }),
          )
          toast.success("KI hat den Haupttext neu geschrieben (Anrede, Signatur und Zitat unverändert)")
        } else {
          const transformed = sanitizeComposeHtml(plainTextToReplyHtml(r.text))
          setBodyHtml(
            mergeComposeZones({
              ...zones,
              bodyHtml: transformed,
            }),
          )
          toast.success("KI-Text eingefügt (Signatur und Zitat unverändert)")
        }
        return true
      }
      toast.error(
        r.error ??
          "KI-Antwort leer. Prüfen Sie Einstellungen → E-Mail → KI (API-Schlüssel und Prompts).",
      )
      return false
    },
    [composeIntent, getEditorHtml, resolveComposeCustomerId],
  )

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
    if (contextMessageId != null) {
      try {
        const full = await invokeRenderer(
          IPCChannels.Email.GetMessage,
          contextMessageId,
        ) as EmailMessage | null
        if (full) setSelectedMessage(full)
      } catch (e) {
        logError("compose-dialog: restore context message", e)
      }
    }
  }

  const requestClose = () => {
    if (closingRef.current || sending) return
    if (draftId == null) {
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
        if (draftId != null) {
          const r = await invokeRenderer(
            IPCChannels.Email.DeleteComposeDraft,
            draftId,
          ) as { success: boolean; error?: string }
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
      if (draftId == null) return false
      try {
        const rawHtml = getEditorHtml()
        if (rawHtml !== bodyHtml) setBodyHtml(rawHtml)
        const safeHtml = sanitizeComposeHtml(rawHtml)
        const plain = stripHtmlToText(safeHtml)
        await invokeRenderer(IPCChannels.Email.UpdateComposeDraft, {
          messageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || undefined,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          draftAttachmentPaths: attachmentPaths,
          replyParentMessageId: replyToId,
          markReplyParentDone:
            isReplyCompose && replyToId != null ? !keepReplyOpenInInbox : undefined,
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
    [
      draftId,
      subject,
      to,
      cc,
      bcc,
      bodyHtml,
      attachmentPaths,
      getEditorHtml,
      isReplyCompose,
      keepReplyOpenInInbox,
      replyToId,
    ],
  )

  const handleServerAttachmentFiles = async (files: FileList | null) => {
    if (!serverClientMode || draftId == null || !files?.length) return
    setUploadingAttachment(true)
    try {
      const uploadedPaths: string[] = []
      for (const file of Array.from(files)) {
        if (file.size > MAX_SERVER_CLIENT_ATTACHMENT_BYTES) {
          toast.error(`${file.name}: Anhang ist größer als 25 MB.`)
          continue
        }
        const contentBase64 = await fileToBase64(file)
        const uploaded = await uploadServerComposeAttachment({
          draftMessageId: draftId,
          filename: file.name || "attachment",
          contentBase64,
          contentType: file.type || undefined,
        })
        uploadedPaths.push(uploaded.path)
      }
      if (uploadedPaths.length === 0) return
      const nextPaths = [...new Set([...attachmentPaths, ...uploadedPaths])]
      setAttachmentPaths(nextPaths)
      await invokeRenderer(IPCChannels.Email.UpdateComposeDraft, {
        messageId: draftId,
        draftAttachmentPaths: nextPaths,
      })
      toast.success(
        uploadedPaths.length === 1
          ? "Anhang hochgeladen"
          : `${uploadedPaths.length} Anhänge hochgeladen`,
      )
    } catch (e) {
      logError("compose-dialog: upload server attachment", e)
      toast.error(e instanceof Error ? e.message : "Anhang konnte nicht hochgeladen werden.")
    } finally {
      setUploadingAttachment(false)
      if (serverAttachmentInputRef.current) serverAttachmentInputRef.current.value = ""
    }
  }

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
    if (draftId == null) return
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
      const workflows = composeAccountId != null
        ? await invokeRenderer(IPCChannels.Email.ListWorkflows, { accountId: composeAccountId }) as WfRow[]
        : await invokeRenderer(IPCChannels.Email.ListWorkflows) as WfRow[]
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

      const r = await invokeRenderer(
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
      ) as { success: boolean; allowed?: boolean; reason?: string | null }
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
    if (draftId == null || composeAccountId == null) return
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
      const r = await invokeRenderer(IPCChannels.Email.SendCompose, {
        accountId: composeAccountId,
        draftMessageId: draftId,
        subject,
        bodyText: plain,
        bodyHtml: serverClientMode && pgpEncrypt ? null : safeHtml || null,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        inReplyToMessageId: replyToId,
        attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        markReplyParentDone:
          isReplyCompose && replyToId != null ? !keepReplyOpenInInbox : undefined,
        pgpEncrypt: pgpEncrypt || undefined,
        pgpSign: pgpSign || undefined,
        pgpPassphrase: pgpSign ? pgpPassphrase : undefined,
      }) as {
        success: boolean
        error?: string
        warning?: string
        recoveredSentAppend?: boolean
        workflowRunId?: number | null
      }
      if (!r.success) {
        const blocked = (r.error ?? "").length > 0
        if (blocked) {
          const msg =
            r.error ??
            "Versand blockiert — Entwurf mit Ihrem Text liegt im Posteingang (Bearbeiten)."
          if (r.workflowRunId) {
            toast.warning(msg, {
              action: {
                label: "Workflow-Details",
                onClick: () => {
                  setWorkflowRunDetailId(r.workflowRunId!)
                  setWorkflowRunDetailOpen(true)
                },
              },
            })
          } else {
            toast.warning(msg)
          }
          closeDialog()
          setMailView("inbox")
          await onSent()
          try {
            const full = await invokeRenderer(
              IPCChannels.Email.GetMessage,
              draftId,
            ) as EmailMessage | null
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
      setPgpPassphrase("")
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
    <>
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        className="fixed left-1/2 top-[4vh] z-50 flex min-h-0 w-full -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw] sm:rounded-lg"
        style={{
          width: composeDialogWidth,
          maxWidth: "96vw",
          height: dialogHeightCss,
          maxHeight: dialogHeightCss,
        }}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Dialogbreite anpassen"
          title="Dialogbreite: am rechten Rand nach links oder rechts ziehen"
          className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize rounded-r-lg hover:bg-primary/10"
          onMouseDown={startComposeWidthResize}
        />
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Dialoghöhe anpassen"
          title="Dialoghöhe: am unteren Rand nach oben oder unten ziehen"
          className="absolute bottom-0 left-0 right-0 z-10 h-2 cursor-ns-resize rounded-b-lg hover:bg-primary/10"
          onMouseDown={startComposeHeightResize}
        />
        <DialogHeader className="shrink-0 border-b px-6 pt-6 pb-3">
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
            Beim Öffnen wird automatisch ein Entwurf angelegt und alle paar Sekunden gespeichert.
            Empfänger und Betreff oben, Ihren Text im großen Feld darunter.
          </DialogDescription>
          {isReplyCompose && replyToId != null ? (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left text-sm">
              <Checkbox
                className="mt-0.5"
                checked={keepReplyOpenInInbox}
                onCheckedChange={(v) => setKeepReplyOpenInInbox(v === true)}
              />
              <span>
                <span className="font-medium">Im Posteingang offen lassen</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Standard: Ursprungsnachricht wird nach dem Senden als erledigt markiert. Aktivieren,
                  wenn Sie sie als Erinnerung offen behalten möchten.
                </span>
              </span>
            </label>
          ) : null}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pb-2 pt-1">
          {draftBootstrapping || draftId == null ? (
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
          {composeRecovery?.needsResendFinalize ? (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
              role="status"
            >
              <p className="font-medium">Versand unterbrochen</p>
              <p className="mt-1 text-xs opacity-90">
                {resendFinalizeDescription}
              </p>
            </div>
          ) : null}
          {scheduledSendFailed ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">Geplanter Versand fehlgeschlagen</p>
              <p className="mt-1 text-xs opacity-90">{scheduledSendFailed.lastError}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={draftId == null}
                  onClick={() => {
                    if (!draftId) return
                    void invokeRenderer(IPCChannels.Email.RetryScheduledSendDraft, draftId).then(
                      () => {
                        setScheduledSendFailed(null)
                        toast.success("Versand erneut eingeplant (sofort).")
                      },
                    )
                  }}
                >
                  Erneut versuchen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={draftId == null}
                  onClick={() => {
                    if (!draftId) return
                    void invokeRenderer(
                      IPCChannels.Email.ClearScheduledSendDraftFailure,
                      draftId,
                    ).then(() => {
                      setScheduledSendFailed(null)
                      toast.success("Fehlerstatus zurückgesetzt — Versand erneut planen oder jetzt senden.")
                    })
                  }}
                >
                  Fehler zurücksetzen
                </Button>
              </div>
            </div>
          ) : null}
          <div className="shrink-0 space-y-2 rounded-md border border-border/60 bg-muted/25 p-3">
            <p className="text-xs font-medium text-foreground">Text-Hilfen</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Einfügen oder umformulieren oberhalb des Zitats — das Original bleibt darunter
              unverändert.
            </p>
            <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="compose-canned" className="text-xs text-muted-foreground">
                  Textbaustein
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label="Hilfe Textbaustein"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    Fertigen Text aus Einstellungen → E-Mail → Textbausteine einfügen. Platzhalter
                    wie Kundenname werden ersetzt, wenn ein Kunde verknüpft ist.
                  </TooltipContent>
                </Tooltip>
              </div>
            <Select
              disabled={draftId == null || draftBootstrapping}
              onValueChange={(id) => {
                void (async () => {
                  const c = cannedList.find((x) => x.id === parseInt(id, 10))
                  if (!c) return
                  let customer: CustomerOpt | null = null
                  const cid = selectedMessage?.customer_id
                  if (Number.isInteger(cid) && Number(cid) > 0) {
                    try {
                      const row = (await invokeRenderer(
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
                    const zones = splitComposeZones(prev)
                    return mergeComposeZones({
                      ...zones,
                      bodyHtml: `${zones.bodyHtml}${frag}`,
                    })
                  })
                })()
              }}
            >
              <SelectTrigger id="compose-canned" className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Baustein wählen…" />
              </SelectTrigger>
              <SelectContent>
                {cannedList.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="compose-ai" className="text-xs text-muted-foreground">
                  KI auf Text
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label="Hilfe KI auf Text"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    Formuliert den Haupttext Ihrer Antwort mit einem Prompt aus Einstellungen →
                    E-Mail → KI-Prompts. Anrede, Signatur und Zitat bleiben geschützt. Markieren Sie
                    nur eine Stelle, um ausschließlich diese umzuschreiben — die KI kennt den
                    restlichen Antwortentwurf und die eingehende Kundenmail als Kontext.
                  </TooltipContent>
                </Tooltip>
              </div>
            <div className="flex flex-wrap items-center gap-2">
            <Select
              key={aiPromptSelectKey}
              disabled={draftId == null || draftBootstrapping || aiPrompts.length === 0}
              onValueChange={(id) => {
                void (async () => {
                  const pid = parseInt(id, 10)
                  if (!Number.isFinite(pid)) return
                  try {
                    await runAiComposeTransform({ promptId: pid })
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "KI-Fehler")
                  } finally {
                    setAiPromptSelectKey((k) => k + 1)
                  }
                })()
              }}
            >
              <SelectTrigger id="compose-ai" className="h-8 w-[220px] text-xs">
                <SelectValue
                  placeholder={
                    aiPrompts.length === 0 ? "Keine KI-Prompts" : "Prompt wählen…"
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={draftId == null || draftBootstrapping || aiPrompts.filter((p) => p.target !== "reply").length === 0}
              onClick={() => {
                setRewriteContextText("")
                setRewriteContextOpen(true)
              }}
            >
              Neu schreiben mit Kontext…
            </Button>
            </div>
            </div>
            </div>
          </div>

          <div className="shrink-0 space-y-3">
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
          </div>

          <div
            className="compose-quill compose-editor-fill min-h-0 flex-1 rounded-md border bg-background [&_.ql-container]:rounded-b-md [&_.ql-container]:border-border [&_.ql-container]:bg-background [&_.ql-editor]:text-foreground [&_.ql-toolbar]:rounded-t-md [&_.ql-toolbar]:border-border [&_.ql-toolbar]:bg-muted"
            title="Nachrichtenhöhe: an der unteren Kante des Feldes nach oben oder unten ziehen"
          >
            <ComposeQuillEditor
              ref={editorRef}
              value={bodyHtml}
              onChange={setBodyHtml}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/30 px-6 py-3">
          {attachmentPaths.length > 0 ? (
            <ul className="max-h-24 space-y-1 overflow-y-auto">
              {attachmentPaths.map((p) => (
                <li
                  key={p}
                  className="flex items-center justify-between gap-2 rounded border bg-background/80 px-2 py-1 text-xs"
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {serverClientMode ? (
                <input
                  ref={serverAttachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleServerAttachmentFiles(event.currentTarget.files)
                  }}
                />
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={
                  serverClientMode
                    ? draftId == null || uploadingAttachment
                    : !localAttachmentPickerAvailable
                }
                onClick={async () => {
                  if (serverClientMode) {
                    serverAttachmentInputRef.current?.click()
                    return
                  }
                  if (!localAttachmentPickerAvailable) return
                  const r = await invokeIpc<{ success: boolean; paths: string[] }>(
                    IPCChannels.Email.PickComposeAttachments,
                  )
                  if (r.paths?.length) {
                    setAttachmentPaths((prev) => [...prev, ...r.paths])
                  }
                }}
              >
                {uploadingAttachment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                Anhang hinzufügen
              </Button>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <Checkbox checked={pgpEncrypt} onCheckedChange={(v) => setPgpEncrypt(v === true)} />
                  PGP verschlüsseln
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={pgpSign} onCheckedChange={(v) => setPgpSign(v === true)} />
                  PGP signieren
                </label>
                {pgpSign ? (
                  <Input
                    type="password"
                    placeholder="PGP-Passphrase"
                    className="h-8 max-w-[200px]"
                    value={pgpPassphrase}
                    onChange={(e) => setPgpPassphrase(e.target.value)}
                  />
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={!to.trim()}
                  title={to.trim() ? "PGP-Schlüssel der Empfänger prüfen" : "Erst Empfänger eintragen"}
                  onClick={async () => {
                    if (!to.trim()) {
                      setRecipientKeyHint("Erst Empfänger eintragen")
                      return
                    }
                    try {
                      const { extractEmailAddressesFromRecipientField } = await import(
                        "@shared/email-recipient-parse"
                      )
                      const emails = extractEmailAddressesFromRecipientField(to)
                      if (emails.length === 0) {
                        setRecipientKeyHint("Keine gültige Empfängeradresse gefunden")
                        return
                      }
                      const status = await invokeRenderer(
                        IPCChannels.Pgp.CheckRecipientKeys,
                        { emails },
                      ) as { email: string; hasKey: boolean }[]
                      if (Array.isArray(status)) {
                        const missing = status.filter((s) => !s.hasKey).map((s) => s.email)
                        const hint = missing.length
                          ? `Ohne Schlüssel: ${missing.join(", ")}`
                          : "Alle Empfänger haben Schlüssel"
                        setRecipientKeyHint(hint)
                        if (missing.length) toast.warning(hint)
                        else toast.success(hint)
                      }
                    } catch (err) {
                      console.error("PGP recipient key check failed", err)
                      setRecipientKeyHint("Schlüsselprüfung fehlgeschlagen")
                      toast.error("PGP-Schlüsselprüfung fehlgeschlagen")
                    }
                  }}
                >
                  Schlüssel prüfen
                </Button>
                {recipientKeyHint ? (
                  <span className="text-muted-foreground">{recipientKeyHint}</span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
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
                    await invokeRenderer(IPCChannels.Email.ScheduleDraftSend, {
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
          </div>
        </div>
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

    <AlertDialog open={rewriteContextOpen} onOpenChange={setRewriteContextOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Haupttext neu schreiben</AlertDialogTitle>
          <AlertDialogDescription>
            Geben Sie Hinweise für die KI ein (z. B. „Stornierung noch möglich“). Anrede, Signatur
            und Zitat bleiben unverändert. Die eingehende Kundenmail wird automatisch als Kontext
            mitgegeben.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={rewriteContextText}
          onChange={(e) => setRewriteContextText(e.target.value)}
          placeholder="Zusätzlicher Kontext für die KI…"
          className="min-h-[100px] text-sm"
        />
        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={rewriteContextBusy}>
            Abbrechen
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={rewriteContextBusy || !rewriteContextText.trim()}
            onClick={(e) => {
              e.preventDefault()
              const defaultPrompt = aiPrompts.find((p) => p.target !== "reply")
              if (!defaultPrompt) {
                toast.error("Bitte zuerst einen KI-Prompt unter Einstellungen anlegen.")
                return
              }
              setRewriteContextBusy(true)
              void (async () => {
                try {
                  const ok = await runAiComposeTransform({
                    promptId: defaultPrompt.id,
                    userContext: rewriteContextText,
                    rewriteBody: true,
                  })
                  if (ok) setRewriteContextOpen(false)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "KI-Fehler")
                } finally {
                  setRewriteContextBusy(false)
                }
              })()
            }}
          >
            {rewriteContextBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Neu schreiben
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <WorkflowRunDetailDialog
      runId={workflowRunDetailId}
      open={workflowRunDetailOpen}
      onOpenChange={setWorkflowRunDetailOpen}
    />
    </>
    </TooltipProvider>
  )
}
