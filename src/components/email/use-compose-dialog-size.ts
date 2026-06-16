"use client"

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"

const WIDTH_STORAGE_KEY = "simplecrm-compose-dialog-width-v2"
const HEIGHT_STORAGE_KEY = "simplecrm-compose-dialog-height-vh-v2"
const LEGACY_WIDTH_STORAGE_KEY = "simplecrm-compose-dialog-width-v1"
const LEGACY_HEIGHT_STORAGE_KEY = "simplecrm-compose-dialog-height-vh-v1"

export const COMPOSE_DIALOG_DEFAULT_WIDTH_VW = 96
/** Visible dialog body height (excluding top offset). */
export const COMPOSE_DIALOG_VISIBLE_HEIGHT_VH = 88
const TOP_OFFSET_VH = 4
/** Stored height vh = visible + top offset so calc(stored - offset) === visible. */
export const COMPOSE_DIALOG_DEFAULT_HEIGHT_VH =
  COMPOSE_DIALOG_VISIBLE_HEIGHT_VH + TOP_OFFSET_VH

const MIN_WIDTH = 520
const MIN_HEIGHT_VH = TOP_OFFSET_VH + 55
const MAX_HEIGHT_VH = TOP_OFFSET_VH + 96

function defaultWidthPx(): number {
  if (typeof window === "undefined") return 1280
  return Math.floor(window.innerWidth * (COMPOSE_DIALOG_DEFAULT_WIDTH_VW / 100))
}

function clampWidth(px: number): number {
  if (typeof window === "undefined") return defaultWidthPx()
  const max = Math.floor(window.innerWidth * 0.96)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(px)))
}

function clampHeightVh(vh: number): number {
  return Math.min(MAX_HEIGHT_VH, Math.max(MIN_HEIGHT_VH, Math.round(vh)))
}

function migrateLegacyHeightVh(legacy: number): number {
  // Legacy stored values used calc(h - 8vh) with top 4vh; map to new visible semantics.
  if (legacy <= 96) return clampHeightVh(legacy + TOP_OFFSET_VH)
  return clampHeightVh(legacy)
}

export function useComposeDialogSize() {
  const [width, setWidth] = useState(defaultWidthPx)
  const [heightVh, setHeightVh] = useState(COMPOSE_DIALOG_DEFAULT_HEIGHT_VH)

  useEffect(() => {
    try {
      let rawW = localStorage.getItem(WIDTH_STORAGE_KEY)
      if (!rawW) {
        const legacyW = localStorage.getItem(LEGACY_WIDTH_STORAGE_KEY)
        if (legacyW) {
          rawW = legacyW
          localStorage.setItem(WIDTH_STORAGE_KEY, legacyW)
          localStorage.removeItem(LEGACY_WIDTH_STORAGE_KEY)
        }
      }
      if (rawW) {
        const n = parseInt(rawW, 10)
        if (Number.isFinite(n)) setWidth(clampWidth(n))
      } else {
        setWidth(clampWidth(defaultWidthPx()))
      }

      let rawH = localStorage.getItem(HEIGHT_STORAGE_KEY)
      if (!rawH) {
        const legacyH = localStorage.getItem(LEGACY_HEIGHT_STORAGE_KEY)
        if (legacyH) {
          const parsed = parseFloat(legacyH)
          if (Number.isFinite(parsed)) {
            const migrated = String(migrateLegacyHeightVh(parsed))
            localStorage.setItem(HEIGHT_STORAGE_KEY, migrated)
            localStorage.removeItem(LEGACY_HEIGHT_STORAGE_KEY)
            rawH = migrated
          }
        }
      }
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

  const dialogHeightCss = `calc(${heightVh}vh - ${TOP_OFFSET_VH}vh)`
  const dialogMaxHeightCss = `calc(${MAX_HEIGHT_VH}vh - ${TOP_OFFSET_VH}vh)`

  return { width, dialogHeightCss, dialogMaxHeightCss, startResize, startHeightResize }
}
