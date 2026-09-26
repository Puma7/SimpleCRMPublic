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
      files: ['attachments-STAMP.list', 'attachments-store', 'backup-STAMP.meta', 'backup-STAMP.sha256', 'db-STAMP.dump'],
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

  // F-A12-03: Scheiterte ein spaeterer Schritt (hier die Anhangssicherung, z. B. Platte voll), blieben Dump und Metadatei ohne Pruefsummenliste als scheinbar gueltiger Satz liegen.
  test('discards the whole set when a later step fails before the manifest is written', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runBackup(String.raw`
stub pg_dump <<'STUB'
#!/bin/sh
printf 'PGDMP-complete'
STUB
stub find <<'STUB'
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

// restore.sh gegen Stubs: psql meldet die Erweiterungen der Zieldatenbank und
// beantwortet die Pruefung der Anmelderolle (STUB_PRIVILEGED=1: privilegiert),
// pg_restore liefert fuer -l ein Inhaltsverzeichnis und protokolliert sonst
// seine Argumente und die per -L uebergebene Liste.
const RESTORE_URL = 'postgres://simplecrm_app:app-password@stub/simplecrm';

const runRestore = (options: Readonly<{ privileged?: boolean; legacyRestoreRole?: string }> = {}) => {
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
  *pg_has_role*)
    printf '%s\n' "$1" >> "$STUB_STATE/guard.urls"
    if [ -n "$STUB_PRIVILEGED" ]; then echo false; else echo true; fi
    ;;
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
export STUB_PRIVILEGED='` + (options.privileged ? '1' : '') + String.raw`'
export DATABASE_URL='` + RESTORE_URL + String.raw`'
` + (options.legacyRestoreRole ? `export PG_RESTORE_ROLE='${options.legacyRestoreRole}'\n` : '') + String.raw`
status=0
sh docker/restore.sh "$tmp/legacy.dump" 2>"$tmp/stderr" || status=$?
echo "status=$status"
echo '--- stderr'
cat "$tmp/stderr"
echo '--- guard'
cat "$tmp/guard.urls" 2>/dev/null || true
echo '--- list'
cat "$tmp/pg_restore.list" 2>/dev/null || true
echo '--- args'
cat "$tmp/pg_restore.args" 2>/dev/null || true
`,
  });
  const section = (name: string, next: string) =>
    output.split(`--- ${name}\n`)[1]!.split(next)[0]!.split('\n').filter((line) => line !== '');
  return {
    status: Number(/^status=(\d+)/.exec(output)![1]),
    stderr: section('stderr', '--- guard\n').join('\n'),
    guardUrls: section('guard', '--- list\n'),
    list: section('list', '--- args\n'),
    args: section('args', '\u0000'),
  };
};

describe('docker restore.sh', () => {
  // F-A12-02: pg_restore --clean lief ohne --single-transaction, jeder Fehler hinterliess eine halb ersetzte Produktivdatenbank; zugleich scheiterte jeder In-Place-Restore an DROP/COMMENT ON EXTENSION fuer Erweiterungen, die dem Admin gehoeren.
  test('restores atomically and leaves existing extensions alone', () => {
    if (!bashAvailable()) {
      return;
    }

    const { status, args, list } = runRestore();

    expect(status).toBe(0);
    expect(args).toEqual(expect.arrayContaining(['--single-transaction', '--clean', '--if-exists', '--no-owner', '-L']));
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

  // C-A61: pg_restore lief in einer Superuser-Sitzung und verliess sich auf --role; SQL aus dem Dump kam per RESET ROLE zur Anmelderolle zurueck.
  test('runs pg_restore through the restricted login itself, without --role', () => {
    if (!bashAvailable()) {
      return;
    }

    // Auch ein aus alten Compose-Dateien stehengebliebenes PG_RESTORE_ROLE
    // darf nicht wieder zu "anmelden als X, dann SET ROLE" fuehren.
    const { status, args, guardUrls } = runRestore({ legacyRestoreRole: 'simplecrm_app' });

    expect(status).toBe(0);
    expect(guardUrls).toEqual([RESTORE_URL]);
    expect(args[args.indexOf('--dbname') + 1]).toBe(RESTORE_URL);
    expect(args.filter((arg) => arg.startsWith('--role'))).toEqual([]);
  });

  // C-A61: Eine Anmeldung, die Superuser ist oder einer werden kann, bekam das Dump-SQL trotzdem.
  test('refuses to run the dump when the login can regain superuser rights', () => {
    if (!bashAvailable()) {
      return;
    }

    const { status, stderr, args } = runRestore({ privileged: true });

    expect(status).not.toBe(0);
    expect(stderr).toContain('refusing to run pg_restore');
    expect(args).toEqual([]);
  });
});

// restore-drill.sh gegen Stubs: psql protokolliert jede Anweisung mit der
// Verbindung, ueber die sie kam. Mit STUB_COUNT='n/a' spielt es eine
// Drill-Datenbank, in der der Dump workspaces als VIEW angelegt hat: eine
// Katalogabfrage mit relkind-Pruefung sieht darin keine Tabelle; jede andere
// Abfrage auf workspaces wertet die View aus und wird vermerkt.
const DRILL_RESTRICTED_URL = 'postgres://simplecrm_app:app-password@stub/simplecrm';
const DRILL_ADMIN_URL = 'postgres://simplecrm_admin:admin-password@stub/simplecrm';
const DRILL_DB_URL = 'postgres://simplecrm_app:app-password@stub/c_a61_drill';

const runRestoreDrill = (options: Readonly<{ count?: string; privileged?: boolean; legacyRestoreRole?: string }> = {}) => {
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
url="$1"
sql="$*"
previous=''
for arg in "$@"; do
  if [ "$previous" = '-f' ] && [ "$arg" = '-' ]; then
    sql="$(cat)"
  fi
  previous="$arg"
done
case "$sql" in
  *'DATABASE'*) printf 'maintenance %s\n' "$url" >> "$STUB_STATE/psql.log" ;;
  *pg_has_role*)
    printf 'guard %s\n' "$url" >> "$STUB_STATE/psql.log"
    if [ -n "$STUB_PRIVILEGED" ]; then echo false; else echo true; fi
    ;;
  *relkind*) printf 'count %s\n' "$url" >> "$STUB_STATE/psql.log"; echo "$STUB_COUNT" ;;
  *workspaces*) echo 'workspaces view evaluated' >> "$STUB_STATE/evaluated"; echo 1 ;;
