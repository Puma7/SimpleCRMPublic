import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

// backup.sh laeuft unveraendert, nur psql, pg_dump und pg_restore sind Stubs in
// einem Temp-Verzeichnis vor dem PATH. Ausgegeben werden der Exit-Status und
// die Dateien im Backup-Verzeichnis (Zeitstempel durch STAMP ersetzt).
const runBackup = (setup: string, invoke = 'sh docker/backup.sh 2>/dev/null') => {
  const output = execFileSync('bash', ['-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups"

stub() {
  cat > "$tmp/bin/$1"
  chmod +x "$tmp/bin/$1"
}

stub psql <<'STUB'
#!/bin/sh
case "$*" in
  *rolsuper*) echo true ;;
  *) echo 'rows_customers=1' ;;
esac
STUB

stub pg_restore <<'STUB'
#!/bin/sh
exit 0
STUB

export PATH="$tmp/bin:$PATH"
export STUB_STATE="$tmp"
export DATABASE_URL='postgres://stub/simplecrm'
export BACKUP_DIR="$tmp/backups"
export ATTACHMENTS_DIR="$tmp/attachments"
export AUDIT_ARCHIVE_DIR="$tmp/audit-archive"
` + setup + String.raw`
status=0
{
` + invoke + String.raw`
} || status=$?
echo "status=$status"
ls -1A "$tmp/backups" | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z/STAMP/'
`,
  });
  const [statusLine, ...files] = output.trim().split(/\r?\n/);
  return { status: Number(statusLine.replace('status=', '')), files: files.sort() };
};

describe('docker backup.sh', () => {
  // Gegenprobe: ein erfolgreicher Lauf legt den vollstaendigen Satz unter den
  // endgueltigen Namen ab, ohne Zwischendateien, und die Pruefsummen stimmen.
  test('publishes a complete, checksummed backup set on success', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runBackup(
      String.raw`
stub pg_dump <<'STUB'
#!/bin/sh
printf 'PGDMP-complete'
STUB
mkdir -p "$ATTACHMENTS_DIR"
printf 'attachment' > "$ATTACHMENTS_DIR/file.bin"
`,
      String.raw`sh docker/backup.sh 2>/dev/null && (cd "$BACKUP_DIR" && sha256sum -c --quiet backup-*.sha256)`,
    );

    expect(result).toEqual({
      status: 0,
      files: ['attachments-STAMP.tar', 'backup-STAMP.meta', 'backup-STAMP.sha256', 'db-STAMP.dump'],
    });
  });

  // F-A12-03: Ein abgebrochener pg_dump hinterliess ein abgeschnittenes db-*.dump unter dem endgueltigen Namen, das Restore und Aufbewahrung als Backup nahmen.
  test('leaves no dump behind when pg_dump fails mid-stream', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runBackup(String.raw`
stub pg_dump <<'STUB'
#!/bin/sh
printf 'PGDMP-truncated'
exit 1
STUB
`);

    expect(result.status).not.toBe(0);
    expect(result.files).toEqual([]);
  });

  // F-A12-03: Scheiterte ein spaeterer Schritt (hier das Anhang-Archiv, z. B. Platte voll), blieben Dump und Metadatei ohne Pruefsummenliste als scheinbar gueltiger Satz liegen.
  test('discards the whole set when a later step fails before the manifest is written', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runBackup(String.raw`
stub pg_dump <<'STUB'
#!/bin/sh
printf 'PGDMP-complete'
STUB
stub tar <<'STUB'
#!/bin/sh
exit 2
STUB
mkdir -p "$ATTACHMENTS_DIR"
`);

    expect(result.status).not.toBe(0);
    expect(result.files).toEqual([]);
  });

  // F-D4-02: Der INT/TERM-Trap loeschte nur die Metadatei und liess das Skript weiterlaufen, sodass ein abgebrochener Lauf mit Exit 0 einen Satz ohne .meta ablegte.
  test('stops on SIGTERM during pg_dump and leaves nothing behind', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runBackup(
      String.raw`
stub pg_dump <<'STUB'
#!/bin/sh
: > "$STUB_STATE/pg_dump.started"
printf 'PGDMP'
sleep 1
printf 'rest-of-dump'
STUB
`,
      String.raw`
sh docker/backup.sh 2>/dev/null &
pid=$!
tries=0
while [ ! -e "$STUB_STATE/pg_dump.started" ] && [ "$tries" -lt 200 ]; do
  sleep 0.05
  tries=$((tries + 1))
done
kill -TERM "$pid"
wait "$pid"
`,
    );

    expect(result.status).not.toBe(0);
    expect(result.files).toEqual([]);
  });
});
