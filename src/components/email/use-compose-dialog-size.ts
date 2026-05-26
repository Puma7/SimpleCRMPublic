"use client"

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"

const STORAGE_KEY = "simplecrm-compose-dialog-width-v1"
export const COMPOSE_DIALOG_DEFAULT_WIDTH = 1024
const MIN_WIDTH = 520

function clampWidth(px: number): number {
  if (typeof window === "undefined") return COMPOSE_DIALOG_DEFAULT_WIDTH
  const max = Math.floor(window.innerWidth * 0.96)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(px)))
}

export function useComposeDialogSize() {
  const [width, setWidth] = useState(COMPOSE_DIALOG_DEFAULT_WIDTH)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const n = parseInt(raw, 10)
        if (Number.isFinite(n)) setWidth(clampWidth(n))
      }
    } catch {
      /* ignore */
    }
  }, [])

  const persistWidth = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidth(clamped)
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      const onMove = (ev: MouseEvent) => {
        persistWidth(startW + (ev.clientX - startX))
      }
      const onUp = () => {
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [width, persistWidth],
  )

  return { width, startResize }
}
