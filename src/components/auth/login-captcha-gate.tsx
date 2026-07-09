"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ServerLoginConfig } from "@/services/transport/server-auth-client"

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script"
export const CAPTCHA_CHALLENGE_STORAGE_KEY = "simplecrm:captcha-challenge"

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      "error-callback"?: () => void
      theme?: "light" | "dark" | "auto"
    },
  ) => string
  reset: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function LoginCaptchaGate(props: {
  config: ServerLoginConfig
  busy: boolean
  error: string | null
  onVerify: (token: string) => Promise<void>
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [scriptReady, setScriptReady] = useState(false)

  useEffect(() => {
    if (!props.config.captcha.enabled || !props.config.captcha.siteKey) return
    let cancelled = false
    void ensureTurnstileScript().then(() => {
      if (!cancelled) setScriptReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [props.config.captcha.enabled, props.config.captcha.siteKey])

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !props.config.captcha.siteKey || !window.turnstile) return
    containerRef.current.innerHTML = ""
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: props.config.captcha.siteKey,
      theme: "auto",
      callback: (token) => {
        void props.onVerify(token)
      },
      "error-callback": () => {
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current)
      },
    })
    return () => {
      widgetIdRef.current = null
    }
  }, [scriptReady, props.config.captcha.siteKey, props.onVerify])

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Zugang pruefen</CardTitle>
        <CardDescription>
          Bitte bestaetigen Sie, dass Sie kein Bot sind. Danach sehen Sie die Anmeldung.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={containerRef} className="flex min-h-16 justify-center" />
        {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={props.busy}
          onClick={() => {
            if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current)
          }}
        >
          {props.busy ? "..." : "CAPTCHA neu laden"}
        </Button>
      </CardContent>
    </Card>
  )
}

async function ensureTurnstileScript(): Promise<void> {
  if (window.turnstile) return
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
  if (existing) {
    await waitForTurnstile()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.id = TURNSTILE_SCRIPT_ID
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.defer = true
    script.onload = () => {
      void waitForTurnstile().then(resolve).catch(reject)
    }
    script.onerror = () => reject(new Error("Turnstile konnte nicht geladen werden"))
    document.head.appendChild(script)
  })
}

async function waitForTurnstile(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (window.turnstile) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Turnstile ist nicht verfuegbar")
}

export function readCaptchaChallenge(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.sessionStorage.getItem(CAPTCHA_CHALLENGE_STORAGE_KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

export function storeCaptchaChallenge(challenge: string): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(CAPTCHA_CHALLENGE_STORAGE_KEY, challenge)
  } catch {
    // ignore
  }
}
