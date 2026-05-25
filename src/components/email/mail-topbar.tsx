"use client"

import { Loader2, Mail, PenSquare, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Props = {
  onCompose: () => void
  onSync: () => void
  syncing: boolean
  canSync: boolean
  canCompose: boolean
}

export function MailTopbar({ onCompose, onSync, syncing, canSync, canCompose }: Props) {
  return (
    <TooltipProvider delayDuration={150}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">Postfach</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={onCompose}
            disabled={!canCompose}
            className="gap-2"
          >
            <PenSquare className="h-4 w-4" />
            Verfassen
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={onSync}
                disabled={!canSync || syncing}
                aria-label="Synchronisieren"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Konto synchronisieren</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  )
}
