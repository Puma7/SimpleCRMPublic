import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createJsonlAuditRetentionArchivePort } from '../../packages/server/src/jobs/audit-archive';

// Same module object the archive port uses, so the spy sees its calls.
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000a7';

function auditRow(id: number) {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    actor_user_id: null,
    action: 'audit.retention.probe',
    entity_type: 'email_message',
    entity_id: String(id),
    metadata: {},
    previous_hash: null,
    event_hash: `hash-${id}`,
    created_at: new Date('2026-05-01T12:00:00.000Z'),
  };
}

// F-A8-07: the retention archive was written with plain writeFile (no fsync) right before
// the rows were deleted; a host crash after the commit could leave an empty or missing file.
describe('jsonl audit retention archive durability', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'audit-archive-durability-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  test('flushes the archive file and its directory to disk before returning', async () => {
    const synced: string[] = [];
    const realOpen = fsPromises.open;
    jest.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      const realSync = handle.sync.bind(handle);
      handle.sync = async () => {
        synced.push(String(args[0]));
        await realSync();
      };
      return handle;
    });

    await createJsonlAuditRetentionArchivePort({ rootDir }).archive({
      workspaceId: WORKSPACE_ID,
      olderThan: new Date('2026-05-04T12:00:00.000Z'),
      rows: [auditRow(7), auditRow(8)] as never,
    });

    const workspaceDir = join(rootDir, WORKSPACE_ID);
    const files = readdirSync(workspaceDir);
    expect(files).toEqual(['audit-retention_2026-05-04T12_00_00.000Z_ids-7-8_count-2.jsonl']);
    const lines = readFileSync(join(workspaceDir, files[0]!), 'utf8').trim().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as { id: number }).id)).toEqual([7, 8]);
    // The data file (written under a temporary name, then renamed) and the
    // directory entry are both fsynced.
    expect(synced).toHaveLength(2);
    expect(synced[0]!.startsWith(join(workspaceDir, files[0]!))).toBe(true);
    expect(synced[1]).toBe(workspaceDir);
  });
});
