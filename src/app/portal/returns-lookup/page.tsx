"use client"

import { useCallback, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function PortalReturnsLookupPage() {
  const { token } = useParams({ from: "/portal/$token/returns/lookup" })
  const navigate = useNavigate()
  const [returnNumber, setReturnNumber] = useState("")

  const submit = useCallback(() => {
    const trimmed = returnNumber.trim()
    if (!trimmed) return
    void navigate({
      to: "/portal/$token/returns/$returnNumber",
      params: { token, returnNumber: trimmed },
    })
  }, [navigate, token, returnNumber])

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Retouren-Status nachsehen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Geben Sie Ihre Retouren-Nr. ein (z. B. R-AAAA0001), um den aktuellen Status zu sehen.
          </p>
          <div>
            <Label htmlFor="portal-lookup-rn">Retouren-Nr.</Label>
            <Input
              id="portal-lookup-rn"
              autoFocus
              value={returnNumber}
              onChange={(e) => setReturnNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
              }}
              placeholder="R-XXXXXXXX"
            />
          </div>
          <Button onClick={submit} disabled={!returnNumber.trim()}>
            Status anzeigen
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
