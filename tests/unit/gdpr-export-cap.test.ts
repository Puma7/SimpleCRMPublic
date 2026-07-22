import { exportableAttachmentBytes } from '../../packages/server/src/mail-gdpr-export';

describe('exportableAttachmentBytes (R40-2)', () => {
  it('sums only status==="ok" entries', () => {
    // writeExportArchive appends bytes ONLY for ok entries, so the size cap must count
    // only those — not the declared sizes of entries that never enter the archive.
    const attachments = [
      { status: 'ok' as const, sizeBytes: 100 },
      { status: 'missing' as const, sizeBytes: 5_000_000_000 },
      { status: 'unsafe_path' as const, sizeBytes: 5_000_000_000 },
      { status: 'blocked_suspicious' as const, sizeBytes: 5_000_000_000 },
      { status: 'ok' as const, sizeBytes: 23 },
    ];
    expect(exportableAttachmentBytes(attachments)).toBe(123);
  });

  it('returns 0 for an empty list and for a list with no ok entries', () => {
    expect(exportableAttachmentBytes([])).toBe(0);
    expect(exportableAttachmentBytes([
      { status: 'missing' as const, sizeBytes: 10 },
      { status: 'blocked_suspicious' as const, sizeBytes: 20 },
    ])).toBe(0);
  });
});
