"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AuthMfaMethod } from "@shared/auth-login-security"

export function LoginMfaStep(props: {
  method: AuthMfaMethod
  busy: boolean
  error: string | null
  onSubmit: (code: string) => Promise<void>
  onCancel?: () => void
}) {
  const [code, setCode] = useState("")

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Zweiter Faktor</CardTitle>
        <CardDescription>
          {props.method === "email"
            ? "Geben Sie den 6-stelligen Code aus Ihrer E-Mail ein."
            : "Geben Sie den Code aus Ihrer Authenticator-App ein."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void props.onSubmit(code.trim())
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Sicherheitscode</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              disabled={props.busy}
            />
          </div>
          {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
          <Button type="submit" className="w-full" disabled={props.busy || code.length !== 6}>
            {props.busy ? "..." : "Bestaetigen"}
          </Button>
          {props.onCancel ? (
            <Button type="button" variant="ghost" className="w-full" onClick={props.onCancel} disabled={props.busy}>
              Zurueck
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
