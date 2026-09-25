// Heuristic for "suspicious" attachments, shared by both editions. The desktop
// asks for confirmation before opening such a file (electron/ipc/attachment-open-risk.ts
// uses this function); on the server, downloading one additionally requires the
// mail.attachment.suspicious_download grant. Classification is by file extension
// only — there is no malware-scan verdict yet. Covered are types the OS executes,
// mounts or runs macros from; stored attachments carry no Mark-of-the-Web, so
// SmartScreen and the Office internet-macro block do not help.
export const DANGEROUS_ATTACHMENT_EXTENSIONS: readonly string[] = [
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
];

const DANGEROUS_ATTACHMENT_EXTENSION_SET = new Set(DANGEROUS_ATTACHMENT_EXTENSIONS);

/**
 * True when the filename's extension is one of the risky types above. Windows
 * drops trailing dots and spaces, so "a.lnk. " still opens as a shortcut and is
 * classified without them. Mirrors path.extname semantics: a leading-dot
 * dotfile (e.g. ".exe" as a whole name) has no extension and is not flagged.
 */
export function isPotentiallyDangerousAttachment(filename: string | null | undefined): boolean {
  if (!filename) return false;
  const name = filename.replace(/[. ]+$/, '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return DANGEROUS_ATTACHMENT_EXTENSION_SET.has(name.slice(dot).toLowerCase());
}
