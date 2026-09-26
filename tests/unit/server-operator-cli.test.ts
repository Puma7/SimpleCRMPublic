import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => process.platform !== 'win32'
  && spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

// A fake `docker` on PATH that records every argv and keeps a tiny image store
// (tag -> id, which image each service container runs) in FAKE_STORE, so the
// update's generations, cleanup and rollback can be checked without Docker.
// `compose build` creates new ids for the compose tags, `compose up -d api
// caddy` starts containers from them. A fake `df` reports FAKE_DF_FREE_KB
// (FAKE_DF_FREE_KB_AFTER_PRUNE once the build cache was pruned).
const FAKE_DOCKER = readFileSync(join(repoRoot, 'tests', 'fixtures', 'operator-cli', 'fake-docker.sh'), 'utf8');

const FAKE_DF = readFileSync(join(repoRoot, 'tests', 'fixtures', 'operator-cli', 'fake-df.sh'), 'utf8');

const GB_KB = 1024 * 1024;

type FakeDockerRun = {
  status: number;
  stdout: string;
  stderr: string;
  projectFlags: string[];
  log: string;
  dockerEnv: string[];
  /** Image store after the run: ref -> id. */
  images: Record<string, string>;
  /** Contents of the update state files (by file name). */
  stateFiles: Record<string, string>;
};

/** Persistent fake Docker host for several runs (images, running containers, update state). */
function fakeHost(seed: { images?: Record<string, string>; running?: { api?: string; caddy?: string } } = {}): string {
  const store = mkdtempSync(join(tmpdir(), 'simplecrm-fakehost-'));
  writeFileSync(join(store, 'images'), Object.entries(seed.images ?? {}).map(([ref, id]) => `${ref} ${id}\n`).join(''));
  const running = [
    seed.running?.api ? `api ${seed.running.api}\n` : '',
    seed.running?.caddy ? `caddy ${seed.running.caddy}\n` : '',
  ].join('');
  writeFileSync(join(store, 'running'), running);
  return store;
}

