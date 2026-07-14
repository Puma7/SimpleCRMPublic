import { prepareScheduledSend } from '../../shared/compose-scheduled-send'

describe('prepareScheduledSend', () => {
  const now = new Date('2026-07-14T10:00:00.000Z').getTime()

  it('stops scheduling when the draft could not be persisted', async () => {
    await expect(prepareScheduledSend(
      '2026-07-14T13:00',
      async () => false,
      now,
    )).rejects.toThrow('Entwurf konnte nicht gespeichert werden')
  })

  it('rejects invalid or elapsed send times after persisting', async () => {
    await expect(prepareScheduledSend('not-a-date', async () => true, now))
      .rejects.toThrow('Ungültiger Versandzeitpunkt')
    await expect(prepareScheduledSend('2026-07-14T09:00:00.000Z', async () => true, now))
      .rejects.toThrow('muss in der Zukunft liegen')
  })

  it('returns a normalized ISO timestamp for a persisted future schedule', async () => {
    await expect(prepareScheduledSend(
      '2026-07-14T13:00:00.000Z',
      async () => true,
      now,
    )).resolves.toBe('2026-07-14T13:00:00.000Z')
  })
})
