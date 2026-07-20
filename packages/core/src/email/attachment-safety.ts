// Interim heuristic for "suspicious" attachments, mirrored from the desktop
// attachment guard (electron/ipc/email.ts). Classification is by file extension
// only — there is no malware-scan verdict yet. On the server, downloading a
// flagged attachment additionally requires the mail.attachment.suspicious_download
// grant. Keep this list in sync with shared/attachment-safety.ts (a drift test
// enforces it) and with the desktop copy.
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
];

const DANGEROUS_ATTACHMENT_EXTENSION_SET = new Set(DANGEROUS_ATTACHMENT_EXTENSIONS);

/**
 * True when the filename's extension is one of the executable/script types the
 * desktop guard treats as risky. Mirrors path.extname semantics: a leading-dot
 * dotfile (e.g. ".exe" as a whole name) has no extension and is not flagged.
 */
export function isPotentiallyDangerousAttachment(filename: string | null | undefined): boolean {
  if (!filename) return false;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return false;
  return DANGEROUS_ATTACHMENT_EXTENSION_SET.has(filename.slice(dot).toLowerCase());
}
