const RELOAD_MARK_KEY = 'simplecrm:stale-asset-reload-at'
const RELOAD_COOLDOWN_MS = 30_000

const DYNAMIC_IMPORT_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

export function isDynamicImportLoadError(value: unknown): boolean {
  if (!value) return false
  if (typeof value === 'string') return DYNAMIC_IMPORT_ERROR_PATTERN.test(value)
  if (value instanceof Error) return DYNAMIC_IMPORT_ERROR_PATTERN.test(value.message)
  if (typeof value === 'object' && 'message' in value) {
    return DYNAMIC_IMPORT_ERROR_PATTERN.test(String((value as { message?: unknown }).message ?? ''))
  }
  return false
}

export function shouldReloadForStaleAsset(
  now: number,
  lastReloadValue: string | null,
  cooldownMs = RELOAD_COOLDOWN_MS,
): boolean {
  const lastReloadAt = Number(lastReloadValue)
  return !Number.isFinite(lastReloadAt) || now - lastReloadAt > cooldownMs
}

function reloadOnceForStaleAsset() {
  const now = Date.now()
  const lastReloadValue = window.sessionStorage.getItem(RELOAD_MARK_KEY)
  if (!shouldReloadForStaleAsset(now, lastReloadValue)) {
    return false
  }

  window.sessionStorage.setItem(RELOAD_MARK_KEY, String(now))
  window.location.reload()
  return true
}

export function installStaleAssetReloadHandler() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnceForStaleAsset()
  })

  window.addEventListener('error', (event) => {
    if (!isDynamicImportLoadError(event.message) && !isDynamicImportLoadError(event.error)) {
      return
    }
    reloadOnceForStaleAsset()
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!isDynamicImportLoadError(event.reason)) {
      return
    }
    event.preventDefault()
    reloadOnceForStaleAsset()
  })
}
