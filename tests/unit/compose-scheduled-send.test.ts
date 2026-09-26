import { IPCChannels } from '../../shared/ipc/channels'
import { getPayloadSchema } from '../../shared/ipc/schemas'
import {
  prepareScheduledSend,
  SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE,
  scheduledSendPgpBlockReason,
} from '../../shared/compose-scheduled-send'

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

// F-A5-03: "Später senden" mit PGP verschickte die Mail im Klartext, weil der Zeitversand PGP ignoriert.
describe('scheduled send with PGP', () => {
  it('names PGP encrypt or sign as a reason to block scheduling', () => {
    expect(scheduledSendPgpBlockReason({ pgpEncrypt: true })).toBe(SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE)
    expect(scheduledSendPgpBlockReason({ pgpSign: true })).toBe(SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE)
    expect(scheduledSendPgpBlockReason({ pgpEncrypt: false, pgpSign: false })).toBeNull()
    expect(scheduledSendPgpBlockReason({})).toBeNull()
    expect(SCHEDULED_SEND_PGP_UNSUPPORTED_MESSAGE).toContain('PGP')
  })

  it('keeps the PGP flags in the desktop IPC payload so the handler can reject them', () => {
    const parsed = getPayloadSchema(IPCChannels.Email.ScheduleDraftSend).parse({
      messageId: 44,
      sendAt: '2026-07-14T13:00:00.000Z',
      pgpEncrypt: true,
      pgpSign: false,
    })
    expect(parsed).toEqual({
      messageId: 44,
      sendAt: '2026-07-14T13:00:00.000Z',
      pgpEncrypt: true,
      pgpSign: false,
    })
  })
})
