"use client"

import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { invokeRenderer } from "@/services/transport"

type Props = {
  accountId: number
  emailAddress?: string
}

/** OAuth-Token für ein einzelnes Postfach verknüpfen (App-Daten global unter OAuth-Apps). */
export function OAuthAccountLinkPanel({ accountId, emailAddress }: Props) {
  const [googleRedirect, setGoogleRedirect] = useState("http://127.0.0.1:1")
  const [googleCode, setGoogleCode] = useState("")
  const [msRedirect, setMsRedirect] = useState("http://127.0.0.1:1")
  const [msCode, setMsCode] = useState("")

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">OAuth für dieses Postfach</h3>
        <p className="text-sm text-muted-foreground">
          {emailAddress ? (
            <>
              Token für <strong>{emailAddress}</strong> speichern. Client-ID und Secret zuerst unter{" "}
              <Link
                to="/email/settings"
                search={{ tab: "oauthApps" }}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                OAuth-Apps
              </Link>{" "}
              eintragen.
            </>
          ) : (
            <>
              Autorisierungscode einlösen. App-Daten unter Einstellungen → OAuth-Apps hinterlegen.
            </>
          )}
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <p>
          OAuth ergänzt Anmeldung und Versand (SMTP/XOAUTH2). Der Posteingang bleibt über IMAP oder
          POP3 angebunden — ein reines OAuth-Konto ohne Posteingang wird nicht unterstützt.
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Google (Gmail)</h4>
        <div className="space-y-1.5">
          <Label>Redirect-URI</Label>
          <Input value={googleRedirect} onChange={(e) => setGoogleRedirect(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.BuildGoogleOAuthUrl,
              googleRedirect.trim(),
            ) as { success: boolean; url?: string; error?: string }
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Autorisierungs-URL kopiert — im Browser öffnen und Code hier einfügen")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Auth-URL kopieren
        </Button>
        <div className="space-y-1.5">
          <Label>Autorisierungscode</Label>
          <Input
            value={googleCode}
            onChange={(e) => setGoogleCode(e.target.value)}
            placeholder="4/…"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.FinishGoogleOAuth,
              {
                accountId,
                redirectUri: googleRedirect.trim(),
                code: googleCode.trim(),
              },
            ) as { success: boolean; error?: string }
            if (r.success) {
              toast.success("Google-Token für dieses Postfach gespeichert")
              setGoogleCode("")
            } else toast.error(r.error ?? "Fehler")
          }}
        >
          Google OAuth abschließen
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Microsoft 365 / Outlook</h4>
        <div className="space-y-1.5">
          <Label>Redirect-URI</Label>
          <Input value={msRedirect} onChange={(e) => setMsRedirect(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.BuildMicrosoftOAuthUrl,
              msRedirect.trim(),
            ) as { success: boolean; url?: string; error?: string }
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Microsoft-Auth-URL kopiert")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Auth-URL kopieren
        </Button>
        <div className="space-y-1.5">
          <Label>Autorisierungscode</Label>
          <Input value={msCode} onChange={(e) => setMsCode(e.target.value)} />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.FinishMicrosoftOAuth,
              {
                accountId,
                redirectUri: msRedirect.trim(),
                code: msCode.trim(),
              },
            ) as { success: boolean; error?: string }
            if (r.success) {
              toast.success("Microsoft-Token für dieses Postfach gespeichert")
              setMsCode("")
            } else toast.error(r.error ?? "Fehler")
          }}
        >
          Microsoft OAuth abschließen
        </Button>
      </div>
    </div>
  )
}
