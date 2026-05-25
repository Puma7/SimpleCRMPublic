"use client"

import { useEffect, useState } from "react"
import { hasElectron } from "./types"

/** Re-check after mount so layout gates see preload even if the first paint was early. */
export function useHasElectron(): boolean {
  const [available, setAvailable] = useState(() =>
    typeof window !== "undefined" ? hasElectron() : false,
  )

  useEffect(() => {
    if (!available && hasElectron()) {
      setAvailable(true)
    }
  }, [available])

  return available
}
