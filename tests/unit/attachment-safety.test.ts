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

  // F-A7-05 (E9): the server list lacked shortcuts, Java, disk images and
  // macro-enabled Office files that the desktop already flagged, so those
  // downloads skipped the mail.attachment.suspicious_download grant.
  test('flags the same shortcut, disk-image, macro and launcher types as the desktop guard', () => {
    for (const name of [
      'Rechnung.lnk', 'x.url', 'x.scf', 'x.cpl', 'x.inf', 'x.reg', 'x.chm', 'x.jar', 'x.jnlp',
      'x.appref-ms', 'x.application', 'x.msix', 'x.appx', 'x.xll', 'x.iso', 'x.img', 'x.vhd', 'x.vhdx',
      'x.docm', 'x.dotm', 'x.xlsm', 'x.xltm', 'x.xlam', 'x.pptm', 'x.ppsm', 'x.command', 'x.desktop',
      'x.AppImage', 'x.run', 'x.pkg', 'x.dmg',
    ]) {
      expect({ name, flagged: isPotentiallyDangerousAttachment(name) }).toEqual({ name, flagged: true });
    }
  });

  test('ignores trailing dots and spaces that Windows drops from file names', () => {
    expect(isPotentiallyDangerousAttachment('Rechnung.lnk.')).toBe(true);
    expect(isPotentiallyDangerousAttachment('Rechnung.exe . ')).toBe(true);
    expect(isPotentiallyDangerousAttachment('bericht.pdf. ')).toBe(false);
    expect(isPotentiallyDangerousAttachment('. . ')).toBe(false);
  });
});
