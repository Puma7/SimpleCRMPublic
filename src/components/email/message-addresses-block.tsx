"use client"

import { analyzeSenderTrust } from "@shared/email-sender-trust"
import { recipientFieldFromJson } from "@shared/email-recipient-parse"
import { correspondentEmailForMessage } from "@shared/email-correspondent"
import { cn } from "@/lib/utils"
import { formatFrom, type EmailMessage } from "./types"

type Props = {
  message: EmailMessage
  onShowCorrespondentHistory?: () => void
}

function RecipientLine({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <p className="text-xs leading-snug">
      <span className="font-medium text-muted-foreground">{label}: </span>
      <span className="break-all">{value}</span>
    </p>
  )
}

function senderPartsFromJson(fromJson: string | null): { name: string; address: string } {
  if (!fromJson?.trim()) return { name: "", address: "" }
  try {
    const parsed = JSON.parse(fromJson) as {
      value?: { name?: string; address?: string }[]
    }
    const v = parsed?.value?.[0]
    return {
      name: (v?.name ?? "").trim(),
      address: (v?.address ?? "").trim(),
    }
  } catch {
    return { name: "", address: "" }
  }
}

export function MessageAddressesBlock({ message, onShowCorrespondentHistory }: Props) {
  const trust = analyzeSenderTrust(message.from_json)
  const fromLabel = formatFrom(message.from_json)
  const sender = senderPartsFromJson(message.from_json)
  const senderDisplayName = sender.name || (!sender.address ? fromLabel : "")
  const senderAddress = sender.address || fromLabel
  const correspondent = correspondentEmailForMessage(message)
  const showCorrespondentLink =
    correspondent &&
    !fromLabel.toLowerCase().includes(correspondent.toLowerCase())

  const to = recipientFieldFromJson(message.to_json)
  const cc = recipientFieldFromJson(message.cc_json)
  const bcc = recipientFieldFromJson(message.bcc_json)

  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="space-y-1.5 text-xs leading-snug">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-muted-foreground">Von:</span>
              {senderDisplayName ? (
                <span
                  className={cn(
                    "font-medium",
                    trust.level === "suspicious" && "text-destructive",
                  )}
                >
                  {senderDisplayName}
                </span>
              ) : null}
              <span
                className={cn(
                  "break-all rounded-md border bg-background px-2 py-0.5 font-mono text-[12px] font-semibold text-foreground shadow-sm ring-1 ring-border/60",
                  trust.level === "suspicious" &&
                    "border-destructive/50 bg-destructive/10 text-destructive ring-destructive/20",
                )}
                title="Tatsächliche Absenderadresse"
              >
                {senderAddress}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Tatsächliche Absenderadresse bewusst hervorgehoben — wichtig zur Betrugserkennung.
            </p>
          </div>
          {trust.level === "suspicious" && trust.reason ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              Verdacht auf verschleierten Absender: {trust.reason}
            </p>
          ) : null}
          <RecipientLine label="An" value={to} />
          <RecipientLine label="Cc" value={cc} />
          <RecipientLine label="Bcc" value={bcc} />
          {showCorrespondentLink && onShowCorrespondentHistory ? (
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={onShowCorrespondentHistory}
            >
              Alle Mails mit {correspondent} anzeigen →
            </button>
          ) : null}
        </div>
        {message.date_received ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            {new Date(message.date_received).toLocaleString("de-DE")}
          </p>
        ) : null}
      </div>
      {message.ticket_code ? (
        <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          Ticket: <span className="font-mono">{message.ticket_code}</span>
        </p>
      ) : null}
    </div>
  )
}