function runWithFakeDocker(
  args: readonly string[],
  options: { env?: Record<string, string>; stacks?: readonly string[]; cwd?: string; host?: string } = {},
): FakeDockerRun {
  const dir = mkdtempSync(join(tmpdir(), 'simplecrm-fakedocker-'));
  const store = options.host ?? join(dir, 'host');
  if (!options.host) mkdirSync(store);
  try {
    const logPath = join(dir, 'docker.log');
    writeFileSync(join(dir, 'docker'), FAKE_DOCKER);
    chmodSync(join(dir, 'docker'), 0o755);
    writeFileSync(join(dir, 'df'), FAKE_DF);
    chmodSync(join(dir, 'df'), 0o755);

    const result = spawnSync('bash', args.slice(), {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        DOCKER_LOG: logPath,
        FAKE_STORE: store,
        FAKE_STACKS: (options.stacks ?? []).join(' '),
        FAKE_DF_FREE_KB: String(50 * GB_KB),
        SIMPLECRM_STATE_DIR: join(store, 'state'),
        ...(options.env ?? {}),
      },
      input: '',
      encoding: 'utf8',
    });

    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const projectFlags = [...log.matchAll(/compose -p (\S+)/g)].map((m) => m[1] ?? '');
    const dockerEnv = existsSync(`${logPath}.env`) ? readFileSync(`${logPath}.env`, 'utf8').split('\n').filter(Boolean) : [];
    const images = Object.fromEntries(
      (existsSync(join(store, 'images')) ? readFileSync(join(store, 'images'), 'utf8') : '')
        .split('\n').filter(Boolean).map((line) => line.split(' ') as [string, string]),
    );
    const stateDir = join(store, 'state');
    const stateFiles = Object.fromEntries(
      (existsSync(stateDir) ? readdirSync(stateDir) : []).map((name) => [name, readFileSync(join(stateDir, name), 'utf8')]),
    );
    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', projectFlags, log, dockerEnv, images, stateFiles };
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
    for (const name of ['update.sh', 'update-lib.sh', 'rollback.sh', 'restore-compose.sh', 'disk-report.sh', 'simplecrm']) {
      writeFileSync(join(origin, 'docker', name), readFileSync(join(repoRoot, 'docker', name)));
    }
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
    expect(lines.findIndex((line) => line.startsWith('inspect') && line.includes('.State.Health')))
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

/**
 * Speicherplatz und Rollback (PR #195, Messung auf dem Produktivserver: 17,5 GB
 * Build-Cache, Container-Logs ohne Grenze). Nach einem Update bleiben genau zwei
 * Generationen der eigenen Images; der Rollback nutzt die vorherige ohne Neubau
 * und das Backup von direkt vor dem Update.
 */
describe('update: image generations, rollback and disk space', () => {
  const ranOrSkipped = (fn: () => void) => () => {
    if (!bashAvailable()) return;
    fn();
  };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args,
  ], { cwd, encoding: 'utf8' }).trim();
  const running = { images: { 'simplecrm/api:dev': 'sha256:api0', 'simplecrm/web:dev': 'sha256:web0' }, running: { api: 'sha256:api0', caddy: 'sha256:web0' } };
  const gens = (images: Record<string, string>, repo: string) => Object.entries(images)
    .filter(([ref]) => ref.startsWith(`${repo}:gen-`)).map(([, id]) => id).sort();
  const stateOf = (run: FakeDockerRun, kind: 'state' | 'attempt') => {
    const text = run.stateFiles[`docker.${kind}`] ?? '';
    return Object.fromEntries(text.split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  };
  const destructive = /volume (rm|prune)|system prune|image prune (-a|--all)|image prune -f -a/;

  /** A server checkout (git clone) whose commits carry the real scripts. */
  function checkoutWithTags(tags: readonly string[]): { root: string; checkout: string; head: string } {
    const root = mkdtempSync(join(tmpdir(), 'simplecrm-rollback-'));
    const origin = join(root, 'origin');
    mkdirSync(join(origin, 'docker'), { recursive: true });
    git(origin, 'init', '-q');
    for (const name of ['update.sh', 'update-lib.sh', 'rollback.sh', 'restore-compose.sh', 'disk-report.sh', 'simplecrm']) {
      writeFileSync(join(origin, 'docker', name), readFileSync(join(repoRoot, 'docker', name)));
    }
    writeFileSync(join(origin, 'marker.txt'), 'installed\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'installed');
    for (const tag of tags) {
      writeFileSync(join(origin, 'marker.txt'), `${tag}\n`);
      git(origin, 'commit', '-q', '-am', tag);
      git(origin, 'tag', tag);
    }
    const checkout = join(root, 'checkout');
    git(root, 'clone', '-q', '--no-tags', origin, checkout);
    git(checkout, 'checkout', '-q', '--detach', git(origin, 'rev-list', '--max-parents=0', 'HEAD'));
    return { root, checkout, head: git(checkout, 'rev-parse', 'HEAD') };
  }

  test('each update keeps exactly the current and the previous generation; cleanup never touches volumes', ranOrSkipped(() => {
    const host = fakeHost(running);
    try {
      const first = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { host });
      expect(first.status).toBe(0);
      expect(gens(first.images, 'simplecrm/api')).toEqual(['sha256:api0', 'sha256:api1']);
      expect(first.images['simplecrm/api:dev']).toBe('sha256:api1');
      expect(first.images[stateOf(first, 'state').previous_api_image!]).toBe('sha256:api0');
      expect(first.images[stateOf(first, 'state').current_api_image!]).toBe('sha256:api1');
      expect(first.stateFiles['docker.attempt']).toBeUndefined();

      const second = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { host });
      const third = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { host });
      expect(second.status).toBe(0);
      expect(third.status).toBe(0);
      expect(gens(third.images, 'simplecrm/api')).toEqual(['sha256:api2', 'sha256:api3']);
      expect(gens(third.images, 'simplecrm/web')).toEqual(['sha256:web2', 'sha256:web3']);
      expect(third.images[stateOf(third, 'state').previous_web_image!]).toBe('sha256:web2');
      expect(third.images['postgres:18-alpine']).toBeUndefined();
      for (const run of [first, second, third]) {
        expect(run.log).not.toMatch(destructive);
        expect(run.log).toMatch(/builder prune -af --reserved-space 2gb/);
        expect(run.log).toMatch(/image prune -f --filter label=org\.simplecrm\.image/);
      }
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  }));

  test('a failed build keeps the running version, its images and the last rollback state', ranOrSkipped(() => {
    const host = fakeHost(running);
    try {
      const ok = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { host });
      const failed = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], { host, env: { FAKE_FAIL_BUILD: '1' } });
      expect(failed.status).not.toBe(0);
      expect(failed.stateFiles['docker.state']).toBe(ok.stateFiles['docker.state']);
      expect(stateOf(failed, 'attempt')).toMatchObject({ stage: 'build' });
      expect(failed.images['simplecrm/api:dev']).toBe('sha256:api1');
      expect(gens(failed.images, 'simplecrm/api')).toContain('sha256:api1');
      expect(failed.stderr).toContain('The database is unchanged');
      expect(failed.stderr).toContain('simplecrm" rollback');
      expect(failed.log).not.toMatch(destructive);
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  }));

  test('rollback after a failed migration: previous images, no rebuild, pre-update backup restored', ranOrSkipped(() => {
    const { root, checkout, head } = checkoutWithTags(['v1.1.0']);
    const host = fakeHost(running);
    const dump = '/backups/db-2026-09-26T16-00-00Z.dump';
    try {
      const failed = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0'], {
        cwd: checkout, host, env: { FAKE_BACKUP_DUMP: dump, FAKE_FAIL_MIGRATE: '1' },
      });
      expect(failed.status).not.toBe(0);
      expect(stateOf(failed, 'attempt')).toMatchObject({ stage: 'migrate', backup: dump, from_commit: head });
      expect(failed.images['simplecrm/api:dev']).toBe('sha256:api1');
      expect(failed.log).toMatch(/--entrypoint sh backup -c [\s\S]*\.protected-stamps" sh +2026-09-26T16-00-00Z$/m);

      const rollback = runWithFakeDocker(['docker/simplecrm', 'rollback', '--yes'], { cwd: checkout, host });
      expect(rollback.status).toBe(0);
      expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head);
      expect(rollback.images['simplecrm/api:dev']).toBe('sha256:api0');
      expect(rollback.images['simplecrm/web:dev']).toBe('sha256:web0');
      expect(rollback.stdout).toContain(`restored from ${dump}`);
      expect(rollback.log).toContain('--profile restore run --rm restore');
      expect(rollback.log).not.toMatch(/ build$/m);
      expect(rollback.stateFiles['docker.attempt']).toBeUndefined();
      expect(stateOf(rollback, 'state')).toMatchObject({ current_commit: head, previous_api_image: '' });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  }));

  // Nach einem Update, das nach seinen Migrationen scheiterte, ist der laufende
  // Stand nicht mehr der letzte gute. Ein erneuter Versuch darf das Rollback-Ziel
  // und dessen Sicherung (von vor den ersten Migrationen) nicht überschreiben.
  test('a second attempt after a failed one keeps the last good version and its pre-migration backup', ranOrSkipped(() => {
    const { root, checkout, head } = checkoutWithTags(['v1.1.0']);
    const host = fakeHost(running);
    const first = '/backups/db-2026-09-26T16-00-00Z.dump';
    const second = '/backups/db-2026-09-26T16-30-00Z.dump';
    try {
      runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0'], {
        cwd: checkout, host, env: { FAKE_BACKUP_DUMP: first, FAKE_API_HEALTH: 'unhealthy', UPDATE_API_HEALTH_TIMEOUT_SECONDS: '0' },
      });
      const again = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0'], {
        cwd: checkout, host, env: { FAKE_BACKUP_DUMP: second, FAKE_FAIL_MIGRATE: '1' },
      });
      expect(again.status).not.toBe(0);
      expect(again.stdout).toContain('An earlier update did not finish');
      expect(stateOf(again, 'attempt')).toMatchObject({ from_commit: head, backup: first });
      expect(again.images[stateOf(again, 'attempt').from_api_image!]).toBe('sha256:api0');
      expect(again.log).toMatch(/\.protected-stamps" sh +2026-09-26T16-00-00Z 2026-09-26T16-30-00Z$/m);

      const rollback = runWithFakeDocker(['docker/simplecrm', 'rollback', '--yes'], { cwd: checkout, host });
      expect(rollback.status).toBe(0);
      expect(rollback.images['simplecrm/api:dev']).toBe('sha256:api0');
      expect(rollback.stdout).toContain(`restored from ${first}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  }));

  test('rollback of a successful update: previous version plus the protected backup; asks first', ranOrSkipped(() => {
    const { root, checkout, head } = checkoutWithTags(['v1.1.0']);
    const host = fakeHost(running);
    const dump = '/backups/db-2026-09-26T17-00-00Z.dump';
    try {
      const updated = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0'], {
        cwd: checkout, host, env: { FAKE_BACKUP_DUMP: dump },
      });
      expect(updated.status).toBe(0);
      expect(stateOf(updated, 'state')).toMatchObject({ previous_commit: head, rollback_backup: dump, current_release: 'v1.1.0' });
      expect(updated.log).toMatch(/\.protected-stamps" sh 2026-09-26T17-00-00Z$/m);

      // Without a terminal and without --yes nothing happens.
      const unconfirmed = runWithFakeDocker(['docker/simplecrm', 'rollback'], { cwd: checkout, host });
      expect(unconfirmed.status).toBe(2);
      expect(unconfirmed.images['simplecrm/api:dev']).toBe('sha256:api1');
      expect(unconfirmed.stdout).toContain('Everything changed in SimpleCRM after that backup is lost');

      const rollback = runWithFakeDocker(['docker/simplecrm', 'rollback', '--yes'], { cwd: checkout, host });
      expect(rollback.status).toBe(0);
      expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head);
      expect(rollback.images['simplecrm/api:dev']).toBe('sha256:api0');
      expect(rollback.log).toContain('--profile restore run --rm restore');
      expect(rollback.log).not.toMatch(/ build$/m);

      const again = runWithFakeDocker(['docker/simplecrm', 'rollback', '--yes'], { cwd: checkout, host });
      expect(again.status).toBe(3);
      expect(again.stderr).toContain('Nothing to roll back to');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  }));

  test('rollback before the migrations only swaps the images back; the data stays', ranOrSkipped(() => {
    const { root, checkout, head } = checkoutWithTags(['v1.1.0']);
    const host = fakeHost(running);
    try {
      const failed = runWithFakeDocker(['docker/simplecrm', 'update', '--version', 'v1.1.0', '--no-backup'], {
        cwd: checkout, host, env: { FAKE_FAIL_BUILD: '1' },
      });
      expect(stateOf(failed, 'attempt')).toMatchObject({ stage: 'build' });
      const rollback = runWithFakeDocker(['docker/simplecrm', 'rollback', '--yes'], { cwd: checkout, host });
      expect(rollback.status).toBe(0);
      expect(rollback.stdout).toContain('Data:     unchanged');
      expect(rollback.log).not.toContain('--profile restore');
      expect(rollback.log).toMatch(/ up -d api caddy$/m);
      expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(host, { recursive: true, force: true });
    }
  }));

  test('too little space: the build cache goes first; still too little stops before any change', ranOrSkipped(() => {
    const blocked = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull'], {
      env: { FAKE_DF_FREE_KB: String(GB_KB), FAKE_DF_FREE_KB_AFTER_PRUNE: String(2 * GB_KB) },
    });
    expect(blocked.status).toBe(5);
    expect(blocked.stderr).toContain('Nothing was changed');
    expect(blocked.log).toContain('builder prune -af --reserved-space 0gb');
    expect(blocked.log).not.toMatch(/ build$|--rm backup$| up -d/m);
    expect(blocked.stateFiles).toEqual({});

    const freed = runWithFakeDocker(['docker/simplecrm', 'update', '--no-pull', '--no-backup'], {
      env: { FAKE_DF_FREE_KB: String(GB_KB), FAKE_DF_FREE_KB_AFTER_PRUNE: String(20 * GB_KB) },
    });
    expect(freed.status).toBe(0);
    const lines = freed.log.split('\n');
    expect(lines.findIndex((line) => line.includes('builder prune -af --reserved-space 0gb')))
      .toBeLessThan(lines.findIndex((line) => / build$/.test(line)));
  }));

  test('disk report: read-only overview with hints', ranOrSkipped(() => {
    const report = runWithFakeDocker(['docker/simplecrm', 'disk'], { env: { FAKE_DF_FREE_KB: String(GB_KB) } });
    expect(report.status).toBe(0);
    for (const heading of ['== Speicherplatz ==', '== Docker (Images, Container, Volumes, Build-Cache) ==', '== SimpleCRM-Versionen (Rollback) ==', '== Volumes ==', '== Datenbank ==', '== Logs ==', '== Hinweise ==']) {
      expect(report.stdout).toContain(heading);
    }
    expect(report.stdout).toContain('Nur 1.0 GB frei');
    expect(report.log).not.toMatch(/ rm |prune|tag /);
  }));
});

describe('backup retention keeps the protected rollback backup', () => {
  test('protected stamps survive, the rest follows the retention counts', () => {
    if (!bashAvailable()) return;
    const dir = mkdtempSync(join(tmpdir(), 'simplecrm-retention-'));
    try {
      const stamps = ['2026-09-20T01-00-00Z', '2026-09-21T01-00-00Z', '2026-09-22T01-00-00Z', '2026-09-23T01-00-00Z'];
      for (const stamp of [...stamps, '2020-01-01T01-00-00Z']) {
        writeFileSync(join(dir, `db-${stamp}.dump`), 'x');
        writeFileSync(join(dir, `attachments-${stamp}.tar`), 'x');
      }
      writeFileSync(join(dir, '.protected-stamps'), '2020-01-01T01-00-00Z\nnot-a-stamp\n');
      const result = spawnSync('sh', ['-c', '. docker/backup-retention.sh; prune_backup_retention "$1"', 'sh', dir], {
        cwd: repoRoot,
        env: { ...process.env, BACKUP_RETENTION_DAILY: '2', BACKUP_RETENTION_WEEKLY: '0', BACKUP_RETENTION_MONTHLY: '0' },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(readdirSync(dir).filter((name) => name.startsWith('db-')).sort()).toEqual([
        'db-2020-01-01T01-00-00Z.dump',
        'db-2026-09-22T01-00-00Z.dump',
        'db-2026-09-23T01-00-00Z.dump',
      ]);
      expect(existsSync(join(dir, 'attachments-2020-01-01T01-00-00Z.tar'))).toBe(true);
      expect(existsSync(join(dir, 'attachments-2026-09-20T01-00-00Z.tar'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
