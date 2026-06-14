import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const bashAvailable = () => spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;

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
    expect(help).toEqual(expect.stringContaining('COMPOSE_PROJECT_NAME=simplecrm'));
  });
});
