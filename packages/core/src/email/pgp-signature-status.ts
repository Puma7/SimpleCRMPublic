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

const PGP_SIGNED_MESSAGE_BEGIN = '-----BEGIN PGP SIGNED MESSAGE-----';
const PGP_SIGNATURE_END = '-----END PGP SIGNATURE-----';

/**
 * Schneidet den ersten Klartext-signierten Block (`-----BEGIN PGP SIGNED
 * MESSAGE-----` … `-----END PGP SIGNATURE-----`) exakt aus dem ersten Body aus,
 * der einen enthält. Text davor/danach gehört nicht zum Block; ob er die
 * Anzeige verändert, prüft {@link pgpCleartextSignatureCoversMessage}.
 */
export function extractArmoredPgpSignedMessage(...bodies: Array<string | null>): string | null {
  for (const body of bodies) {
    if (!body) continue;
    const begin = body.indexOf(PGP_SIGNED_MESSAGE_BEGIN);
    if (begin < 0) continue;
    const end = body.indexOf(PGP_SIGNATURE_END, begin);
    return end < 0
      ? body.slice(begin).trim()
      : body.slice(begin, end + PGP_SIGNATURE_END.length).trim();
  }
  return null;
}

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
