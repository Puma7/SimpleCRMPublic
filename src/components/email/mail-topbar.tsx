"use client"

import { Link } from "@tanstack/react-router"
import {
  BarChart3,
  Loader2,
  Mail,
  PenSquare,
  RefreshCw,
  Settings,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  onCompose: () => void
  onSync: () => void
  syncing: boolean
  canSync: boolean
  canCompose: boolean
}

export function MailTopbar({ onCompose, onSync, syncing, canSync, canCompose }: Props) {
  const { setSettingsOpen } = useMailWorkspace()

  return (
    <TooltipProvider delayDuration={150}>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">E-Mail</h1>
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
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Synchronisieren</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" variant="ghost" asChild>
                <Link to="/email/workflows">
                  <Workflow className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Workflows</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" variant="ghost" asChild>
                <Link to="/email/reporting">
                  <BarChart3 className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auswertung</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Einstellungen</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  )
}
