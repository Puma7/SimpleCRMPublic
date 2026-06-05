"use client"

import { useEffect, useState } from "react"
import { hasLocalIpc } from "./types"

/** Re-check after mount so local IPC gates see preload even if the first paint was early. */
export function useHasElectron(): boolean {
  const [available, setAvailable] = useState(() =>
    typeof window !== "undefined" ? hasLocalIpc() : false,
  )

  useEffect(() => {
    if (!available && hasLocalIpc()) {
      setAvailable(true)
    }
  }, [available])

  return available
}
