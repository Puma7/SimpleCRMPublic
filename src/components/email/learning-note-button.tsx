"use client"

import { useState } from "react"
import { Lightbulb, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { IPCChannels } from "@shared/ipc/channels"
import { LEARNING_NOTE_MAX_LENGTH } from "@shared/ai-learnings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { invokeRenderer } from "@/services/transport"

type Props = {
  /** Mail in der Leseansicht; null = Notiz ohne Bezug. */
  messageId: number | null
}

/**
 * TA-P5 „Learning notieren“: freie Notiz für die Learnings-Auswertung, optional
 * mit Bezug auf die geöffnete Mail. Wird auch bei ausgeschaltetem Sammeln
 * gespeichert; personenbezogene Daten ersetzt der Datenschutzfilter.
 */
export function LearningNoteButton({ messageId }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [withMessage, setWithMessage] = useState(true)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.AddLearningNote, {
        text: trimmed,
        ...(withMessage && messageId ? { messageId } : {}),
      }) as { success: boolean; error?: string }
      if (!result.success) {
        toast.error(result.error ?? "Learning konnte nicht gespeichert werden.")
        return
      }
      toast.success("Learning gespeichert. Es fließt in die nächste Auswertung ein.")
      setText("")
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Learning konnte nicht gespeichert werden.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5 bg-yellow-500/12 text-yellow-900 hover:bg-yellow-500/20 dark:text-yellow-100"
        onClick={() => setOpen(true)}
        title="Learning notieren"
      >
        <Lightbulb className="h-4 w-4" />
        <span className="hidden lg:inline">Learning notieren</span>
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Learning notieren</DialogTitle>
            <DialogDescription>
              Was sollte die KI künftig wissen oder anders machen? Die Notiz fließt in die nächste
              Auswertung unter Einstellungen → Learnings ein. Namen, Kontaktdaten und Nummern werden
              automatisch entfernt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="learning-note-text">Notiz</Label>
              <Textarea
                id="learning-note-text"
                value={text}
                maxLength={LEARNING_NOTE_MAX_LENGTH}
                rows={5}
                placeholder="z. B. Rücksendungen sind 30 Tage kostenlos; das Etikett liegt im Kundenkonto."
                onChange={(event) => setText(event.target.value)}
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {text.length} / {LEARNING_NOTE_MAX_LENGTH}
              </p>
            </div>
            {messageId ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="learning-note-with-message"
                  checked={withMessage}
                  onCheckedChange={(checked) => setWithMessage(checked === true)}
                />
                <Label htmlFor="learning-note-with-message" className="text-sm font-normal">
                  Bezug auf diese E-Mail (Betreff und Text werden bereinigt mitgespeichert)
                </Label>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="button" className="gap-2" disabled={saving || !text.trim()} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
