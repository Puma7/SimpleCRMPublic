"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarDays, Moon, Sun } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  computeSnoozeUntil,
  formatSnoozePresetLabel,
} from "@shared/snooze-datetime"
import {
  DEFAULT_SNOOZE_SETTINGS,
  type SnoozePresetId,
  type SnoozeSettings,
} from "@shared/snooze-settings"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
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
    if (open) void loadSettings()
  }, [open, loadSettings])

  const handleSnooze = (preset: SnoozePresetId) => {
    onSnooze(computeSnoozeUntil(preset, settings))
    onOpenChange?.(false)
  }

  const presets: { id: SnoozePresetId; icon: typeof Moon }[] = [
    { id: "tonight", icon: Moon },
    { id: "tomorrow", icon: Sun },
    { id: "next_week", icon: CalendarDays },
  ]

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <div className="flex flex-col">
          {presets.map(({ id, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              className="justify-start text-xs h-8"
              onClick={() => handleSnooze(id)}
            >
              <Icon className="h-3.5 w-3.5 mr-2 shrink-0" />
              <span className="truncate">{formatSnoozePresetLabel(id, settings)}</span>
            </Button>
          ))}
          {showUnsnooze && onUnsnooze ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs h-8 text-destructive hover:text-destructive"
              onClick={() => {
                onUnsnooze()
                onOpenChange?.(false)
              }}
            >
              Wieder anzeigen
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
