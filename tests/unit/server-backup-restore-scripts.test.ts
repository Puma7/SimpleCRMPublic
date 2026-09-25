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

// restore.sh gegen Stubs: psql meldet die Erweiterungen der Zieldatenbank,
// pg_restore liefert fuer -l ein Inhaltsverzeichnis und protokolliert sonst
// seine Argumente und die per -L uebergebene Liste.
const runRestore = (restoreRole: string) => {
  const output = execFileSync('bash', ['-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat > "$tmp/bin/psql" <<'STUB'
#!/bin/sh
case "$*" in
  *pg_extension*) echo 'plpgsql,pgcrypto,pg_trgm' ;;
esac
STUB

cat > "$tmp/bin/pg_restore" <<'STUB'
#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = '-l' ]; then
    cat <<'TOC'
;
; Archive created at 2026-06-05 02:00:00 UTC
;
2; 3079 16386 EXTENSION - pgcrypto
5448; 0 0 COMMENT - EXTENSION pgcrypto
3; 3079 16423 EXTENSION - pg_trgm
5447; 0 0 COMMENT - EXTENSION pg_trgm
4; 3079 16500 EXTENSION - citext
5449; 0 0 COMMENT - EXTENSION citext
230; 1259 16600 TABLE public customers simplecrm_app
4100; 0 16600 TABLE DATA public customers simplecrm_app
TOC
    exit 0
  fi
done
printf '%s\n' "$@" > "$STUB_STATE/pg_restore.args"
previous=''
for arg in "$@"; do
  if [ "$previous" = '-L' ]; then
    cat "$arg" > "$STUB_STATE/pg_restore.list"
  fi
  previous="$arg"
done
STUB
chmod +x "$tmp/bin/psql" "$tmp/bin/pg_restore"
printf 'PGDMP' > "$tmp/legacy.dump"

export PATH="$tmp/bin:$PATH"
export STUB_STATE="$tmp"
export DATABASE_URL='postgres://stub/simplecrm'
export PG_RESTORE_ROLE='` + restoreRole + String.raw`'
sh docker/restore.sh "$tmp/legacy.dump" 2>/dev/null
echo '--- list'
cat "$tmp/pg_restore.list" 2>/dev/null || true
echo '--- args'
cat "$tmp/pg_restore.args"
`,
  });
  const [list, args] = output.split('--- args\n');
  return {
    args: args.trim().split('\n'),
    list: list.replace('--- list\n', '').trim().split('\n').filter((line) => line !== ''),
  };
};

describe('docker restore.sh', () => {
  // F-A12-02: pg_restore --clean lief ohne --single-transaction, jeder Fehler hinterliess eine halb ersetzte Produktivdatenbank; zugleich scheiterte jeder In-Place-Restore an DROP/COMMENT ON EXTENSION fuer Erweiterungen, die dem Admin gehoeren.
  test.each([
    ['with PG_RESTORE_ROLE', 'simplecrm_app'],
    ['without PG_RESTORE_ROLE', ''],
  ])('restores atomically and leaves existing extensions alone (%s)', (_label, restoreRole) => {
    if (!bashAvailable()) {
      return;
    }

    const { args, list } = runRestore(restoreRole);

    expect(args).toEqual(expect.arrayContaining(['--single-transaction', '--clean', '--if-exists', '--no-owner', '-L']));
    if (restoreRole) {
      expect(args).toContain(`--role=${restoreRole}`);
    }
    expect(list).toEqual([
      ';',
      '; Archive created at 2026-06-05 02:00:00 UTC',
      ';',
      '4; 3079 16500 EXTENSION - citext',
      '5449; 0 0 COMMENT - EXTENSION citext',
      '230; 1259 16600 TABLE public customers simplecrm_app',
      '4100; 0 16600 TABLE DATA public customers simplecrm_app',
    ]);
  });
});

// restore-drill.sh gegen Stubs: psql protokolliert jede Anweisung und spielt
// eine Drill-Datenbank, in der der Dump workspaces als VIEW angelegt hat. Eine
// Katalogabfrage mit relkind-Pruefung sieht darin keine Tabelle ('n/a'); jede
// andere Abfrage auf workspaces wertet die View aus und wird vermerkt.
const runRestoreDrill = () => {
  const output = execFileSync('bash', ['-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat > "$tmp/bin/psql" <<'STUB'
#!/bin/sh
sql="$*"
previous=''
for arg in "$@"; do
  if [ "$previous" = '-f' ] && [ "$arg" = '-' ]; then
    sql="$(cat)"
  fi
  previous="$arg"
done
case "$sql" in
  *relkind*) echo 'n/a' ;;
  *workspaces*) echo 'workspaces view evaluated' >> "$STUB_STATE/evaluated"; echo 1 ;;
esac
exit 0
STUB

cat > "$tmp/bin/pg_restore" <<'STUB'
#!/bin/sh
exit 0
STUB
chmod +x "$tmp/bin/psql" "$tmp/bin/pg_restore"
printf 'PGDMP' > "$tmp/drill.dump"

export PATH="$tmp/bin:$PATH"
export STUB_STATE="$tmp"
export DATABASE_URL='postgres://stub/simplecrm'
status=0
sh docker/restore-drill.sh "$tmp/drill.dump" 2>"$tmp/stderr" >/dev/null || status=$?
echo "status=$status"
cat "$tmp/stderr"
cat "$tmp/evaluated" 2>/dev/null || true
`,
  });
  const [statusLine, ...rest] = output.trim().split(/\r?\n/);
  return { status: Number(statusLine.replace('status=', '')), output: rest.join('\n') };
};

describe('docker restore-drill.sh', () => {
  // C-A55: Der Drill zaehlte workspaces mit einem rohen count(*) als Admin, sodass eine View aus dem Dump an dieser Stelle mit Superuser-Rechten ausgewertet wurde.
  test('does not evaluate a workspaces view from the dump and fails instead', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runRestoreDrill();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('workspaces is not a readable table after restore');
    expect(result.output).not.toContain('workspaces view evaluated');
  });
});
