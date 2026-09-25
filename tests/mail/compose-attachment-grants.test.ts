/**
 * Freigaben fuer Compose-Anhaenge (Datei-Picker, Drag-and-drop, gespeicherter
 * Entwurf, Anhangspeicher). Echte Dateien und echte SQLite mit Konto-ACL.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  updateComposeDraft,
} from '../../electron/email/email-store';
import {
  getAttachmentsRootForExport,
  listAttachmentsForMessage,
  persistLocalComposeAttachments,
} from '../../electron/email/email-message-attachments-store';
import {
  composeAttachmentPathsError,
  grantComposeAttachmentPaths,
  revokeComposeAttachmentGrants,
  type ComposeAttachmentCaller,
} from '../../electron/email/compose-attachment-grants';

const agent: ComposeAttachmentCaller = { webContentsId: 7, sessionId: 's1', userId: 'agent-1', role: 'agent' };

describe('compose-attachment-grants', () => {
  let db: Database.Database;
  let tmp: string;
  let accountId: number;
  let draftId: number;

  function file(name: string): string {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, name);
    return p;
  }

  function account(name: string): number {
    return createEmailAccountRecord({
      displayName: name,
      emailAddress: `${name}@firma.test`,
      imapHost: 'imap.firma.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: `${name}@firma.test`,
    }).id;
  }

  const check = (paths: string[] | undefined, caller = agent) => composeAttachmentPathsError(caller, draftId, paths);

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-grants-'));
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES ('agent-1', 'agent', 'Agent', 'agent', 'x', ?)`,
    ).run(new Date().toISOString());
    accountId = account('service');
    db.prepare(
      "INSERT INTO user_account_access (user_id, account_id, access_level) VALUES ('agent-1', ?, 'ro')",
    ).run(accountId);
    draftId = createComposeDraft({ accountId });
    revokeComposeAttachmentGrants(agent.webContentsId);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('ohne Pfade gibt es nichts zu pruefen', () => {
    expect(check(undefined)).toBeNull();
    expect(check([])).toBeNull();
  });

  // C-A30: Ein beliebiger Host-Pfad aus dem Renderer wurde als Anhang akzeptiert.
  test('lehnt nicht freigegebene, relative und fehlende Pfade mit Dateinamen ab', () => {
    const secret = file('geheim.txt');
    expect(check([secret, 'relativ.txt', path.join(tmp, 'fehlt.txt')])).toBe(
      'Anhang nicht freigegeben: geheim.txt, relativ.txt, fehlt.txt. '
        + 'Bitte über „Anhang hinzufügen“ oder per Drag & Drop auswählen.',
    );
  });

  test('gibt nur vorhandene regulaere Dateien frei, je Fenster und Sitzung', () => {
    const picked = file('angebot.pdf');
    const folder = path.join(tmp, 'ordner');
    fs.mkdirSync(folder);

    expect(
      grantComposeAttachmentPaths(agent.webContentsId, agent.sessionId, [picked, folder, 'relativ.pdf', path.join(tmp, 'x')]),
    ).toEqual([picked]);
    expect(check([picked])).toBeNull();
    expect(check([picked], { ...agent, webContentsId: 8 })).not.toBeNull();
    expect(check([picked], { ...agent, sessionId: 's2' })).not.toBeNull();

    // Eine neue Sitzung im selben Fenster beginnt ohne die alten Freigaben.
    const next = file('neu.pdf');
    grantComposeAttachmentPaths(agent.webContentsId, 's2', [next]);
    expect(check([next], { ...agent, sessionId: 's2' })).toBeNull();
    expect(check([picked], { ...agent, sessionId: 's2' })).not.toBeNull();

    revokeComposeAttachmentGrants(agent.webContentsId);
    expect(check([next], { ...agent, sessionId: 's2' })).not.toBeNull();
  });

  test('vergleicht ueber den echten Pfad (Symlink)', () => {
    const target = file('ziel.pdf');
    const link = path.join(tmp, 'verweis.pdf');
    fs.symlinkSync(target, link);

    grantComposeAttachmentPaths(agent.webContentsId, agent.sessionId, [link]);

    expect(check([target])).toBeNull();
    expect(check([link])).toBeNull();
  });

  test('Pfade aus dem gespeicherten Entwurf bleiben erlaubt, auch wenn die Datei fehlt', () => {
    const stored = path.join(tmp, 'alt.pdf');
    updateComposeDraft(draftId, { draftAttachmentPaths: [stored] });

    expect(check([stored, ` ${stored} `])).toBeNull();
  });

  test('Anhangspeicher nur fuer gespeicherte Anhaenge von Nachrichten aus lesbaren Konten', () => {
    const foreignAccountId = account('vertrieb');
    const own = createComposeDraft({ accountId });
    const foreign = createComposeDraft({ accountId: foreignAccountId });
    persistLocalComposeAttachments(own, [{ filename: 'rechnung.pdf', path: file('rechnung.pdf') }]);
    persistLocalComposeAttachments(foreign, [{ filename: 'vertrag.pdf', path: file('vertrag.pdf') }]);
    const ownStored = listAttachmentsForMessage(own)[0]!.storage_path;
    const foreignStored = listAttachmentsForMessage(foreign)[0]!.storage_path;
    const root = getAttachmentsRootForExport();
    const loose = path.join(root, String(own), 'nicht-registriert.txt');
    fs.writeFileSync(loose, 'x');
    const unknownMessage = path.join(root, '999999', 'x.txt');
    fs.mkdirSync(path.dirname(unknownMessage), { recursive: true });
    fs.writeFileSync(unknownMessage, 'x');
    const flat = path.join(root, 'flach.txt');
    fs.writeFileSync(flat, 'x');

    try {
      expect(check([ownStored])).toBeNull();
      expect(check([foreignStored])).toMatch(/vertrag\.pdf/);
      expect(check([loose])).toMatch(/nicht-registriert\.txt/);
      expect(check([unknownMessage])).toMatch(/x\.txt/);
      expect(check([flat])).toMatch(/flach\.txt/);
      expect(check([foreignStored], { ...agent, role: 'admin' })).toBeNull();
    } finally {
      for (const p of [loose, unknownMessage, flat]) fs.rmSync(p, { force: true });
      fs.rmSync(path.dirname(unknownMessage), { recursive: true, force: true });
    }
  });
});
