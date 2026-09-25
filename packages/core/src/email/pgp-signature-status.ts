import { plainTextFromHtml } from './parse-utils';

/**
 * PGP-Signaturstatus einer Nachricht (email_messages.pgp_status), wie ihn die
 * Signaturprüfung schreibt. Desktop und Server-Edition nutzen dieselben Werte.
 */
export type PgpSignatureStatus =
  | 'signed_valid'
  | 'signed_partial'
  | 'signed_invalid'
  | 'signed_unknown_key'
  | 'signed_untrusted_key'
  | 'key_missing';

/**
 * Kryptografisch gültige Signatur eines vertrauten Schlüssels, die aber nur
 * einen Teil der Nachricht abdeckt: Text vor/nach dem signierten Block oder
 * ein abweichender HTML-Teil stammen nicht nachweislich vom Absender. Zählt
 * NICHT als gültig (sonst lässt sich ein alter signierter Block des Partners
 * in eine gefälschte Mail einbetten).
 */
export const PGP_SIGNED_PARTIAL_STATUS = 'signed_partial' satisfies PgpSignatureStatus;

export const PGP_SIGNED_PARTIAL_WARNING = 'Nur ein Teil dieser Nachricht ist signiert.';

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * True, wenn der Klartext-signierte Block (`-----BEGIN PGP SIGNED MESSAGE-----`
 * … `-----END PGP SIGNATURE-----`) den gesamten sichtbaren Inhalt abdeckt.
 * Text- und HTML-Teil müssen jeweils leer sein oder — bis auf Whitespace und
 * Zeilenumbrüche des Mailers — dem signierten Block bzw. dem signierten Text
 * entsprechen. Ein zweiter Block oder beliebiger Text daneben zählt als
 * unsignierter Inhalt.
 */
export function pgpCleartextSignatureCoversMessage(input: {
  bodyText: string | null;
  bodyHtml: string | null;
  armoredBlock: string;
  signedText: string;
}): boolean {
  const signedForms = new Set([
    collapseWhitespace(input.armoredBlock),
    plainTextFromHtml(input.armoredBlock),
    collapseWhitespace(input.signedText),
  ]);
  const covered = (visible: string): boolean => visible === '' || signedForms.has(visible);
  return covered(collapseWhitespace(input.bodyText ?? ''))
    && covered(input.bodyHtml ? plainTextFromHtml(input.bodyHtml) : '');
}
