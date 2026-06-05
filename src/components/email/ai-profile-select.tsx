"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"

export const DEFAULT_AI_PROFILE_VALUE = "__default__"

export type AiProfileOption = {
  id: number
  label: string
  isDefault: boolean
}

type Props = {
  value: number | null | undefined
  onChange: (profileId: number | null) => void
  id?: string
  label?: string
  hint?: string
  className?: string
}

export function AiProfileSelect({
  value,
  onChange,
  id = "ai-profile",
  label = "KI-Profil",
  hint = "API-Key und Modell aus dem gewählten Profil (Einstellungen → KI-Profil). Leer = Standard-Profil.",
  className,
}: Props) {
  const [profiles, setProfiles] = useState<AiProfileOption[]>([])

  const loadProfiles = useCallback(async () => {
    try {
      const profiles = await invokeRenderer(IPCChannels.Email.ListAiProfiles) as AiProfileOption[]
      setProfiles(
        profiles.map((p) => ({
          id: p.id,
          label: p.label,
          isDefault: p.isDefault,
        })),
      )
    } catch {
      setProfiles([])
    }
  }, [])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const selectValue =
    value != null && value > 0 ? String(value) : DEFAULT_AI_PROFILE_VALUE

  return (
    <div className={className ?? "space-y-1.5"}>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) => {
          onChange(v === DEFAULT_AI_PROFILE_VALUE ? null : Number(v))
        }}
      >
        <SelectTrigger id={id} className="h-9">
          <SelectValue placeholder="Standard-Profil" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_AI_PROFILE_VALUE}>
            Standard-Profil
          </SelectItem>
          {profiles.map((pr) => (
            <SelectItem key={pr.id} value={String(pr.id)}>
              {pr.label}
              {pr.isDefault ? " · Standard" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function profileIdFromConfig(config: Record<string, unknown>): number | null {
  const v = config.profileId
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
