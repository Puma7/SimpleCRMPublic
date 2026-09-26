import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => process.platform !== 'win32'
  && spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

// Spins up a fake `docker` on PATH that records every argv it receives, reports
// the configured set of existing Compose stacks for `compose ls`, and lets the
// restore orchestration's health-wait return immediately (so the scripts run to
// completion without Docker). Returns the exit status, stderr, and the recorded
// compose project flags.
function runWithFakeDocker(
  args: readonly string[],
  options: { env?: Record<string, string>; stacks?: readonly string[]; cwd?: string } = {},
): { status: number; stdout: string; stderr: string; projectFlags: string[]; log: string; dockerEnv: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'simplecrm-fakedocker-'));
  try {
    const logPath = join(dir, 'docker.log');
    const fakeDocker = join(dir, 'docker');
    writeFileSync(
      fakeDocker,
      [
        '#!/bin/sh',
        'echo "$*" >> "$DOCKER_LOG"',
        // Which image tag variable each docker call sees (docker-compose.yml: simplecrm/api:${VERSION:-dev}).
        'echo "VERSION=${VERSION-<unset>}" >> "$DOCKER_LOG.env"',
        // `compose ls` -> a table header plus one row per configured fake stack.
        'case "$*" in',
        "  *\"compose ls\"*) printf 'NAME STATUS CONFIG\\n'; for p in $FAKE_STACKS; do printf '%s running x\\n' \"$p\"; done; exit 0 ;;",
        '  *"ps -q api"*) echo "fakeapi"; exit 0 ;;',
        // update.sh asks the backups volume for the dump it just wrote.
        "  *'db-*.dump'*) echo \"${FAKE_BACKUP_DUMP:-}\"; exit 0 ;;",
        'esac',
        // restore-compose.sh and update.sh probe `docker inspect` for health.
        'case "$1" in inspect) echo "${FAKE_API_HEALTH:-healthy}"; exit 0 ;; esac',
        // Optionally fail the image build (a failure before the migrations).
        'if [ -n "${FAKE_FAIL_BUILD:-}" ]; then case "$*" in *" build"*) exit 1 ;; esac; fi',
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
      cwd: options.cwd ?? repoRoot,
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
    const dockerEnv = existsSync(`${logPath}.env`) ? readFileSync(`${logPath}.env`, 'utf8').split('\n').filter(Boolean) : [];
    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', projectFlags, log, dockerEnv };
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

describe('several compose files (SMTP relay override)', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };

  // N-int-01: update, restore und der Wrapper nutzten nur die Basisdatei; mit aktivem Relay-Override verlor die API bei jedem Update die Relay-Ports und das TLS-Material.
  test('a colon-separated COMPOSE_FILE reaches every compose call as separate -f flags', ranOrSkipped(() => {
    const base = join(repoRoot, 'docker', 'docker-compose.yml');
    const relay = join(repoRoot, 'docker', 'docker-compose.relay.yml');
    const env = { COMPOSE_FILE: `${base}:${relay}` };
    for (const args of [
      ['docker/simplecrm', 'ps'],
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      ['docker/simplecrm', 'restore'],
    ]) {
      const res = runWithFakeDocker(args, { env });
      expect(res.status).toBe(0);
      const composeCalls = res.log.split('\n').filter((line) => line.startsWith('compose -p'));
      expect(composeCalls.length).toBeGreaterThan(0);
      for (const line of composeCalls) {
        expect(line).toContain(`--project-directory ${join(repoRoot, 'docker')} -f ${base} -f ${relay} `);
      }
      expect(new Set(res.projectFlags)).toEqual(new Set(['docker']));
    }
  }));

  test('update warns when the relay is enabled but its override is not part of COMPOSE_FILE', ranOrSkipped(() => {
    const relay = join(repoRoot, 'docker', 'docker-compose.relay.yml');
    const base = join(repoRoot, 'docker', 'docker-compose.yml');
    const missing = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { SMTP_RELAY_ENABLED: 'true' } },
    );
    expect(missing.status).toBe(0);
    expect(missing.stderr).toContain('COMPOSE_FILE does not include docker-compose.relay.yml');

    const included = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { SMTP_RELAY_ENABLED: 'true', COMPOSE_FILE: `${base}:${relay}` } },
    );
    expect(included.status).toBe(0);
    expect(included.stderr).not.toContain('docker-compose.relay.yml');
  }));
});

