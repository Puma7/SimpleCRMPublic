import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const bashAvailable = () => spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
const busyboxAvailable = () => spawnSync('busybox', ['--help'], { stdio: 'ignore' }).status === 0;

/**
 * Inkrementelle Anhangssicherung (docker/backup-attachments.sh). Die Skripte
 * laufen im Container unter BusyBox; deshalb jeder Fall zweimal: mit den
 * Werkzeugen des Hosts und mit BusyBox-Applets (sh, find, stat, awk, …).
 *
 * `sha256sum` zählt mit, wie oft eine Datei gelesen wurde: der zweite Lauf
 * darf nur neue Dateien lesen.
 */
function runScenario(script: string, useBusybox: boolean): string {
  return execFileSync('bash', ['-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/att/ws/mail-sync/1" "$tmp/att/ws/mail-sync/2" "$tmp/backups"
real_sha="$(command -v sha256sum)"
if [ "${useBusybox ? '1' : ''}" = 1 ]; then
  for applet in sh find stat awk sort cut cp mv ln mkdir rm cat ls head basename dirname mktemp touch rmdir tr sed; do
    ln -s "$(command -v busybox)" "$tmp/bin/$applet"
  done
  real_sha="$(command -v busybox) sha256sum"
  SH="$tmp/bin/sh"
else
  SH=sh
fi
cat > "$tmp/bin/sha256sum" <<STUB
#!/bin/sh
echo x >> "$tmp/hash.count"
exec $real_sha "\$@"
STUB
chmod +x "$tmp/bin/sha256sum"
export PATH="$tmp/bin:$PATH"
printf 'Vertrag Version 1 %.0s' $(seq 1 200) > "$tmp/att/ws/mail-sync/1/vertrag.pdf"
cp "$tmp/att/ws/mail-sync/1/vertrag.pdf" "$tmp/att/ws/mail-sync/2/vertrag kopie.pdf"
printf 'Notiz' > "$tmp/att/ws/mail-sync/1/notiz.txt"
run() { "$SH" -c ". docker/backup-attachments.sh; $1" sh "$tmp"; }
objects() { find "$tmp/backups/attachments-store" -type f | wc -l | tr -d ' '; }
hashes() { if [ -f "$tmp/hash.count" ]; then wc -l < "$tmp/hash.count" | tr -d ' '; else echo 0; fi; }
` + script,
  });
}

const modes = [['host tools', false], ['busybox', true]] as const;

describe.each(modes)('incremental attachment backup (%s)', (_label, useBusybox) => {
  const skip = () => !bashAvailable() || (useBusybox && !busyboxAvailable());

  test('the second run reads only new files; identical content is stored once', () => {
    if (skip()) return;
    const out = runScenario(String.raw`
run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-01T00-00-00Z.list"'
echo "first_objects=$(objects) first_hashes=$(hashes)"
printf 'Neue Rechnung' > "$tmp/att/ws/mail-sync/2/rechnung.pdf"
rm -f "$tmp/hash.count"
run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-02T00-00-00Z.list"'
echo "second_objects=$(objects) second_hashes=$(hashes)"
echo "second_lines=$(wc -l < "$tmp/backups/attachments-2026-09-02T00-00-00Z.list" | tr -d ' ')"
cut -f4 "$tmp/backups/attachments-2026-09-02T00-00-00Z.list"
`, useBusybox);
    expect(out).toContain('first_objects=2 ');
    expect(out).toContain('second_objects=3 ');
    expect(out).toContain('second_lines=4');
    // Lesezähler nur mit den Host-Werkzeugen: ein BusyBox mit eingebauten
    // Applets (z. B. busybox-static im CI) ruft sha256sum intern auf und
    // umgeht den gezählten Wrapper im PATH.
    if (!useBusybox) {
      // Erster Lauf: 3 Dateien gelesen, 2 Inhalte kopiert und geprüft.
      expect(out).toContain('first_objects=2 first_hashes=5');
      // Zweiter Lauf: nur die neue Datei gelesen und ihr Inhalt kopiert.
      expect(out).toContain('second_objects=3 second_hashes=2');
    }
    expect(out).toContain('./ws/mail-sync/2/vertrag kopie.pdf');
  });

  test('restore rebuilds every file exactly and links identical content; a damaged object is refused', () => {
    if (skip()) return;
    const out = runScenario(String.raw`
list="$tmp/backups/attachments-2026-09-01T00-00-00Z.list"
run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-01T00-00-00Z.list"'
run 'verify_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list" deep' && echo verify=ok
run 'restore_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list" "$1/restored"'
diff -r "$tmp/att" "$tmp/restored" && echo restore=identical
a="$(stat -c %i "$tmp/restored/ws/mail-sync/1/vertrag.pdf")"
b="$(stat -c %i "$tmp/restored/ws/mail-sync/2/vertrag kopie.pdf")"
[ "$a" = "$b" ] && echo restore=hardlinked
# Wiederholung ueber vorhandene Dateien: nichts zu tun, nichts kaputt.
run 'restore_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list" "$1/restored"' && echo again=ok

object="$(find "$tmp/backups/attachments-store" -type f | head -n 1)"
chmod u+w "$object"
printf 'kaputt' > "$object"
run 'verify_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list"' && echo shallow=ok
run 'verify_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list" deep' 2>&1 || echo deep=refused
rm -rf "$tmp/fresh"
run 'restore_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list" "$1/fresh"' 2>&1 || echo fresh=refused
rm -f "$object"
run 'verify_attachment_list "$1/backups/attachments-2026-09-01T00-00-00Z.list"' 2>&1 || echo missing=refused
`, useBusybox);
    expect(out).toContain('verify=ok');
    expect(out).toContain('restore=identical');
    expect(out).toContain('restore=hardlinked');
    expect(out).toContain('again=ok');
    expect(out).toContain('shallow=ok');
    expect(out).toMatch(/attachment backup object damaged[\s\S]*deep=refused/);
    expect(out).toContain('fresh=refused');
    expect(out).toMatch(/attachment backup object missing[\s\S]*missing=refused/);
  });

  test('pruning removes only contents no list names and that are older than a day', () => {
    if (skip()) return;
    const out = runScenario(String.raw`
run 'write_attachment_list "$1/att" "$1/backups" "$1/backups/attachments-2026-09-01T00-00-00Z.list"'
store="$tmp/backups/attachments-store"
mkdir -p "$store/ab"
printf 'alt' > "$store/ab/abababababababababababababababababababababababababababababababab"
printf 'neu' > "$store/ab/abababababababababababababababababababababababababababababababac"
touch -t 202001010000 "$store/ab/abababababababababababababababababababababababababababababababab"
find "$store" -type f -name '[0-9a-f]*' ! -path '*/ab/*' -exec touch -t 202001010000 {} +
run 'prune_attachment_store "$1/backups"'
echo "after_prune=$(objects)"
ls "$store/ab"
mkdir -p "$tmp/empty/attachments-store/cd"
printf 'x' > "$tmp/empty/attachments-store/cd/cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
touch -t 202001010000 "$tmp/empty/attachments-store/cd/cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
run 'prune_attachment_store "$1/empty"'
echo "without_lists=$(find "$tmp/empty/attachments-store" -type f | wc -l | tr -d ' ')"
`, useBusybox);
    // 2 referenzierte (alt, bleiben) + 'neu' (unreferenziert, aber jung) bleiben; 'alt' ohne Liste geht.
    expect(out).toContain('after_prune=3');
    expect(out).not.toContain('abababababababababababababababababababababababababababababababab\n');
    expect(out).toContain('abababababababababababababababababababababababababababababababac');
    expect(out).toContain('without_lists=1');
  });
});

// Ende zu Ende mit Stubs für pg_dump/psql/pg_restore: backup.sh legt Liste und
// Speicher an, restore.sh stellt daraus her. Fehlt ein Inhalt, bricht der
// Restore ab, BEVOR pg_restore die Datenbank anfasst.
describe('backup.sh and restore.sh with the attachment list', () => {
  test('restores the attachments of a set; a missing content stops before the database', () => {
    if (!bashAvailable()) return;
    const out = execFileSync('bash', ['-s'], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: String.raw`
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups" "$tmp/att/ws/mail-sync/7"
cat > "$tmp/bin/psql" <<'STUB'
#!/bin/sh
case "$*" in
  *rolsuper*) echo true ;;
  *pg_has_role*) echo true ;;
  *pg_extension*) echo 'plpgsql' ;;
  *) echo 'rows_customers=1' ;;
