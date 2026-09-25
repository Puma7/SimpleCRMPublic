import { isPotentiallyDangerousAttachment } from '../../electron/ipc/attachment-open-risk';

describe('desktop attachment open guard', () => {
  test('keeps flagging the classic executable/script types', () => {
    for (const name of ['invoice.exe', 'Invoice.EXE', 'run.ps1', 'setup.msi', 'x.hta', 'x.sh']) {
      expect(isPotentiallyDangerousAttachment(name)).toBe(true);
    }
  });

  // F-A7-05: Verknuepfungen, Java, Control-Panel, Disk-Images und Makro-Office oeffneten ohne Rueckfrage per shell.openPath.
  test('flags shortcuts, disk images, macro documents and unix launchers that the OS executes', () => {
    for (const name of [
      'Rechnung.lnk',
      'x.url',
      'x.scf',
      'x.jar',
      'x.jnlp',
      'x.cpl',
      'x.inf',
      'x.reg',
      'x.chm',
      'x.appref-ms',
      'x.application',
      'x.msix',
      'x.appx',
      'x.xll',
      'x.iso',
      'x.img',
      'x.vhd',
      'x.vhdx',
      'x.docm',
      'x.dotm',
      'x.xlsm',
      'x.xltm',
      'x.xlam',
      'x.pptm',
      'x.ppsm',
      'x.command',
      'x.desktop',
      'x.AppImage',
      'x.run',
      'x.pkg',
      'x.dmg',
    ]) {
      expect({ name, flagged: isPotentiallyDangerousAttachment(name) }).toEqual({ name, flagged: true });
    }
  });

  test('ignores trailing dots and spaces that Windows drops from file names', () => {
    expect(isPotentiallyDangerousAttachment('Rechnung.lnk.')).toBe(true);
    expect(isPotentiallyDangerousAttachment('Rechnung.exe . ')).toBe(true);
  });

  test('does not flag ordinary document/image types', () => {
    for (const name of ['report.pdf', 'photo.PNG', 'sheet.xlsx', 'letter.docx', 'notes.txt', 'archive.zip', 'README', '.exe']) {
      expect(isPotentiallyDangerousAttachment(name)).toBe(false);
    }
  });
});
