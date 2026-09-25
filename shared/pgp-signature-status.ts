/**
 * Renderer-Zugriff auf die PGP-Signaturstatus aus @simplecrm/core
 * (packages/core/src/email/pgp-signature-status.ts), damit Viewer und
 * Signaturprüfung dieselben Werte verwenden.
 */
export {
  PGP_SIGNED_PARTIAL_STATUS,
  PGP_SIGNED_PARTIAL_WARNING,
  type PgpSignatureStatus,
} from '../packages/core/src/email/pgp-signature-status';
