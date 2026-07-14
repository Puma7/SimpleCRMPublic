jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(),
    relaunch: jest.fn(),
    exit: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
  },
}));

jest.mock('yauzl', () => ({
  __esModule: true,
  default: {
    open: jest.fn(),
  },
}));

jest.mock('better-sqlite3', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../electron/email/email-local-backup', () => ({
  inspectZipBackup: jest.fn(),
}));

jest.mock('../../electron/email/email-local-backup-export', () => ({
  exportLocalMailBackupToPath: jest.fn(),
  MAX_BACKUP_ATTACH_BYTES: 8 * 1024 * 1024 * 1024,
}));

jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentsRootForExport: jest.fn(),
}));

jest.mock('../../electron/email/email-imap-services', () => ({
  isEmailBackgroundSyncBusy: jest.fn(),
  startEmailBackgroundServices: jest.fn(),
  stopEmailBackgroundServices: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  closeDatabase: jest.fn(),
  reopenDatabaseConnection: jest.fn(),
}));

import { EventEmitter } from 'events';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yauzl from 'yauzl';
import Database from 'better-sqlite3';
import { app, dialog } from 'electron';
import { inspectZipBackup } from '../../electron/email/email-local-backup';
import { exportLocalMailBackupToPath } from '../../electron/email/email-local-backup-export';
import { getAttachmentsRootForExport } from '../../electron/email/email-message-attachments-store';
import {
  isEmailBackgroundSyncBusy,
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
} from '../../electron/email/email-imap-services';
import { closeDatabase, reopenDatabaseConnection } from '../../electron/sqlite-service';
import {
  createRestoreZipEntryLimitStream,
  pickLocalMailBackupZip,
  previewRestoreLocalMailBackup,
  RESTORE_CONFIRM_PHRASE,
  restoreLocalMailBackup,
} from '../../electron/email/email-local-restore';

const appGetPathMock = app.getPath as jest.MockedFunction<typeof app.getPath>;
const relaunchMock = app.relaunch as jest.MockedFunction<typeof app.relaunch>;
const exitMock = app.exit as jest.MockedFunction<typeof app.exit>;
const dialogMock = dialog.showOpenDialog as jest.MockedFunction<typeof dialog.showOpenDialog>;
const openZipMock = yauzl.open as jest.MockedFunction<typeof yauzl.open>;
const databaseMock = Database as unknown as jest.Mock;
const inspectMock = inspectZipBackup as jest.MockedFunction<typeof inspectZipBackup>;
const exportMock = exportLocalMailBackupToPath as jest.MockedFunction<
  typeof exportLocalMailBackupToPath
>;
const attachmentsRootMock = getAttachmentsRootForExport as jest.MockedFunction<
  typeof getAttachmentsRootForExport
>;
const busyMock = isEmailBackgroundSyncBusy as jest.MockedFunction<
  typeof isEmailBackgroundSyncBusy
>;
const startServicesMock = startEmailBackgroundServices as jest.MockedFunction<
  typeof startEmailBackgroundServices
>;
const stopServicesMock = stopEmailBackgroundServices as jest.MockedFunction<
  typeof stopEmailBackgroundServices
>;
const closeDatabaseMock = closeDatabase as jest.MockedFunction<typeof closeDatabase>;
const reopenDatabaseMock = reopenDatabaseConnection as jest.MockedFunction<
  typeof reopenDatabaseConnection
>;

type FakeEntry = {
  fileName: string;
  data?: Buffer | string;
  uncompressedSize?: number;
};

class FakeZip extends EventEmitter {
  private index = 0;
  readonly close = jest.fn();

  constructor(private readonly entries: FakeEntry[]) {
    super();
  }

  readEntry(): void {
    queueMicrotask(() => {
      const raw = this.entries[this.index++];
      if (!raw) {
        this.emit('end');
        return;
      }
      const data = Buffer.isBuffer(raw.data) ? raw.data : Buffer.from(raw.data ?? '');
      this.emit('entry', {
        fileName: raw.fileName,
        uncompressedSize: raw.uncompressedSize ?? data.length,
        __data: data,
      });
    });
  }

  openReadStream(entry: { __data: Buffer }, callback: (error: Error | null, stream?: Readable) => void): void {
    callback(null, Readable.from([entry.__data]));
  }
}

function configureZip(entries: FakeEntry[]): void {
  openZipMock.mockImplementation(((_filePath, _options, callback) => {
    callback(null, new FakeZip(entries) as never);
  }) as never);
}

async function collectStream(stream: NodeJS.ReadWriteStream, chunks: Buffer[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.end(Buffer.from('payload'));
  });
}

