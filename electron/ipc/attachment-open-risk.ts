import path from 'path';

// Opening goes through shell.openPath, so everything the OS would execute, mount
// or run macros from needs the explicit confirmation. Stored attachments carry no
// Mark-of-the-Web, so SmartScreen and the Office internet-macro block do not help.
const DANGEROUS_ATTACHMENT_EXT = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.pif',
  '.msi',
  '.dll',
  '.js',
  '.jse',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.ps1',
  '.msc',
  '.hta',
  '.sh',
  '.app',
  '.deb',
  '.rpm',
  // Windows shortcuts, installers, control panel items and script hosts
  '.lnk',
  '.url',
  '.scf',
  '.cpl',
  '.inf',
  '.reg',
  '.chm',
  '.hlp',
  '.msp',
  '.mst',
  '.msix',
  '.msixbundle',
  '.appx',
  '.appxbundle',
  '.appref-ms',
  '.application',
  '.gadget',
  '.settingcontent-ms',
  '.vb',
  '.ws',
  '.wsc',
  '.sct',
  '.psm1',
  '.psd1',
  '.ps1xml',
  '.jar',
  '.jnlp',
  '.xll',
  // Disk images (mounting bypasses Mark-of-the-Web)
  '.iso',
  '.img',
  '.vhd',
  '.vhdx',
  // Macro-enabled Office documents and add-ins
  '.docm',
  '.dotm',
  '.xlsm',
  '.xltm',
  '.xlam',
  '.pptm',
  '.potm',
  '.ppam',
  '.ppsm',
  '.sldm',
  // macOS / Linux launchers and installers
  '.command',
  '.tool',
  '.terminal',
  '.desktop',
  '.appimage',
  '.run',
  '.pkg',
  '.mpkg',
  '.dmg',
]);

export function isPotentiallyDangerousAttachment(filename: string): boolean {
  // Windows drops trailing dots/spaces, so "a.lnk. " still opens as a shortcut.
  const ext = path.extname(filename.replace(/[. ]+$/, '')).toLowerCase();
  return ext !== '' && DANGEROUS_ATTACHMENT_EXT.has(ext);
}
