import { toast } from 'sonner';

/**
 * Centralized API error handler.
 * Logs the error and shows a Sonner toast (mounted in app-shell).
 */
export function handleApiError(
  error: unknown,
  context: string,
  userFriendlyBaseMessage = 'Ein unerwarteter Fehler ist aufgetreten.',
): void {
  console.error(`API Error in ${context}:`, error);

  let description = userFriendlyBaseMessage;

  if (error && typeof error === 'object' && 'errorDetails' in error) {
    const details = (error as { errorDetails?: { userMessage?: string; suggestion?: string } }).errorDetails;
    if (details?.userMessage) description = details.userMessage;
    if (details?.suggestion) description += `\n\nLösungsvorschlag: ${details.suggestion}`;
  } else if (error instanceof Error) {
    description = error.message || userFriendlyBaseMessage;
  } else if (typeof error === 'string' && error.length > 0) {
    description = error;
  } else if (error && typeof error === 'object' && 'error' in error && typeof (error as { error: unknown }).error === 'string') {
    description = (error as { error: string }).error;
  }

  toast.error(`Fehler: ${context}`, { description });
}
