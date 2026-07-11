/**
 * Erkennung automatisch erzeugter eingehender Mails (RFC 3834 & Co.) —
 * die Implementierung lebt in packages/core, damit Desktop UND
 * Server-Edition (packages/server) dieselben Guards nutzen. Dieser
 * Modulpfad bleibt für alle electron-Importe erhalten.
 */
export {
  isAutomatedInboundMessage,
  isUnsafeAutoReplyTarget,
} from '../../packages/core/src/email/automation-headers';
