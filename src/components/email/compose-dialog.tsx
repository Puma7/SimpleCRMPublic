"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import DOMPurify from "dompurify"
import ReactQuill from "react-quill"
import "react-quill/dist/quill.snow.css"
import { validateRecipientField } from "@shared/email-recipient-parse"
import { Loader2 } from "lucide-react"
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
import {
  applyCannedTemplate,
  firstAddress,
  formatFrom,
  hasElectron,
  invokeIpc,
  stripHtmlToText,
  type AiPrompt,
  type CannedResponse,
  type CustomerOpt,
  type EmailMessage,
} from "./types"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  cannedList: CannedResponse[]
  aiPrompts: AiPrompt[]
  customers: CustomerOpt[]
  onSent: () => void | Promise<void>
}

function sanitizeComposeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function ComposeDialog({ cannedList, aiPrompts, customers, onSent }: Props) {
  const { composeIntent, setComposeIntent, selectedAccountId, selectedMessage } =
    useMailWorkspace()

  const isOpen = composeIntent.mode !== "closed"

  const [draftId, setDraftId] = useState<number | null>(null)
  const [replyToId, setReplyToId] = useState<number | null>(null)
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!isOpen || !hasElectron() || selectedAccountId == null) return
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

        const replyTo: EmailMessage | null =
          composeIntent.mode === "reply" ? composeIntent.message : null
        const toAddr = replyTo ? firstAddress(replyTo.from_json) : ""
        const subj = replyTo?.subject
          ? replyTo.subject.toLowerCase().startsWith("re:")
            ? replyTo.subject
            : `Re: ${replyTo.subject}`
          : ""
        const quoted = replyTo
          ? `\n\n---\nAm ${
              replyTo.date_received
                ? new Date(replyTo.date_received).toLocaleString("de-DE")
                : "?"
            } schrieb ${formatFrom(replyTo.from_json)}:\n${(
              replyTo.body_text ||
              replyTo.snippet ||
              ""
            ).trim()}`
          : ""

        const res = await invokeIpc<{ id?: number }>(IPCChannels.Email.CreateComposeDraft, {
          accountId: selectedAccountId,
          subject: subj,
          bodyText: quoted,
          to: toAddr,
        })
        if (cancelled) return
        if (res.id != null) {
          setDraftId(res.id)
          setReplyToId(replyTo?.id ?? null)
          setTo(toAddr)
          setCc("")
          setSubject(subj)
          setBodyHtml(
            quoted
              ? sanitizeComposeHtml(`<p>${quoted.replace(/\n/g, "<br/>")}</p>`)
              : "",
          )
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Entwurf konnte nicht angelegt werden.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, composeIntent, selectedAccountId])

  const closeDialog = () => {
    setComposeIntent({ mode: "closed" })
    setDraftId(null)
    setReplyToId(null)
    setTo("")
    setCc("")
    setSubject("")
    setBodyHtml("")
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
    } catch {
      /* ignore */
    }
  }

  const handleSend = async () => {
    if (!hasElectron() || draftId == null || selectedAccountId == null) return
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
          accountId: selectedAccountId,
          draftMessageId: draftId,
          subject,
          bodyText: plain,
          bodyHtml: safeHtml || null,
          to,
          cc: cc || undefined,
          inReplyToMessageId: replyToId,
        },
      )
      if (!r.success) {
        toast.error(r.error ?? "Versand fehlgeschlagen")
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
        if (!open) {
          void saveDraft().then(closeDialog)
        }
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-3 p-0">
        <DialogHeader className="border-b px-6 pt-6 pb-3">
          <DialogTitle>
            {composeIntent.mode === "reply" ? "Antwort verfassen" : "Neue Nachricht"}
          </DialogTitle>
          <DialogDescription>
            Textbausteine und KI-Prompts pflegen Sie in den Einstellungen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6">
          <div className="flex flex-wrap gap-2">
            <Select
              onValueChange={(id) => {
                const c = cannedList.find((x) => x.id === parseInt(id, 10))
                if (!c) return
                const block = applyCannedTemplate(
                  c.body,
                  selectedMessage?.customer_id ?? null,
                  customers,
                )
                const frag = sanitizeComposeHtml(
                  `<p>${block.replace(/\n/g, "<br/>")}</p>`,
                )
                setBodyHtml((prev) => `${prev}${frag}`)
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

          <div className="[&_.ql-container]:min-h-[260px] [&_.ql-container]:rounded-b-md [&_.ql-toolbar]:rounded-t-md rounded-md border bg-background">
            <ReactQuill theme="snow" value={bodyHtml} onChange={setBodyHtml} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-muted/30 px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void saveDraft().then(closeDialog)
            }}
          >
            Schließen
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void saveDraft().then(() => toast.success("Entwurf gespeichert"))}
          >
            Entwurf speichern
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
