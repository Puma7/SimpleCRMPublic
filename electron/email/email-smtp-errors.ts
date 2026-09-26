/**
 * SMTP failed after the complete message body was handed to the server
 * (timeout or connection loss while waiting for the final reply). The server
 * may have accepted the message, so an automatic resend risks a duplicate.
 * An explicit 4xx/5xx reply to the message is NOT ambiguous.
 */
export class SmtpDeliveryAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpDeliveryAmbiguousError';
  }
}
