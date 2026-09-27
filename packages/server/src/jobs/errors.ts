/**
 * A job failure that another attempt cannot fix (e.g. a mail server's final
 * 5xx rejection). The legacy worker fails such a job terminally instead of
 * retrying it with backoff; MailAsyncAuthorizationError carries the same flag.
 */
export class NonRetryableJobError extends Error {
  readonly nonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}

export function isNonRetryableJobError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { nonRetryable?: unknown }).nonRetryable === true;
}
