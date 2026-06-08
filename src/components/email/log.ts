import { notifyError } from '@/lib/notify-error';

/**
 * Shared logging helper for the email module.
 * Surfaces errors to console (→ electron-log in desktop) for grep-friendly audits.
 */
export function logError(context: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[email] ${context}:`, error.message, error);
  } else {
    console.error(`[email] ${context}:`, error);
  }
}

/** Log + Sonner toast for user-visible email failures. */
export function notifyEmailError(context: string, error: unknown, userMessage: string): void {
  logError(context, error);
  notifyError(context, error, userMessage);
}