describe('TRUST_PROXY preflight', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };

  // Merge von PR #192: Die API lehnt Hop-Zahlen wie TRUST_PROXY=1 jetzt beim Start ab. Ein Update mit dieser alten .env-Zeile haette die API in eine Neustartschleife geschickt.
  test('update stops before touching the stack when TRUST_PROXY is an old hop count', ranOrSkipped(() => {
    const blocked = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { env: { TRUST_PROXY: '1' } });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('TRUST_PROXY=1');
    expect(blocked.log).not.toContain(' build');
    expect(blocked.log).not.toContain('stop api');

    const ok = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { env: { TRUST_PROXY: '172.31.255.2' } });
    expect(ok.status).toBe(0);
  }));
});

describe('API volume ownership after the switch to a non-root image', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };
  const ownershipFix = /run --rm --no-deps --user root --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint sh api -c find \/app\/data\/attachments \/app\/data\/audit-archive \/app\/data\/logs .* -exec chown -h node:node/;

  // F-A12-07: Das API-Image laeuft jetzt als node; Volumes aelterer root-Versionen (und frisch restaurierte Anhaenge) gehoerten root, die API konnte dort nicht schreiben.
  test('update hands the writable volumes to node after building and before restarting the API', ranOrSkipped(() => {
    const update = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup']);
    expect(update.status).toBe(0);
    const lines = update.log.split('\n');
    const fix = lines.findIndex((line) => ownershipFix.test(line));
    expect(fix).toBeGreaterThan(lines.findIndex((line) => line.endsWith(' build')));
    expect(fix).toBeLessThan(lines.findIndex((line) => line.endsWith('up -d api caddy')));
  }));

  // F-A12-07 (Nachtrag): Seit dem Wechsel auf node liest das Relay seinen TLS-Schluessel als uid 1000; ein root-only key.pem schaltete das Relay nach dem Update still ab.
  test('update warns when the relay TLS key is not readable for the node user', ranOrSkipped(() => {
    const dir = mkdtempSync(join(tmpdir(), 'simplecrm-relay-tls-'));
    try {
      const key = join(dir, 'key.pem');
      writeFileSync(key, 'not a real key\n');
      chmodSync(key, 0o600);
      const warned = runWithFakeDocker(
        ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
        { env: { SMTP_RELAY_TLS_DIR: dir } },
      );
      expect(warned.status).toBe(0);
      expect(warned.stderr).toContain(`${key} is not readable for uid 1000`);

      chmodSync(key, 0o644);
      const readable = runWithFakeDocker(
        ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
        { env: { SMTP_RELAY_TLS_DIR: dir } },
      );
      expect(readable.status).toBe(0);
      expect(readable.stderr).not.toContain('is not readable for uid 1000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }));

  test('restore hands restored attachments to node before restarting the API', ranOrSkipped(() => {
    const restore = runWithFakeDocker(['docker/simplecrm', 'restore']);
    expect(restore.status).toBe(0);
    const lines = restore.log.split('\n');
    const fix = lines.findIndex((line) => ownershipFix.test(line));
    expect(fix).toBeGreaterThan(lines.findIndex((line) => line.includes('--profile restore run --rm restore')));
    expect(fix).toBeLessThan(lines.findIndex((line) => line.endsWith('up -d api caddy')));
  }));
});

describe('update: fixed release, health check and the way back', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args,
  ], { cwd, encoding: 'utf8' }).trim();

  /**
   * A server checkout as operators have it: a clone of an origin with release
   * tags. Every commit carries the real update scripts, only a marker changes.
   */
  function serverCheckout(tags: readonly string[]): { root: string; checkout: string; commitOf: Record<string, string> } {
    const root = mkdtempSync(join(tmpdir(), 'simplecrm-update-tags-'));
    const origin = join(root, 'origin');
    execFileSync('mkdir', ['-p', join(origin, 'docker')]);
    git(origin, 'init', '-q');
    writeFileSync(join(origin, 'docker', 'update.sh'), readFileSync(join(repoRoot, 'docker', 'update.sh')));
    writeFileSync(join(origin, 'docker', 'simplecrm'), readFileSync(join(repoRoot, 'docker', 'simplecrm')));
    const commitOf: Record<string, string> = {};
    for (const tag of tags) {
      writeFileSync(join(origin, 'marker.txt'), `${tag}\n`);
      git(origin, 'add', '-A');
      git(origin, 'commit', '-q', '-m', tag);
      git(origin, 'tag', tag);
      commitOf[tag] = git(origin, 'rev-parse', '--short', 'HEAD');
    }
    writeFileSync(join(origin, 'marker.txt'), 'main\n');
    git(origin, 'commit', '-q', '-am', 'unreleased work on main');
    const checkout = join(root, 'checkout');
    git(root, 'clone', '-q', '--no-tags', origin, checkout);
    return { root, checkout, commitOf };
  }

  test('--version latest checks out the highest release tag (numeric, no pre-releases)', ranOrSkipped(() => {
    const { root, checkout, commitOf } = serverCheckout(['v1.2.0', 'v1.10.0', 'v1.9.0', 'v2.0.0-rc1']);
    try {
      const run = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'latest', '--no-backup'], { cwd: checkout });
      expect(run.status).toBe(0);
      expect(git(checkout, 'rev-parse', '--short', 'HEAD')).toBe(commitOf['v1.10.0']);
      expect(readFileSync(join(checkout, 'marker.txt'), 'utf8')).toBe('v1.10.0\n');
      expect(run.stdout).toContain('Updating source to release v1.10.0');
      expect(run.stdout).toContain(`-> ${commitOf['v1.10.0']} (v1.10.0)`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }));

  // Gatekeeper PR #195: VERSION ist in docker-compose.yml der Image-Tag (simplecrm/api:${VERSION:-dev}) und
  // wird der API übergeben. Der Release-Wunsch darf ihn weder setzen noch aus ihm gelesen werden.
  test('--version never leaks into the image tag; an operator VERSION stays the image tag', ranOrSkipped(() => {
    const { root, checkout, commitOf } = serverCheckout(['v1.0.9', 'v1.1.0']);
    try {
      const release = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.0.9', '--no-backup'], { cwd: checkout });
      expect(release.status).toBe(0);
      expect(git(checkout, 'rev-parse', '--short', 'HEAD')).toBe(commitOf['v1.0.9']);
      expect(release.dockerEnv.length).toBeGreaterThan(0);
      expect(new Set(release.dockerEnv)).toEqual(new Set(['VERSION=<unset>']));

      // Operator pins the image tag in the shell; the update follows main as before.
      const imageTag = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { env: { VERSION: 'prod-2026' } });
      expect(imageTag.status).toBe(0);
      expect(new Set(imageTag.dockerEnv)).toEqual(new Set(['VERSION=prod-2026']));

      // Both at once: release from --version, image tag from the operator.
      const both = runWithFakeDocker(
        ['docker/simplecrm', 'update', '--version', 'v1.1.0', '--no-backup'],
        { cwd: checkout, env: { VERSION: 'prod-2026' } },
      );
      expect(both.status).toBe(0);
      expect(git(checkout, 'rev-parse', '--short', 'HEAD')).toBe(commitOf['v1.1.0']);
      expect(new Set(both.dockerEnv)).toEqual(new Set(['VERSION=prod-2026']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }));

  test('--version vX.Y.Z checks out exactly that release; unknown or malformed tags stop before Docker', ranOrSkipped(() => {
    const { root, checkout, commitOf } = serverCheckout(['v1.0.9', 'v1.1.0']);
    try {
      const exact = runWithFakeDocker(['docker/simplecrm', 'update', '--version=v1.0.9', '--no-backup'], { cwd: checkout });
      expect(exact.status).toBe(0);
      expect(git(checkout, 'rev-parse', '--short', 'HEAD')).toBe(commitOf['v1.0.9']);

      const unknown = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v9.9.9', '--no-backup'], { cwd: checkout });
      expect(unknown.status).not.toBe(0);
      expect(unknown.log).not.toContain(' build');
      // Nichts wurde verändert: kein Hinweis auf einen Weg zurück.
      expect(unknown.stderr).not.toContain('Update stopped during');
      expect(git(checkout, 'rev-parse', '--short', 'HEAD')).toBe(commitOf['v1.0.9']);

      const malformed = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'main;rm', '--no-backup'], { cwd: checkout });
      expect(malformed.status).toBe(2);
      expect(malformed.stderr).toContain('--version must be a release tag');
      expect(malformed.log).not.toMatch(/ build| run | up -d/);

      const combined = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0', '--branch', 'main'], { cwd: checkout });
      expect(combined.status).toBe(2);
      expect(combined.log).not.toMatch(/ build| run | up -d/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }));

  test('waits for a healthy API; an unhealthy new version fails and prints the way back with the backup', ranOrSkipped(() => {
    const dump = '/backups/db-2026-09-26T16-00-00Z.dump';
    const ok = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull'], { env: { FAKE_BACKUP_DUMP: dump } });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(`Pre-update backup: ${dump}`);
    const lines = ok.log.split('\n');
    expect(lines.findIndex((line) => line.startsWith('inspect')))
      .toBeGreaterThan(lines.findIndex((line) => line.endsWith('up -d api caddy')));

    const unhealthy = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull'],
      { env: { FAKE_BACKUP_DUMP: dump, FAKE_API_HEALTH: 'unhealthy', UPDATE_API_HEALTH_TIMEOUT_SECONDS: '0' } },
    );
    expect(unhealthy.status).not.toBe(0);
    expect(unhealthy.stderr).toContain('the API did not become healthy');
    expect(unhealthy.stderr).toContain('Update stopped during: verify');
    expect(unhealthy.stderr).toContain(`simplecrm" restore ${dump}`);
    expect(unhealthy.stdout).not.toContain('Update complete');
  }));

  // Codex-Review PR #195: Die Befehle für den Weg zurück müssen denselben Stack treffen wie das Update.
  test('the way back keeps the compose project and every compose file', ranOrSkipped(() => {
    const composeFile = `${repoRoot}/docker/docker-compose.yml:${repoRoot}/docker/docker-compose.relay.yml`;
    const env = { COMPOSE_PROJECT_NAME: 'prod42', COMPOSE_FILE: composeFile };
    const selection = `COMPOSE_PROJECT_NAME="prod42" COMPOSE_FILE="${composeFile}"`;

    const beforeMigrations = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { ...env, FAKE_FAIL_BUILD: '1' } },
    );
    expect(beforeMigrations.status).not.toBe(0);
    expect(beforeMigrations.stderr).toContain('Update stopped during: build');
    expect(beforeMigrations.stderr).toContain(`${selection} SKIP_PULL=1 SKIP_BACKUP=1 sh "${repoRoot}/docker/update.sh"`);

    const afterMigrations = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { ...env, FAKE_FAIL_MIGRATE: '1' } },
    );
    expect(afterMigrations.stderr).toContain(`${selection} docker compose -p "prod42"`);
    expect(afterMigrations.stderr).toContain(`${selection} sh "${repoRoot}/docker/simplecrm" restore`);
  }));

  test('a failure before the migrations only asks to rebuild the previous commit', ranOrSkipped(() => {
    const failed = runWithFakeDocker(
      ['docker/simplecrm', 'update', '--no-pull', '--no-backup'],
      { env: { FAKE_FAIL_MIGRATE: '1' } },
    );
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('Update stopped during: migrate');
    expect(failed.stderr).toContain('restore /backups/db-<stamp>.dump');

    const preflight = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { env: { TRUST_PROXY: '1' } });
    expect(preflight.status).toBe(4);
    expect(preflight.stderr).not.toContain('Update stopped during');
  }));
});
