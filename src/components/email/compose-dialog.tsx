"use client"

import { useEffect, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import DOMPurify from "dompurify"
import { ComposeQuillEditor } from "./compose-quill-editor"
import { validateRecipientField } from "@shared/email-recipient-parse"
import { Loader2, Paperclip, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
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

type Props = {
  accounts: EmailAccount[]
  cannedList: CannedResponse[]
  aiPrompts: AiPrompt[]
  onSent: () => void | Promise<void>
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

  useEffect(() => {
    if (!isOpen) {
      initialisedDraftKeyRef.current = null
      return
    }
    let messageAccountId: number | undefined
    if (composeIntent.mode === "reply" || composeIntent.mode === "forward") {
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
    const draftInitKey = `${composeIntent.mode}:${accountIdAtOpen ?? ""}:${composeIntent.mode === "draft" ? composeIntent.messageId : ""}`
    if (initialisedDraftKeyRef.current === draftInitKey) return
    if (!hasElectron() || accountIdAtOpen == null) return
    setComposeAccountId(accountIdAtOpen)
    initialisedDraftKeyRef.current = draftInitKey
    let cancelled = false
    void (async () => {
      try {
        if (composeIntent.mode === "draft") {
          setDraftId(composeIntent.messageId)
          setReplyToId(null)
          const existing = await invokeIpc<EmailMessage | null>(
            IPCChannels.Email.GetMessage,
            composeIntent.messageId,
          )
          if (cancelled || !existing) return
          setComposeAccountId(existing.account_id)
          setTo("")
          setCc("")
          setSubject(existing.subject ?? "")
          const html = existing.body_html
            ? sanitizeComposeHtml(existing.body_html)
            : existing.body_text
              ? sanitizeComposeHtml(
                  `<p>${existing.body_text.replace(/\n/g, "<br/>")}</p>`,
                )
              : ""
          setBodyHtml(html)
          return
        }

        const sourceMsg: EmailMessage | null =
          composeIntent.mode === "reply" || composeIntent.mode === "forward"
            ? composeIntent.message
            : null
        const isForward = composeIntent.mode === "forward"
        const toAddr =
          composeIntent.mode === "reply" ? firstAddress(sourceMsg?.from_json ?? null) : ""
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
        const res = await invokeIpc<{ id?: number }>(IPCChannels.Email.CreateComposeDraft, {
          accountId: accountIdAtOpen,
          subject: subj,
          bodyText: quoted,
          to: toAddr,
        })
        if (cancelled) return
        if (res.id != null) {
          setDraftId(res.id)
          setReplyToId(composeIntent.mode === "reply" ? sourceMsg?.id ?? null : null)
          setAttachmentPaths([])
          setTo(toAddr)
          setCc("")
          setSubject(subj)
          const bodyPart = quoted
            ? sanitizeComposeHtml(`<p>${quoted.replace(/\n/g, "<br/>")}</p>`)
            : ""
          setBodyHtml(
            bodyPart && sigHtml
              ? `${bodyPart}<br/><br/>${sigHtml}`
              : bodyPart || sigHtml,
          )
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Entwurf konnte nicht angelegt werden.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, composeIntent, selectedAccountId, accounts, composeAccountId])

  const closeDialog = () => {
    setComposeIntent({ mode: "closed" })
    setComposeAccountId(null)
    setDraftId(null)
    setReplyToId(null)
    setTo("")
    setCc("")
    setSubject("")
    setBodyHtml("")
    setAttachmentPaths([])
    closingRef.current = false
  }

  const requestClose = () => {
    if (closingRef.current) return
    // Don't interfere with an in-flight send — the send chain will
    // close the dialog on completion.
    if (sending) return
    closingRef.current = true
    void saveDraft().then(closeDialog)
  }

  const saveDraft = async () => {
    if (!hasElectron() || draftId == null) return
    try {
      const safeHtml = sanitizeComposeHtml(bodyHtml)
      const plain = stripHtmlToText(safeHtml)
      await invokeIpc(IPCChannels.Email.UpdateComposeDraft, {
        messageId: draftId,
        subject,
        bodyText: plain,
        bodyHtml: safeHtml || undefined,
        to,
        cc: cc || undefined,
      })
    } catch (e) {
      logError("compose-dialog: save draft", e)
    }
  }

  const handleCheckOutbound = async () => {
    if (!hasElectron() || draftId == null) return
    setCheckingOutbound(true)
    try {
      await saveDraft()
      const safeHtml = sanitizeComposeHtml(bodyHtml)
      const plain = stripHtmlToText(safeHtml)
      const r = await invokeIpc<{ success: boolean; allowed?: boolean; reason?: string | null }>(
        IPCChannels.Email.ValidateOutbound,
        {
          messageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || undefined,
          to,
          cc: cc || undefined,
          attachmentCount: attachmentPaths.length,
        },
      )
      if (!r.success) {
        toast.error("Ausgangsprüfung fehlgeschlagen")
        return
      }
      if (r.allowed) {
        toast.success("Ausgangsprüfung: OK — Versand erlaubt.")
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
    setSending(true)
    try {
      await saveDraft()
      const safeHtml = sanitizeComposeHtml(bodyHtml)
      const plain = stripHtmlToText(safeHtml)
      const r = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.SendCompose,
        {
          accountId: composeAccountId,
          draftMessageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || null,
          to,
          cc: cc || undefined,
          inReplyToMessageId: replyToId,
          attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        },
      )
      if (!r.success) {
        const blocked = (r.error ?? "").length > 0
        if (blocked) {
          toast.warning(r.error ?? "Versand durch Ausgangsprüfung blockiert")
          closeDialog()
          setMailView("inbox")
          await onSent()
          try {
            const full = await invokeIpc<EmailMessage | null>(
              IPCChannels.Email.GetMessage,
              draftId,
            )
            if (full) setSelectedMessage(full)
          } catch (e) {
            logError("compose-dialog: load blocked draft", e)
          }
        } else {
          toast.error("Versand fehlgeschlagen")
        }
        return
      }
      toast.success("E-Mail gesendet.")
      await onSent()
      closeDialog()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Versand fehlgeschlagen.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-3 p-0">
        <DialogHeader className="border-b px-6 pt-6 pb-3">
          <DialogTitle>
            {composeIntent.mode === "reply"
              ? "Antwort verfassen"
              : composeIntent.mode === "forward"
                ? "Weiterleiten"
                : "Neue Nachricht"}
          </DialogTitle>
          <DialogDescription>
            Textbausteine und KI-Prompts pflegen Sie in den Einstellungen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6">
          <div className="flex flex-wrap gap-2">
            <Select
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
                  setBodyHtml((prev) => `${prev}${frag}`)
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
              onValueChange={async (id) => {
                const pid = parseInt(id, 10)
                try {
                  const src = stripHtmlToText(bodyHtml)
                  const r = await invokeIpc<{
                    success: boolean
                    text?: string
                    error?: string
                  }>(IPCChannels.Email.AiTransformText, {
                    promptId: pid,
                    text: src,
                    customerId: selectedMessage?.customer_id ?? null,
                  })
                  if (r.success && r.text) {
                    setBodyHtml(
                      sanitizeComposeHtml(
                        `<p>${r.text.replace(/\n/g, "<br/>")}</p>`,
                      ),
                    )
                  } else toast.error(r.error ?? "KI-Fehler")
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "KI-Fehler")
                }
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="KI auf Text" />
              </SelectTrigger>
              <SelectContent>
                {aiPrompts.map((p) => (
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
                  const id = parseInt(v, 10)
                  if (!Number.isFinite(id)) return
                  setComposeAccountId(id)
                  setDraftId(null)
                  initialisedDraftKeyRef.current = null
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
            <Label className="justify-self-end text-xs text-muted-foreground">Betreff</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="compose-quill rounded-md border bg-background [&_.ql-container]:min-h-[260px] [&_.ql-container]:rounded-b-md [&_.ql-container]:border-border [&_.ql-container]:bg-background [&_.ql-editor]:min-h-[240px] [&_.ql-editor]:text-foreground [&_.ql-toolbar]:rounded-t-md [&_.ql-toolbar]:border-border [&_.ql-toolbar]:bg-muted">
            <ComposeQuillEditor value={bodyHtml} onChange={setBodyHtml} />
          </div>

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
            onClick={() => void saveDraft().then(() => toast.success("Entwurf gespeichert"))}
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
          <Button type="button" onClick={() => void handleSend()} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Senden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
