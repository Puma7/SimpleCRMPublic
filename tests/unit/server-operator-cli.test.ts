import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

// Spins up a fake `docker` on PATH that records every argv it receives, reports
// the configured set of existing Compose stacks for `compose ls`, and lets the
// restore orchestration's health-wait return immediately (so the scripts run to
// completion without Docker). Returns the exit status, stderr, and the recorded
// compose project flags.
function runWithFakeDocker(
  args: readonly string[],
  options: { env?: Record<string, string>; stacks?: readonly string[] } = {},
): { status: number; stderr: string; projectFlags: string[]; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'simplecrm-fakedocker-'));
  try {
    const logPath = join(dir, 'docker.log');
    const fakeDocker = join(dir, 'docker');
    writeFileSync(
      fakeDocker,
      [
        '#!/bin/sh',
        'echo "$*" >> "$DOCKER_LOG"',
        // `compose ls` -> a table header plus one row per configured fake stack.
        'case "$*" in',
        "  *\"compose ls\"*) printf 'NAME STATUS CONFIG\\n'; for p in $FAKE_STACKS; do printf '%s running x\\n' \"$p\"; done; exit 0 ;;",
        '  *"ps -q api"*) echo "fakeapi"; exit 0 ;;',
        'esac',
        // restore-compose.sh probes `docker inspect` for health.
        'case "$1" in inspect) echo "healthy"; exit 0 ;; esac',
        // Optionally fail the plain migrate-apply (but not --check / --repair-checksums).
        'if [ -n "${FAKE_FAIL_MIGRATE:-}" ]; then',
        '  case "$*" in',
        '    *--check*|*--repair-checksums*) : ;;',
        '    *migrate.js*) exit 1 ;;',
        '  esac',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(fakeDocker, 0o755);

    const result = spawnSync('bash', args.slice(), {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        DOCKER_LOG: logPath,
        FAKE_STACKS: (options.stacks ?? []).join(' '),
        ...(options.env ?? {}),
      },
      encoding: 'utf8',
    });

    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const projectFlags = [...log.matchAll(/-p (\S+)/g)].map((m) => m[1] ?? '');
    return { status: result.status ?? -1, stderr: result.stderr ?? '', projectFlags, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('server operator CLI wrapper', () => {
  test('prints the documented command surface without starting Docker', () => {
    const script = join(repoRoot, 'docker', 'simplecrm');
    expect(existsSync(script)).toBe(true);

    if (!bashAvailable()) {
      return;
    }

    const help = execFileSync('bash', ['docker/simplecrm', '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(help).toEqual(expect.stringContaining('usage: simplecrm <command> [args]'));
    expect(help).toEqual(expect.stringContaining('update'));
    expect(help).toEqual(expect.stringContaining('up'));
    expect(help).toEqual(expect.stringContaining('backup'));
    expect(help).toEqual(expect.stringContaining('backup-scheduler'));
    expect(help).toEqual(expect.stringContaining('doctor'));
    expect(help).toEqual(expect.stringContaining('restore [dump [att [audit]]]'));
    expect(help).toEqual(expect.stringContaining('restore-drill [dump [att [audit]]]'));
    expect(help).toEqual(expect.stringContaining('COMPOSE_PROJECT_NAME'));
  });
});

describe('operator CLI compose-project consistency', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };

  test('all subcommands default to the same project (the compose dir basename)', ranOrSkipped(() => {
    // The helper's own compose() call.
    const ps = runWithFakeDocker(['docker/simplecrm', 'ps']);
    expect(ps.projectFlags).toContain('docker');
    expect(ps.projectFlags).not.toContain('simplecrm');

    // Delegated restore-compose.sh must inherit the SAME project (was the bug:
    // it fell back to a hardcoded "simplecrm" and could target a different stack).
    const restore = runWithFakeDocker(['docker/simplecrm', 'restore']);
    expect(restore.projectFlags.length).toBeGreaterThan(0);
    expect(new Set(restore.projectFlags)).toEqual(new Set(['docker']));

    // Delegated update.sh (skip pull + backup to keep it offline and fast).
    const update = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup']);
    expect(update.projectFlags.length).toBeGreaterThan(0);
    expect(new Set(update.projectFlags)).toEqual(new Set(['docker']));
  }));

  test('an explicit COMPOSE_PROJECT_NAME overrides every subcommand consistently', ranOrSkipped(() => {
    const env = { COMPOSE_PROJECT_NAME: 'prod42' };
    expect(new Set(runWithFakeDocker(['docker/simplecrm', 'ps'], { env }).projectFlags)).toEqual(new Set(['prod42']));
    expect(new Set(runWithFakeDocker(['docker/simplecrm', 'restore'], { env }).projectFlags)).toEqual(new Set(['prod42']));
    // restore-compose.sh invoked directly also honors the override.
    expect(new Set(runWithFakeDocker(['docker/restore-compose.sh'], { env }).projectFlags)).toEqual(new Set(['prod42']));
  }));

  test('update refuses to silently spin up a second stack beside a legacy "simplecrm" one', ranOrSkipped(() => {
    // A legacy stack named "simplecrm" exists; the derived default is "docker"
    // (no such stack yet) and the operator did not pick a project explicitly.
    const blocked = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { stacks: ['simplecrm'] },
    );
    expect(blocked.status).toBe(3);
    expect(blocked.stderr).toContain("existing Compose stack named 'simplecrm'");
    // It must not have built or started anything (no -p flags reached compose).
    expect(blocked.projectFlags).not.toContain('docker');
  }));

  test('update proceeds when the operator explicitly confirms the project', ranOrSkipped(() => {
    // Same legacy stack present, but COMPOSE_PROJECT_NAME is explicit -> no guard.
    const ok = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { stacks: ['simplecrm'], env: { COMPOSE_PROJECT_NAME: 'docker' } },
    );
    expect(ok.status).toBe(0);
    expect(new Set(ok.projectFlags)).toEqual(new Set(['docker']));
  }));

  test('the default update does NOT repair checksums; --repair-checksums opts in', ranOrSkipped(() => {
    const plain = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup']);
    expect(plain.status).toBe(0);
    expect(plain.log).not.toContain('--repair-checksums');

    const repair = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup', '--repair-checksums'],
    );
    expect(repair.status).toBe(0);
    expect(repair.log).toContain('--repair-checksums');
  }));

  test('a failed migration points the operator at REPAIR_CHECKSUMS instead of auto-blessing drift', ranOrSkipped(() => {
    const failed = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { FAKE_FAIL_MIGRATE: '1' } },
    );
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('REPAIR_CHECKSUMS=1');
    // It must not have started api/caddy after a failed migration.
    expect(failed.log).not.toContain('up -d api caddy');
  }));

  test('default-project derivation follows COMPOSE_FILE, not the script location', ranOrSkipped(() => {
    // A compose file in a directory named "custom" must yield project "custom".
    const dir = mkdtempSync(join(tmpdir(), 'simplecrm-customcompose-'));
    try {
      const customDir = join(dir, 'custom');
      const composeFile = join(customDir, 'docker-compose.yml');
      execFileSync('mkdir', ['-p', customDir]);
      writeFileSync(composeFile, "services: {}\n");
      const res = runWithFakeDocker(['docker/simplecrm', 'ps'], { env: { COMPOSE_FILE: composeFile } });
      expect(new Set(res.projectFlags)).toEqual(new Set(['custom']));
      // --project-directory pins the project (and its .env) to that directory.
      expect(res.log).toContain(`--project-directory ${customDir}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }));
});
