import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  draftAttachmentPathsToJson,
  draftAttachmentPathsToJsonStored,
  filterExistingDraftAttachmentPaths,
  parseDraftAttachmentPathsJson,
} from '../../electron/email/email-compose-draft-attachments';

describe('email-compose-draft-attachments', () => {
  test('re-exports shared json helpers', () => {
    const paths = ['/tmp/a.txt'];
    const json = draftAttachmentPathsToJson(paths);
    expect(parseDraftAttachmentPathsJson(json)).toEqual(paths);
    expect(draftAttachmentPathsToJsonStored(paths)).toBe(json);
    expect(draftAttachmentPathsToJsonStored([])).toBeNull();
  });

  test('filterExistingDraftAttachmentPaths keeps only existing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-draft-'));
    const file = path.join(dir, 'ok.txt');
    fs.writeFileSync(file, 'x');
    const missing = path.join(dir, 'nope.txt');
    const json = JSON.stringify([file, missing, '/definitely/missing']);
    expect(filterExistingDraftAttachmentPaths(json)).toEqual([file]);
    expect(filterExistingDraftAttachmentPaths(null)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('filterExistingDraftAttachmentPaths ignores stat errors', () => {
    const bad = '\0';
    expect(filterExistingDraftAttachmentPaths(JSON.stringify([bad]))).toEqual([]);
  });
});