describe('local restore ZIP runtime guards', () => {
  test('passes data through and accounts for undeclared bytes', async () => {
    const state = { entries: 1, totalBytes: 10 };
    const chunks: Buffer[] = [];
    const stream = createRestoreZipEntryLimitStream('database.sqlite', 2, state);

    await collectStream(stream, chunks);

    expect(Buffer.concat(chunks).toString('utf8')).toBe('payload');
    expect(state.totalBytes).toBe(15);
  });

  test('rejects actual bytes that exceed the total declared archive limit', async () => {
    const gib = 1024 * 1024 * 1024;
    const state = { entries: 1, totalBytes: 9 * gib };
    const stream = createRestoreZipEntryLimitStream('database.sqlite', 0, state);

    await expect(collectStream(stream, [])).rejects.toThrow(/entpackt zu groß/i);
  });
});

describe('local restore preview and file picker', () => {
  let root: string;
  let zipPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'simplecrm-restore-runtime-'));
    zipPath = path.join(root, 'backup.zip');
    fs.writeFileSync(zipPath, 'virtual zip marker');
    appGetPathMock.mockImplementation(((name: string) =>
      name === 'userData' ? path.join(root, 'user-data') : path.join(root, 'temp')) as never);
    fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
    fs.mkdirSync(path.join(root, 'user-data'), { recursive: true });
    attachmentsRootMock.mockReturnValue(path.join(root, 'attachments'));
    inspectMock.mockResolvedValue({
      ok: true,
      manifest: {
        type: 'simplecrm-mail-local-backup',
        exportedAt: '2026-07-14T08:00:00.000Z',
        schemaGeneration: 999,
        schemaGenerationLabel: 'future',
      },
      hasDatabase: true,
      hasAttachments: true,
    });
    busyMock.mockReturnValue(false);
    exportMock.mockResolvedValue({ ok: true, path: path.join(root, 'pre.zip') });
    startServicesMock.mockResolvedValue(undefined);
    databaseMock.mockImplementation(() => ({
      prepare: jest.fn(() => ({
        all: jest.fn(() => [
          { email_address: 'one@example.com' },
          { email_address: '' },
          { email_address: 'two@example.com' },
        ]),
      })),
      close: jest.fn(),
    }));
    configureZip([
      { fileName: 'database.sqlite', data: 'new-database' },
      { fileName: 'email-attachments/' },
      { fileName: 'email-attachments/a.txt', data: 'attachment' },
    ]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('returns cancellation and the selected ZIP path', async () => {
    dialogMock.mockResolvedValueOnce({ canceled: true, filePaths: [] } as never);
    await expect(pickLocalMailBackupZip()).resolves.toEqual({ ok: false, error: 'Abgebrochen' });

    dialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [zipPath] } as never);
    await expect(pickLocalMailBackupZip()).resolves.toEqual({ ok: true, path: zipPath });
  });

  test('propagates inspection errors without attempting extraction', async () => {
    inspectMock.mockResolvedValueOnce({ ok: false, error: 'Ungültiges Backup' });

    await expect(previewRestoreLocalMailBackup(zipPath)).resolves.toEqual({
      ok: false,
      error: 'Ungültiges Backup',
    });
    expect(openZipMock).not.toHaveBeenCalled();
  });

  test('previews accounts, attachment state, schema mismatch and active sync', async () => {
    busyMock.mockReturnValue(true);

    const result = await previewRestoreLocalMailBackup(zipPath);

    expect(result).toMatchObject({
      ok: true,
      path: zipPath,
      previewToken: expect.stringMatching(/^[a-f0-9]{24}$/),
      schemaGeneration: 999,
      schemaGenerationLabel: 'future',
      exportedAt: '2026-07-14T08:00:00.000Z',
      hasAttachments: true,
      accountEmails: ['one@example.com', 'two@example.com'],
    });
    expect(result.ok && result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Schema-Generation/),
        expect.stringMatching(/Hintergrund-Sync/),
      ]),
    );
  });

  test('returns a controlled error for traversal entries and removes preview temp data', async () => {
    configureZip([{ fileName: '../outside.sqlite', data: 'bad' }]);

    await expect(previewRestoreLocalMailBackup(zipPath)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/Traversal|Pfad/i) }),
    );
    expect(fs.readdirSync(path.join(root, 'temp'))).toEqual([]);
  });

  describe('restore transaction', () => {
    async function previewToken(): Promise<string> {
      const preview = await previewRestoreLocalMailBackup(zipPath);
      if (!preview.ok) throw new Error(preview.error);
      return preview.previewToken;
    }

    test('rejects an invalid confirmation, inspection result, stale preview and busy sync', async () => {
      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: 'ignored',
          confirmPhrase: 'restore',
          createPreBackup: false,
        }),
      ).resolves.toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/exakt/) }));

      inspectMock.mockResolvedValueOnce({ ok: false, error: 'Defekt' });
      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: 'ignored',
          confirmPhrase: RESTORE_CONFIRM_PHRASE,
          createPreBackup: false,
        }),
      ).resolves.toEqual({ ok: false, error: 'Defekt' });

      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: 'stale',
          confirmPhrase: RESTORE_CONFIRM_PHRASE,
          createPreBackup: false,
        }),
      ).resolves.toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/veraltet/) }));

      const token = await previewToken();
      busyMock.mockReturnValue(true);
      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: token,
          confirmPhrase: RESTORE_CONFIRM_PHRASE,
          createPreBackup: false,
        }),
      ).resolves.toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/Sync läuft/) }));
      expect(stopServicesMock).not.toHaveBeenCalled();
    });

    test('aborts before replacing files when the pre-restore backup fails', async () => {
      const token = await previewToken();
      exportMock.mockResolvedValueOnce({ ok: false, error: 'Kein Speicherplatz' });

      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: token,
          confirmPhrase: RESTORE_CONFIRM_PHRASE,
          createPreBackup: true,
        }),
      ).resolves.toEqual({ ok: false, error: 'Kein Speicherplatz' });
      expect(stopServicesMock).not.toHaveBeenCalled();
    });

    test('atomically replaces the database and attachments and relaunches', async () => {
      const token = await previewToken();
      const userData = path.join(root, 'user-data');
      const dbPath = path.join(userData, 'database.sqlite');
      const attachmentRoot = path.join(root, 'attachments');
      fs.writeFileSync(dbPath, 'old-database');
      fs.mkdirSync(attachmentRoot, { recursive: true });
      fs.writeFileSync(path.join(attachmentRoot, 'old.txt'), 'old-attachment');

      const result = await restoreLocalMailBackup({
        zipPath,
        previewToken: token,
        confirmPhrase: RESTORE_CONFIRM_PHRASE,
        createPreBackup: true,
      });

      expect(result).toMatchObject({ ok: true, preBackupPath: expect.stringMatching(/auto-.*\.zip$/) });
      expect(fs.readFileSync(dbPath, 'utf8')).toBe('new-database');
      expect(fs.readFileSync(path.join(attachmentRoot, 'a.txt'), 'utf8')).toBe('attachment');
      expect(stopServicesMock).toHaveBeenCalledTimes(1);
      expect(closeDatabaseMock).toHaveBeenCalledTimes(1);
      expect(relaunchMock).toHaveBeenCalledTimes(1);
      expect(exitMock).toHaveBeenCalledWith(0);
      expect(reopenDatabaseMock).not.toHaveBeenCalled();
    });

    test('rolls back renamed data and restarts services after a copy failure', async () => {
      const token = await previewToken();
      const dbPath = path.join(root, 'user-data', 'database.sqlite');
      const attachmentRoot = path.join(root, 'attachments');
      fs.writeFileSync(dbPath, 'old-database');
      fs.mkdirSync(attachmentRoot, { recursive: true });
      fs.writeFileSync(path.join(attachmentRoot, 'old.txt'), 'old-attachment');
      const copySpy = jest.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
        throw new Error('copy failed');
      });

      const result = await restoreLocalMailBackup({
        zipPath,
        previewToken: token,
        confirmPhrase: RESTORE_CONFIRM_PHRASE,
        createPreBackup: false,
      });

      copySpy.mockRestore();
      expect(result).toEqual({ ok: false, error: 'copy failed' });
      expect(fs.readFileSync(dbPath, 'utf8')).toBe('old-database');
      expect(fs.readFileSync(path.join(attachmentRoot, 'old.txt'), 'utf8')).toBe('old-attachment');
      expect(reopenDatabaseMock).toHaveBeenCalledTimes(1);
      expect(startServicesMock).toHaveBeenCalledTimes(1);
      expect(relaunchMock).not.toHaveBeenCalled();
    });

    test('recovers stopped services when closing the database fails', async () => {
      const token = await previewToken();
      fs.writeFileSync(path.join(root, 'user-data', 'database.sqlite'), 'old-database');
      closeDatabaseMock.mockImplementationOnce(() => {
        throw new Error('close failed');
      });

      await expect(
        restoreLocalMailBackup({
          zipPath,
          previewToken: token,
          confirmPhrase: RESTORE_CONFIRM_PHRASE,
          createPreBackup: false,
        }),
      ).resolves.toEqual({ ok: false, error: 'close failed' });
      expect(startServicesMock).toHaveBeenCalled();
      expect(reopenDatabaseMock).not.toHaveBeenCalled();
    });
  });
});
