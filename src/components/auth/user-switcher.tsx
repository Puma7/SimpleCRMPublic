"use client"

import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "./auth-context"
import { useNavigate } from "@tanstack/react-router"

export function UserSwitcher() {
  const { user, logout, authRequired } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="max-w-[120px] truncate" title={user.displayName}>
        {user.displayName}
      </span>
      {authRequired ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Abmelden"
          onClick={async () => {
            await logout()
            navigate({ to: "/login" })
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
