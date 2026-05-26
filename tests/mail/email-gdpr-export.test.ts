import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gdpr-'));
const outFile = path.join(tmpDir, 'export.zip');

jest.mock('electron', () => ({
  dialog: {
    showSaveDialog: jest.fn(),
  },
}));
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentsRootForExport: () => path.join(tmpDir, 'email-attachments'),
}));

const mockFinalize = jest.fn();
const mockAppend = jest.fn();
const mockDirectory = jest.fn();
const mockAbort = jest.fn();

jest.mock('archiver', () => {
  return jest.fn(() => {
    const archive = new EventEmitter() as EventEmitter & {
      pipe: jest.Mock;
      append: jest.Mock;
      directory: jest.Mock;
      finalize: jest.Mock;
      abort: jest.Mock;
    };
    archive.pipe = jest.fn();
    archive.append = mockAppend;
    archive.directory = mockDirectory;
    archive.finalize = mockFinalize.mockImplementation(() => {
      process.nextTick(() => archive.emit('end'));
    });
    archive.abort = mockAbort;
    return archive;
  });
});

import { dialog } from 'electron';
import { exportEmailGdprPackage } from '../../electron/email/email-gdpr-export';

describe('exportEmailGdprPackage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all
      .mockReturnValueOnce([{ id: 1, display_name: 'A', email_address: 'a@x.de' }])
      .mockReturnValueOnce([{ id: 1, subject: 'Hi' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 1, name: 'W', trigger: 'inbound' }])
      .mockReturnValueOnce([{ id: 1, workflow_id: 1, status: 'ok' }]);
    fs.mkdirSync(path.join(tmpDir, 'email-attachments'), { recursive: true });
  });

  test('canceled dialog', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: true });
    const r = await exportEmailGdprPackage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Abgebrochen/);
  });

  test('successful export with attachments', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: outFile });
    const writeStream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    writeStream.destroy = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream as never);
    const promise = exportEmailGdprPackage();
    process.nextTick(() => writeStream.emit('close'));
    const r = await promise;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe(outFile);
    expect(mockAppend).toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalled();
  });

  test('skip attachments option', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: outFile });
    const writeStream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    writeStream.destroy = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream as never);
    const promise = exportEmailGdprPackage({ skipAttachments: true });
    process.nextTick(() => writeStream.emit('close'));
    const r = await promise;
    expect(r.ok).toBe(true);
    expect(mockDirectory).not.toHaveBeenCalled();
  });

  test('fails when attachments too large', async () => {
    const attRoot = path.join(tmpDir, 'email-attachments');
    const big = path.join(attRoot, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(1024));
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 5 * 1024 * 1024 * 1024 } as fs.Stats);
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: outFile });
    const writeStream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    writeStream.destroy = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream as never);
    const r = await exportEmailGdprPackage();
    expect(r.ok).toBe(false);
  });

  test('fails when dialog returns no filePath', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: undefined });
    const r = await exportEmailGdprPackage();
    expect(r.ok).toBe(false);
  });

  test('handles stream and archive errors', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: outFile });
    const writeStream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    writeStream.destroy = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream as never);
    const promise = exportEmailGdprPackage();
    process.nextTick(() => writeStream.emit('error', new Error('disk full')));
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/disk full/);
  });

  test('paginates messages and notes batches', async () => {
    stmt.all.mockReset();
    stmt.all
      .mockReturnValueOnce([{ id: 1, display_name: 'A', email_address: 'a@x.de' }])
      .mockReturnValueOnce(Array.from({ length: 2000 }, (_, i) => ({ id: i + 1 })))
      .mockReturnValueOnce([{ id: 2001 }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 1, note: 'n' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 1, name: 'W', trigger: 'inbound' }])
      .mockReturnValueOnce([{ id: 1, workflow_id: 1, status: 'ok' }]);
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: outFile });
    const writeStream = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
    writeStream.destroy = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStream as never);
    const promise = exportEmailGdprPackage();
    process.nextTick(() => writeStream.emit('close'));
    const r = await promise;
    expect(r.ok).toBe(true);
  });
});
