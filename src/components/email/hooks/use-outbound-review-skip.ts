"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { useAuth } from "@/components/auth/auth-context"
import { invokeRenderer } from "@/services/transport"
import {
  outboundReviewSkipAllowedForRole,
  parseOutboundReviewSkipPolicy,
} from "../../../../packages/core/src/email/outbound-review-skip"

/**
 * Darf der angemeldete Nutzer „Ohne Ausgangsprüfung senden“ nutzen?
 * Liest die Einstellung (Einstellungen → Automatisierung) über denselben Kanal
 * wie das Automatisierungs-Panel. Nur die Anzeige hängt davon ab — Server und
 * Desktop-Main-Prozess setzen die Einstellung selbst durch.
 */
export function useOutboundReviewSkipAllowed(enabled = true): boolean {
  const { user } = useAuth()
  const role = user?.role ?? null
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setAllowed(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const settings = await invokeRenderer(IPCChannels.Email.GetWorkflowAutomationSettings) as {
          outboundReviewSkipPolicy?: string
        } | null
        if (cancelled) return
        const policy = parseOutboundReviewSkipPolicy(settings?.outboundReviewSkipPolicy)
        setAllowed(outboundReviewSkipAllowedForRole(policy, role))
      } catch {
        if (!cancelled) setAllowed(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, role])

  return allowed
}
