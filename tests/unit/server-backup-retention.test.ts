import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

describe('docker backup retention', () => {
  test('keeps daily, weekly, and monthly generations and removes orphan companions', () => {
    if (!bashAvailable()) {
      return;
    }

    const output = execFileSync('bash', ['-s'], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

. docker/backup-retention.sh

create_set() {
  stamp="$1"
  printf 'db' > "$tmp/db-$stamp.dump"
  printf 'attachments' > "$tmp/attachments-$stamp.tar"
  printf 'audit' > "$tmp/audit-archive-$stamp.tar"
  printf 'checksum' > "$tmp/backup-$stamp.sha256"
}

create_set 2026-06-05T10-00-00Z
create_set 2026-06-05T09-00-00Z
create_set 2026-06-04T10-00-00Z
create_set 2026-05-29T10-00-00Z
create_set 2026-05-22T10-00-00Z
create_set 2026-04-15T10-00-00Z
create_set 2026-03-15T10-00-00Z
create_set 2026-02-15T10-00-00Z
printf 'orphan' > "$tmp/backup-1999-01-01T00-00-00Z.sha256"

BACKUP_RETENTION_DAILY=2
BACKUP_RETENTION_WEEKLY=2
BACKUP_RETENTION_MONTHLY=2
prune_backup_retention "$tmp"

ls -1 "$tmp" | sort
`,
    });

    const keptStamps = [
      '2026-06-05T10-00-00Z',
      '2026-06-04T10-00-00Z',
      '2026-05-29T10-00-00Z',
      '2026-05-22T10-00-00Z',
      '2026-04-15T10-00-00Z',
      '2026-03-15T10-00-00Z',
    ];
    const expectedFiles = keptStamps.flatMap((stamp) => [
      `attachments-${stamp}.tar`,
      `audit-archive-${stamp}.tar`,
      `backup-${stamp}.sha256`,
      `db-${stamp}.dump`,
    ]).sort();

    expect(output.trim().split(/\r?\n/)).toEqual(expectedFiles);
  });
});
