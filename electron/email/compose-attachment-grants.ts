/**
 * C-A30 (G12): Welche Host-Dateien ein Renderer als Compose-Anhang nennen darf.
 *
 * Ein Pfad aus dem Renderer ist keine Leseberechtigung. Erlaubt sind:
 * - Dateien, die der Main-Prozess im Datei-Picker oder per Drag-and-drop ueber
 *   den Preload (webUtils.getPathForFile) freigegeben hat, je webContents und
 *   Sitzung; sie verfallen beim Logout,
 * - Pfade, die schon im gespeicherten Entwurf stehen (bestehende Entwuerfe),
 * - Anhaenge aus dem Anhangspeicher von Nachrichten, deren Konto der Aufrufer
 *   lesen darf (Weiterleiten).
 */
import fs from 'fs';
import path from 'path';
import { canAccessLocalAccount } from '../auth/auth-store';
import type { SessionRole } from '../auth/session-store';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
import { getEmailMessageById } from './email-store';
import { getAttachmentsRootForExport, listAttachmentsForMessage } from './email-message-attachments-store';

export type ComposeAttachmentCaller = {
  webContentsId: number;
  sessionId: string;
  userId: string;
  role: SessionRole;
};

const grantsByWebContents = new Map<number, { sessionId: string; paths: Set<string> }>();

function realPathOrNull(p: string): string | null {
  if (!p || !path.isAbsolute(p)) return null;
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function regularFile(p: string): string | null {
  const real = realPathOrNull(p);
  try {
    return real && fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Gibt vorhandene regulaere Dateien frei; liefert die akzeptierten Pfade wie uebergeben. */
export function grantComposeAttachmentPaths(
  webContentsId: number,
  sessionId: string,
  paths: readonly string[],
): string[] {
  let grant = grantsByWebContents.get(webContentsId);
  if (!grant || grant.sessionId !== sessionId) {
    grant = { sessionId, paths: new Set() };
    grantsByWebContents.set(webContentsId, grant);
  }
  const accepted: string[] = [];
  for (const p of paths) {
    const real = regularFile(p);
    if (!real) continue;
    grant.paths.add(real);
    accepted.push(p);
  }
  return accepted;
}

export function revokeComposeAttachmentGrants(webContentsId: number): void {
  grantsByWebContents.delete(webContentsId);
}

function isGranted(caller: ComposeAttachmentCaller, real: string): boolean {
  const grant = grantsByWebContents.get(caller.webContentsId);
  return grant?.sessionId === caller.sessionId && grant.paths.has(real);
}

/** `<Anhangspeicher>/<messageId>/<Datei>` eines gespeicherten Anhangs, dessen Konto der Aufrufer lesen darf. */
function isReadableStoredAttachment(caller: ComposeAttachmentCaller, real: string): boolean {
  const root = realPathOrNull(getAttachmentsRootForExport());
  if (!root) return false;
  const [dir, ...rest] = path.relative(root, real).split(path.sep);
  const messageId = Number(dir);
  if (rest.length !== 1 || !Number.isInteger(messageId) || messageId <= 0) return false;
  const message = getEmailMessageById(messageId);
  if (!message) return false;
  const stored = listAttachmentsForMessage(messageId).some(
    (attachment) => realPathOrNull(attachment.storage_path) === real,
  );
  return stored && canAccessLocalAccount({
    userId: caller.userId,
    accountId: message.account_id,
    access: 'ro',
    role: caller.role,
  });
}

/**
 * Fehlermeldung fuer Anhangpfade, die der Aufrufer nicht verwenden darf, sonst
 * null. `draftMessageId` ist der Entwurf, in dem die Pfade gespeichert oder mit
 * dem sie versendet werden.
 */
export function composeAttachmentPathsError(
  caller: ComposeAttachmentCaller,
  draftMessageId: number,
  paths: readonly string[] | undefined,
): string | null {
  if (!paths?.length) return null;
  const stored = new Set(
    parseDraftAttachmentPathsJson(getEmailMessageById(draftMessageId)?.draft_attachment_paths_json),
  );
  const rejected = paths.filter((p) => {
    if (stored.has(p.trim())) return false;
    const real = regularFile(p);
    return !real || (!isGranted(caller, real) && !isReadableStoredAttachment(caller, real));
  });
  if (rejected.length === 0) return null;
  const names = rejected.map((p) => path.basename(p)).join(', ');
  return `Anhang nicht freigegeben: ${names}. Bitte über „Anhang hinzufügen“ oder per Drag & Drop auswählen.`;
}
