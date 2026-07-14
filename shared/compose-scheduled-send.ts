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