esac
STUB
cat > "$tmp/bin/pg_dump" <<'STUB'
#!/bin/sh
printf 'PGDMP-complete'
STUB
cat > "$tmp/bin/pg_restore" <<'STUB'
#!/bin/sh
for arg in "$@"; do [ "$arg" = '-l' ] && exit 0; done
printf '%s\n' "$@" > "$STUB_STATE/pg_restore.args"
STUB
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH" STUB_STATE="$tmp"
export DATABASE_URL='postgres://simplecrm_app:pw@stub/simplecrm'
export BACKUP_DIR="$tmp/backups" ATTACHMENTS_DIR="$tmp/att" AUDIT_ARCHIVE_DIR="$tmp/none"
printf 'Angebot' > "$tmp/att/ws/mail-sync/7/angebot.pdf"
printf 'Angebot' > "$tmp/att/ws/mail-sync/7/angebot-2.pdf"
sh docker/backup.sh 2>/dev/null
(cd "$BACKUP_DIR" && sha256sum -c --quiet backup-*.sha256) && echo manifest=ok
list="$(ls "$BACKUP_DIR"/attachments-*.list)"
cp "$(ls "$BACKUP_DIR"/db-*.dump)" "$tmp/plain.dump"

export ATTACHMENTS_DIR="$tmp/restored"
sh docker/restore.sh "$tmp/plain.dump" "$list" 2>/dev/null && echo restore=ok
diff -r "$tmp/att" "$tmp/restored" && echo files=identical

rm -f "$tmp/pg_restore.args"
find "$BACKUP_DIR/attachments-store" -type f -exec rm -f {} +
export ATTACHMENTS_DIR="$tmp/restored-2"
sh docker/restore.sh "$tmp/plain.dump" "$list" 2>&1 || echo second=refused
[ -f "$tmp/pg_restore.args" ] && echo database=touched || echo database=untouched
`,
    });
    expect(out).toContain('manifest=ok');
    expect(out).toContain('restore=ok');
    expect(out).toContain('files=identical');
    expect(out).toContain('attachment backup object missing');
    expect(out).toContain('second=refused');
    expect(out).toContain('database=untouched');
  });
});
