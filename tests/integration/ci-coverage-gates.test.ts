import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('CI coverage gates', () => {
  test('build-and-test runs all three coverage ratchets', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(workflow.includes('check-mail-coverage-ratchet.mjs') || workflow.includes('test:mail:coverage:check')).toBe(true);
    expect(workflow).toContain('check-server-coverage-ratchet.mjs');
    expect(workflow.includes('check-ui-coverage-ratchet.mjs') || workflow.includes('test:ui:coverage:check')).toBe(true);
  });

  test('test:mail:coverage:check ends with the mail ratchet', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:mail:coverage:check']).toMatch(/node scripts\/check-mail-coverage-ratchet\.mjs$/);
  });
});
