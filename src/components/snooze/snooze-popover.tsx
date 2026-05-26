"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarClock, CalendarDays, Moon, Sun } from "lucide-react"
import { toast } from "sonner"
import { IPCChannels } from "@shared/ipc/channels"
import {
  computeSnoozeUntil,
  defaultCustomSnoozeLocalValue,
  formatSnoozePresetLabel,
  formatSnoozeWakeLabel,
  minCustomSnoozeLocalValue,
  parseLocalDatetimeInput,
  validateSnoozeUntil,
} from "@shared/snooze-datetime"
import {
  DEFAULT_SNOOZE_SETTINGS,
  type SnoozePresetId,
  type SnoozeSettings,
} from "@shared/snooze-settings"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { hasElectron, invokeIpc } from "@/components/email/types"

export type { SnoozePresetId }

interface SnoozePopoverProps {
  onSnooze: (snoozedUntil: string) => void
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Show „Wieder anzeigen“ (clears snooze with null handled by parent). */
  showUnsnooze?: boolean
  onUnsnooze?: () => void
}

export function SnoozePopover({
  onSnooze,
  children,
  open,
  onOpenChange,
  showUnsnooze,
  onUnsnooze,
}: SnoozePopoverProps) {
  const [settings, setSettings] = useState<SnoozeSettings>(DEFAULT_SNOOZE_SETTINGS)
  const [customMode, setCustomMode] = useState(false)
  const [customLocal, setCustomLocal] = useState(() => defaultCustomSnoozeLocalValue())

  const loadSettings = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const s = await invokeIpc<SnoozeSettings>(IPCChannels.Email.GetSnoozeSettings)
      setSettings(s)
    } catch {
      setSettings(DEFAULT_SNOOZE_SETTINGS)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadSettings()
      setCustomLocal(defaultCustomSnoozeLocalValue())
    } else {
      setCustomMode(false)
    }
  }, [open, loadSettings])

  const applySnooze = (untilIso: string) => {
    const check = validateSnoozeUntil(untilIso)
    if (!check.ok) {
      toast.error(check.message)
      return
    }
    onSnooze(untilIso)
    onOpenChange?.(false)
    setCustomMode(false)
  }

  const handleSnooze = (preset: SnoozePresetId) => {
    applySnooze(computeSnoozeUntil(preset, settings))
  }

  const handleCustomSnooze = () => {
    const iso = parseLocalDatetimeInput(customLocal)
    if (!iso) {
      toast.error("Bitte Datum und Uhrzeit wählen.")
      return
    }
    applySnooze(iso)
  }

  const presets: { id: SnoozePresetId; icon: typeof Moon }[] = [
    { id: "tonight", icon: Moon },
    { id: "tomorrow", icon: Sun },
    { id: "next_week", icon: CalendarDays },
  ]

  const minLocal = minCustomSnoozeLocalValue()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="end">
        {customMode ? (
          <div className="space-y-2 p-2">
            <Label htmlFor="snooze-custom-datetime" className="text-xs">
              Eigenes Datum &amp; Uhrzeit
            </Label>
            <Input
              id="snooze-custom-datetime"
              type="datetime-local"
              className="h-8 text-xs"
              value={customLocal}
              min={minLocal}
              onChange={(e) => setCustomLocal(e.target.value)}
            />
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={handleCustomSnooze}
              >
                Zurückstellen
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setCustomMode(false)}
              >
                Zurück
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {presets.map(({ id, icon: Icon }) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                className="h-8 justify-start text-xs"
                onClick={() => handleSnooze(id)}
              >
                <Icon className="mr-2 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{formatSnoozePresetLabel(id, settings)}</span>
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 justify-start text-xs"
              onClick={() => {
                setCustomLocal(defaultCustomSnoozeLocalValue())
                setCustomMode(true)
              }}
            >
              <CalendarClock className="mr-2 h-3.5 w-3.5 shrink-0" />
              Benutzerdefiniert…
            </Button>
            {showUnsnooze && onUnsnooze ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 justify-start text-xs text-destructive hover:text-destructive"
                onClick={() => {
                  onUnsnooze()
                  onOpenChange?.(false)
                }}
              >
                Wieder anzeigen
              </Button>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
