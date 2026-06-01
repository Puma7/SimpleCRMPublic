"use client"

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"

const WIDTH_STORAGE_KEY = "simplecrm-compose-dialog-width-v1"
const HEIGHT_STORAGE_KEY = "simplecrm-compose-dialog-height-vh-v1"
export const COMPOSE_DIALOG_DEFAULT_WIDTH = 1024
export const COMPOSE_DIALOG_DEFAULT_HEIGHT_VH = 92
const MIN_WIDTH = 520
const MIN_HEIGHT_VH = 55
const MAX_HEIGHT_VH = 96

function clampWidth(px: number): number {
  if (typeof window === "undefined") return COMPOSE_DIALOG_DEFAULT_WIDTH
  const max = Math.floor(window.innerWidth * 0.96)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(px)))
}

function clampHeightVh(vh: number): number {
  return Math.min(MAX_HEIGHT_VH, Math.max(MIN_HEIGHT_VH, Math.round(vh)))
}

export function useComposeDialogSize() {
  const [width, setWidth] = useState(COMPOSE_DIALOG_DEFAULT_WIDTH)
  const [heightVh, setHeightVh] = useState(COMPOSE_DIALOG_DEFAULT_HEIGHT_VH)

  useEffect(() => {
    try {
      const rawW = localStorage.getItem(WIDTH_STORAGE_KEY)
      if (rawW) {
        const n = parseInt(rawW, 10)
        if (Number.isFinite(n)) setWidth(clampWidth(n))
      }
      const rawH = localStorage.getItem(HEIGHT_STORAGE_KEY)
      if (rawH) {
        const h = parseFloat(rawH)
        if (Number.isFinite(h)) setHeightVh(clampHeightVh(h))
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

  const persistHeightVh = useCallback((next: number) => {
    const clamped = clampHeightVh(next)
    setHeightVh(clamped)
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(clamped))
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

  const startHeightResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startVh = heightVh
      const onMove = (ev: MouseEvent) => {
        const deltaPx = ev.clientY - startY
        const deltaVh = (deltaPx / window.innerHeight) * 100
        persistHeightVh(startVh + deltaVh)
      }
      const onUp = () => {
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [heightVh, persistHeightVh],
  )

  const dialogHeightCss = `calc(${heightVh}vh - 8vh)`

  return { width, dialogHeightCss, startResize, startHeightResize }
}
