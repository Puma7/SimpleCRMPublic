import { toast } from 'sonner';

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'error' in error && typeof (error as { error: unknown }).error === 'string') {
    return (error as { error: string }).error;
  }
  return 'Ein unerwarteter Fehler ist aufgetreten.';
}

/** Log to console (→ electron-log in desktop) and show a Sonner toast. */
export function notifyError(context: string, error: unknown, userMessage?: string): void {
  console.error(`[ui] ${context}:`, error);
  toast.error(userMessage ?? formatError(error));
}

/** Log only — for background refresh where a toast would be noisy. */
export function logUiError(context: string, error: unknown): void {
  console.error(`[ui] ${context}:`, error);
}

export function notifySuccess(message: string): void {
  toast.success(message);
}
