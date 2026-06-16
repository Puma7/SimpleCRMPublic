"use client"

import DOMPurify from "dompurify"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  from: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  bodyHtml: string
  attachmentPaths?: readonly string[]
}

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

export function ComposeOutboundPreviewDialog({
  open,
  onOpenChange,
  from,
  to,
  cc,
  bcc,
  subject,
  bodyHtml,
  attachmentPaths = [],
}: Props) {
  const sanitized = sanitizePreviewHtml(bodyHtml)
  const attachments = attachmentPaths
    .map((p) => p.split(/[/\\]/).pop() ?? p)
    .filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Ausgangs-Vorschau</DialogTitle>
          <DialogDescription>
            So sieht die E-Mail beim Empfänger aus (HTML-Darstellung).
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-6">
          <div className="mx-auto max-w-[640px] rounded-md border bg-white px-6 py-5 text-sm text-neutral-900 shadow-sm dark:bg-white dark:text-neutral-900">
            <dl className="mb-4 space-y-1 border-b border-neutral-200 pb-4 text-xs text-neutral-600">
              <div className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1">
                <dt className="font-medium">Von</dt>
                <dd className="break-all">{from || "—"}</dd>
                <dt className="font-medium">An</dt>
                <dd className="break-all">{to || "—"}</dd>
                {cc?.trim() ? (
                  <>
                    <dt className="font-medium">Cc</dt>
                    <dd className="break-all">{cc}</dd>
                  </>
                ) : null}
                {bcc?.trim() ? (
                  <>
                    <dt className="font-medium">Bcc</dt>
                    <dd className="break-all">{bcc}</dd>
                  </>
                ) : null}
                <dt className="font-medium">Betreff</dt>
                <dd className="break-all font-medium text-neutral-900">{subject || "(Ohne Betreff)"}</dd>
                {attachments.length > 0 ? (
                  <>
                    <dt className="font-medium">Anhänge</dt>
                    <dd className="break-all">{attachments.join(", ")}</dd>
                  </>
                ) : null}
              </div>
            </dl>
            {sanitized ? (
              <div
                className="prose prose-sm max-w-none text-neutral-900 [&_a]:text-blue-700 [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: sanitized }}
              />
            ) : (
              <p className="text-neutral-500 italic">Kein Nachrichtentext.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
