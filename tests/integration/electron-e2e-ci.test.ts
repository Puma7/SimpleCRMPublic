import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('Electron E2E CI gate', () => {
  test('runs the desktop suite on the pinned Ubuntu image with the Chromium sandbox', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(workflow).toContain('electron-e2e:');
    expect(workflow).toMatch(/electron-e2e:\s*\n\s+runs-on: ubuntu-22\.04/);
    expect(workflow).toMatch(/xvfb-run --auto-servernum .*pnpm run test:e2e/);
    expect(workflow).toContain('CC: gcc-12');
    expect(workflow).toContain('CXX: g++-12');
    expect(workflow).toContain('CXXFLAGS: "-UV8_DEPRECATION_WARNINGS"');
    expect(workflow).toContain('node_modules/electron/dist/chrome-sandbox');
    expect(workflow).toContain('gcc-12 \\');
    expect(workflow).toContain('g++-12 \\');
    expect(workflow).toContain('libsecret-1-0');
    expect(workflow).toContain('actions/upload-artifact@v4');
  });

  test('keeps no-sandbox opt-in and writes durable Electron diagnostics', () => {
    const helper = readFileSync(join(root, 'tests', 'e2e', 'helpers', 'electron-session.ts'), 'utf8');
    const config = readFileSync(join(root, 'tests', 'e2e', 'playwright.electron.config.ts'), 'utf8');

    expect(helper).toContain("process.env.SIMPLECRM_E2E_NO_SANDBOX === '1'");
    expect(helper).toContain('electron-logs');
    expect(helper).toContain("page.on('pageerror'");
    expect(config).toContain("['html'");
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(config).toContain("screenshot: 'only-on-failure'");
    expect(config).toContain("video: 'retain-on-failure'");
  });

  test('includes the atomic task and calendar desktop scenario', () => {
    const config = readFileSync(join(root, 'tests', 'e2e', 'playwright.electron.config.ts'), 'utf8');
    const scenario = readFileSync(join(root, 'tests', 'e2e', 'atomic-task-calendar.spec.ts'), 'utf8');

    expect(config).toContain("'atomic-task-calendar.spec.ts'");
    expect(scenario).toContain('tasks:get-all');
    expect(scenario).toContain('db:updateCalendarEvent');
    expect(scenario).toContain("mode: 'none'");
    expect(scenario).toContain('tasks:delete');
  });
});
