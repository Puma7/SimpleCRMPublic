/**
 * Shared logging helper for the email module.
 *
 * The original page.tsx used to console.error-log failures in a handful of
 * places and silently swallow the rest. When we split the monolith into
 * hooks + panels, the silent catches ended up scattered across a dozen
 * files. This helper gives us one canonical place to surface errors so
 * that `grep logError src/components/email` lists every known failure
 * path — and makes it easy to later pipe them into a real logger.
 */
export function logError(context: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[email] ${context}:`, error.message, error)
  } else {
    console.error(`[email] ${context}:`, error)
  }
}
