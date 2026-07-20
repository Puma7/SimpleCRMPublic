import {
  DANGEROUS_ATTACHMENT_EXTENSIONS,
  isPotentiallyDangerousAttachment,
} from '@simplecrm/core';

describe('isPotentiallyDangerousAttachment', () => {
  test('flags executable/script extensions case-insensitively', () => {
    expect(isPotentiallyDangerousAttachment('invoice.exe')).toBe(true);
    expect(isPotentiallyDangerousAttachment('Invoice.EXE')).toBe(true);
    expect(isPotentiallyDangerousAttachment('run.ps1')).toBe(true);
    expect(isPotentiallyDangerousAttachment('archive.tar.js')).toBe(true);
  });

  test('does not flag ordinary document/image types', () => {
    for (const name of ['report.pdf', 'photo.PNG', 'sheet.xlsx', 'notes.txt', 'archive.tar.gz']) {
      expect(isPotentiallyDangerousAttachment(name)).toBe(false);
    }
  });

  test('handles missing extension, dotfiles, and empty input', () => {
    expect(isPotentiallyDangerousAttachment('README')).toBe(false);
    expect(isPotentiallyDangerousAttachment('.exe')).toBe(false); // leading-dot dotfile has no extension
    expect(isPotentiallyDangerousAttachment('')).toBe(false);
    expect(isPotentiallyDangerousAttachment(null)).toBe(false);
    expect(isPotentiallyDangerousAttachment(undefined)).toBe(false);
  });

  test('every listed extension is normalized (leading dot, lowercase) and flagged', () => {
    for (const ext of DANGEROUS_ATTACHMENT_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith('.')).toBe(true);
      expect(isPotentiallyDangerousAttachment(`file${ext}`)).toBe(true);
    }
  });
});