esac
exit 0
STUB

cat > "$tmp/bin/pg_restore" <<'STUB'
#!/bin/sh
printf '%s\n' "$@" > "$STUB_STATE/pg_restore.args"
exit 0
STUB
chmod +x "$tmp/bin/psql" "$tmp/bin/pg_restore"
printf 'PGDMP' > "$tmp/db-2026-09-25T00-00-00Z.dump"
printf 'row_counts=ok\nrows_workspaces=0\n' > "$tmp/backup-2026-09-25T00-00-00Z.meta"

export PATH="$tmp/bin:$PATH"
export STUB_STATE="$tmp"
export STUB_COUNT='` + (options.count ?? 'n/a') + String.raw`'
export STUB_PRIVILEGED='` + (options.privileged ? '1' : '') + String.raw`'
export DATABASE_URL='` + DRILL_RESTRICTED_URL + String.raw`'
export RESTORE_DRILL_MAINTENANCE_DATABASE_URL='` + DRILL_ADMIN_URL + String.raw`'
export RESTORE_DRILL_DB_NAME='c_a61_drill'
` + (options.legacyRestoreRole ? `export PG_RESTORE_ROLE='${options.legacyRestoreRole}'\n` : '') + String.raw`
status=0
sh docker/restore-drill.sh "$tmp/db-2026-09-25T00-00-00Z.dump" 2>"$tmp/stderr" >/dev/null || status=$?
echo "status=$status"
cat "$tmp/stderr"
cat "$tmp/evaluated" 2>/dev/null || true
echo '--- psql'
cat "$tmp/psql.log" 2>/dev/null || true
echo '--- args'
cat "$tmp/pg_restore.args" 2>/dev/null || true
`,
  });
  const [head, rest] = output.split('--- psql\n');
  const [psqlLog, args] = rest!.split('--- args\n');
  const [statusLine, ...messages] = head!.trim().split(/\r?\n/);
  const lines = (text: string) => text.split('\n').filter((line) => line !== '');
  return {
    status: Number(statusLine!.replace('status=', '')),
    output: messages.join('\n'),
    psql: lines(psqlLog!),
    args: lines(args!),
  };
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

  // C-A61: Der Drill spielte den Dump ueber eine aus der Admin-URL abgeleitete Superuser-Sitzung mit --role ein und pruefte danach als Admin; RESET ROLE im Dump erreichte so den Produktionscluster.
  test('uses the admin login only to create and drop the drill database', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runRestoreDrill({ count: '0', legacyRestoreRole: 'simplecrm_app' });

    expect(result.status).toBe(0);
    expect(result.args[result.args.indexOf('--dbname') + 1]).toBe(DRILL_DB_URL);
    expect(result.args.filter((arg) => arg.startsWith('--role'))).toEqual([]);
    expect(result.args.join(' ')).not.toContain('simplecrm_admin');
    // Anlegen, Pruefung der Anmelderolle, Zaehlungen, Aufraeumen: nur die
    // Datenbankverwaltung laeuft als Admin, alles am wiederhergestellten
    // Inhalt ueber die eingeschraenkte Anmeldung in der Drill-Datenbank.
    expect(result.psql).toEqual([
      `maintenance ${DRILL_ADMIN_URL}`,
      `maintenance ${DRILL_ADMIN_URL}`,
      `guard ${DRILL_DB_URL}`,
      `count ${DRILL_DB_URL}`,
      `count ${DRILL_DB_URL}`,
      `maintenance ${DRILL_ADMIN_URL}`,
    ]);
  });

  // C-A61: Eine Anmeldung, die Superuser ist oder einer werden kann, bekam das Dump-SQL auch im Drill.
  test('refuses to restore into the drill database through a privileged login', () => {
    if (!bashAvailable()) {
      return;
    }

    const result = runRestoreDrill({ count: '0', privileged: true });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('refusing to run pg_restore');
    expect(result.args).toEqual([]);
    // Die angelegte Drill-Datenbank wird trotzdem wieder entfernt.
    expect(result.psql[result.psql.length - 1]).toBe(`maintenance ${DRILL_ADMIN_URL}`);
  });
});
