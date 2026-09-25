export async function prepareScheduledSend(
  localDateTime: string,
  persistDraft: () => Promise<boolean>,
  now = Date.now(),
): Promise<string> {
  if (!await persistDraft()) {
    throw new Error('Entwurf konnte nicht gespeichert werden. Versand wurde nicht geplant.')
  }

  const timestamp = new Date(localDateTime).getTime()
  if (!Number.isFinite(timestamp)) {
    throw new Error('Ungültiger Versandzeitpunkt.')
  }
  if (timestamp <= now) {
    throw new Error('Der Versandzeitpunkt muss in der Zukunft liegen.')
  }
  return new Date(timestamp).toISOString()
}

// Der Zeitversand kennt keine PGP-Optionen (keine gespeicherte Absicht, keine
// Passphrase). Mit PGP geplant, ginge die Mail im Klartext raus — deshalb ablehnen.
export const SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE =
  'Geplanter Versand ist mit PGP-Verschlüsselung oder -Signatur nicht möglich. Bitte sofort senden oder PGP abwählen.'

export function scheduledSendPgpBlockReason(flags: {
  pgpEncrypt?: boolean
  pgpSign?: boolean
}): string | null {
  return flags.pgpEncrypt === true || flags.pgpSign === true
    ? SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE
    : null
}
