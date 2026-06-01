"use client"

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"

const WIDTH_STORAGE_KEY = "simplecrm-compose-dialog-width-v1"
const HEIGHT_STORAGE_KEY = "simplecrm-compose-dialog-height-v1"
export const COMPOSE_DIALOG_DEFAULT_WIDTH = 1024
const MIN_WIDTH = 520
const MIN_HEIGHT = 420

export function defaultComposeDialogHeight(): number {
  if (typeof window === "undefined") return 720
  return Math.round(window.innerHeight * 0.92)
}

function clampWidth(px: number): number {
  if (typeof window === "undefined") return COMPOSE_DIALOG_DEFAULT_WIDTH
  const max = Math.floor(window.innerWidth * 0.96)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(px)))
}

function clampHeight(px: number): number {
  if (typeof window === "undefined") return defaultComposeDialogHeight()
  const max = Math.floor(window.innerHeight * 0.96)
  return Math.min(max, Math.max(MIN_HEIGHT, Math.round(px)))
}

export function useComposeDialogSize() {
  const [width, setWidth] = useState(COMPOSE_DIALOG_DEFAULT_WIDTH)
  const [height, setHeight] = useState(defaultComposeDialogHeight)

  useEffect(() => {
    try {
      const rawW = localStorage.getItem(WIDTH_STORAGE_KEY)
      if (rawW) {
        const n = parseInt(rawW, 10)
        if (Number.isFinite(n)) setWidth(clampWidth(n))
      }
      const rawH = localStorage.getItem(HEIGHT_STORAGE_KEY)
      if (rawH) {
        const n = parseInt(rawH, 10)
        if (Number.isFinite(n)) setHeight(clampHeight(n))
      }
    } catch {
      /* ignore */
    }
  }, [])

  const persistWidth = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidth(clamped)
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  const persistHeight = useCallback((next: number) => {
    const clamped = clampHeight(next)
    setHeight(clamped)
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  const startWidthResize = useCallback(
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

  const startHeightResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = height
      const onMove = (ev: MouseEvent) => {
        persistHeight(startH + (ev.clientY - startY))
      }
      const onUp = () => {
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [height, persistHeight],
  )

  return { width, height, startWidthResize, startHeightResize }
}
