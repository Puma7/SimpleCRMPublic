export const MAX_INBOUND_RFC822_BYTES = 80 * 1024 * 1024;

export class InboundMessageTooLargeError extends Error {
  readonly code = 'inbound_message_too_large';

  constructor(readonly sizeBytes: number, readonly maxBytes: number) {
    super(`RFC822 message exceeds ${maxBytes} bytes (received ${sizeBytes})`);
    this.name = 'InboundMessageTooLargeError';
  }
}

export function assertInboundRfc822Size(
  sizeBytes: number,
  maxBytes = MAX_INBOUND_RFC822_BYTES,
): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new TypeError('RFC822 message size must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('RFC822 maximum size must be a positive safe integer');
  }
  if (sizeBytes > maxBytes) throw new InboundMessageTooLargeError(sizeBytes, maxBytes);
}

export function assertInboundRfc822Base64Size(
  base64: string,
  maxBytes = MAX_INBOUND_RFC822_BYTES,
): void {
  const normalized = base64.trim();
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
  assertInboundRfc822Size(decodedBytes, maxBytes);
}
