/**
 * Safe attachment file name that keeps the real name readable: Unicode letters
 * (umlauts, CJK, …) stay, only characters that are dangerous in a path, a
 * header or on screen are removed. The result is used as display name, as the
 * on-disk name and for the dangerous-extension check, so it must keep the
 * real extension ('报价.exe' stays '报价.exe', never '.exe').
 */

const MAX_FILENAME_CHARS = 180;
const MAX_EXTENSION_CHARS = 20;

// C0/C1 controls, bidi overrides/isolates/marks and zero-width characters
// (e.g. U+202E turns "rechnung‮fdp.exe" into a visually harmless name).
const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿]/gu;
// Reserved on Windows file systems; '/' and '\' are handled as path separators first.
const WINDOWS_RESERVED_CHARS = /[<>:"|?*]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function truncateKeepingExtension(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= MAX_FILENAME_CHARS) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const extensionChars = Array.from(extension);
  if (extensionChars.length === 0 || extensionChars.length > MAX_EXTENSION_CHARS) {
    return chars.slice(0, MAX_FILENAME_CHARS).join('');
  }
  const stemChars = Array.from(name.slice(0, dot));
  return stemChars.slice(0, MAX_FILENAME_CHARS - extensionChars.length).join('') + extension;
}

export function sanitizeAttachmentFilename(input: string | null | undefined): string {
  const lastSegment = String(input ?? '').split(/[\\/]/).pop() ?? '';
  let name = lastSegment
    .normalize('NFC')
    .replace(INVISIBLE_OR_CONTROL, '')
    .replace(WINDOWS_RESERVED_CHARS, '_')
    // Leading dots would turn "x.exe" leftovers into dotfiles; trailing dots and
    // spaces are dropped by Windows, so "evil.exe." must become "evil.exe".
    .replace(/^[\s.]+/u, '')
    .replace(/[\s.]+$/u, '');
  if (!name) return 'attachment';
  const stem = name.split('.')[0] ?? '';
  if (WINDOWS_RESERVED_NAMES.test(stem)) name = `_${name}`;
  return truncateKeepingExtension(name);
}
