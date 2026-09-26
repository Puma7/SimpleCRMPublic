import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// Die Jobs und ihre Schritte als Textbloecke: `  <job>:` auf Ebene 2 unter
// `jobs:`, Schritte als `      - ` auf Ebene 6.
function releaseJobs(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const jobs = new Map<string, string>();
  for (const block of body.split(/^(?= {2}[a-z0-9-]+:$)/m)) {
    const name = /^ {2}([a-z0-9-]+):$/m.exec(block)?.[1];
    if (name) jobs.set(name, block);
  }
  return jobs;
}

function jobSteps(job: string): string[] {
  return job.split(/^(?= {6}- )/m).slice(1);
}

function readWorkflow(name: string): string {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8');
}

// Die Dateien, die electron-updater je Plattform im Release erwartet: die
// Update-Metadaten (latest*.yml), die Installer bzw. Archive, auf die sie
// verweisen, und deren .blockmap fuer den differenziellen Download.
function expectedUpdaterAssets(): { windows: string[]; macos: string[] } {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    build: { win: { target: string | Array<string | { target: string }> }; mac: { target: Array<string | { target: string }> } };
  };
  const targets = (value: string | Array<string | { target: string }>) =>
    (Array.isArray(value) ? value : [value]).map((entry) => (typeof entry === 'string' ? entry : entry.target));
  const extensions: Record<string, string> = { nsis: 'exe', dmg: 'dmg', zip: 'zip' };
  const files = (manifest: string, list: string[]) => [
    manifest,
    ...list.flatMap((target) => {
      const ext = extensions[target];
      if (!ext) throw new Error(`unbekanntes electron-builder-Target ${target}`);
      return [`*.${ext}`, `*.${ext}.blockmap`];
    }),
  ];
  return {
    windows: files('latest.yml', targets(pkg.build.win.target)),
    macos: files('latest-mac.yml', targets(pkg.build.mac.target)),
  };
}

function uploadedPaths(job: string): string[] {
  const step = jobSteps(job).find((candidate) => candidate.includes('uses: actions/upload-artifact@'));
  if (!step) return [];
  const block = /^ {10}path: \|\n((?: {12}.+\n?)+)/m.exec(step)?.[1] ?? '';
  return block.split('\n').map((line) => line.trim()).filter(Boolean);
}

describe('release workflow hardening', () => {
  // F-A12-04: Der ganze Release-Workflow lief mit contents:write, und actions/checkout legte das Token in .git/config ab, lesbar fuer jedes Install- und Build-Skript.
  test('grants contents:write only per job and keeps the token out of install and build steps', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');

    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);

    const jobs = releaseJobs(workflow);
    expect([...jobs.keys()]).toEqual(['create-release', 'build-windows', 'build-macos', 'publish-release']);
    for (const [name, job] of jobs) {
      const steps = jobSteps(job);
      const tokenSteps = steps.filter((step) => step.includes('${{ secrets.GITHUB_TOKEN }}'));
      // Schreibrecht nur dort, wo ein Schritt tatsaechlich veroeffentlicht.
      expect({ name, write: /^ {4}permissions:\n {6}contents: write$/m.test(job) })
        .toEqual({ name, write: tokenSteps.length > 0 });
      for (const step of tokenSteps) {
        expect(step).toMatch(/- name: .*(publish|release)/i);
      }
      for (const step of steps.filter((candidate) => candidate.includes('uses: actions/checkout@'))) {
        expect(step).toMatch(/^ {10}persist-credentials: false$/m);
      }
    }
  });

  // F-A12-04: Der Build-Schritt (vite, tsc, electron-builder samt Abhaengigkeiten) bekam GH_TOKEN, weil electron-builder selbst veroeffentlichte.
  test('builds without any token and hands the updater files to a separate publish job', () => {
    const workflow = readWorkflow('release.yml');
    const jobs = releaseJobs(workflow);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['electron:build:runtime']).toMatch(/electron-builder --publish never$/);

    const expected = expectedUpdaterAssets();
    for (const [name, platform] of [['build-windows', 'windows'], ['build-macos', 'macos']] as const) {
      const job = jobs.get(name) ?? '';
      expect({ name, secrets: /secrets\.|GH_TOKEN|GITHUB_TOKEN/.test(job) }).toEqual({ name, secrets: false });
      expect({ name, write: /contents: write/.test(job) }).toEqual({ name, write: false });
      expect(job).not.toContain('electron:publish');
      expect(jobSteps(job).some((step) => /^ {8}run: pnpm run electron:build$/m.test(step))).toBe(true);
      expect(uploadedPaths(job).map((path) => path.replace(/^dist-build\//, '')).sort())
        .toEqual([...expected[platform]].sort());
    }

    const publish = jobs.get('publish-release') ?? '';
    expect(publish).toMatch(/^ {4}needs: \[build-windows, build-macos\]$/m);
    expect(publish).toMatch(/^ {4}permissions:\n {6}contents: write$/m);
    const steps = jobSteps(publish);
    const download = steps.findIndex((step) => step.includes('uses: actions/download-artifact@'));
    const upload = steps.findIndex((step) => /gh release upload /.test(step));
    const release = steps.findIndex((step) => /draft: false/.test(step));
    expect(download).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(download);
    expect(release).toBeGreaterThan(upload);
  });

  // F-A12-04: Actions waren nur per Tag referenziert; wer einen Tag einer Action verschiebt, laeuft im Release mit contents:write.
  test.each(['release.yml', 'ci.yml'])('pins every action in %s to a commit SHA with a version comment', (file) => {
    const uses = readWorkflow(file).split('\n').filter((line) => /^\s*(- )?uses: /.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/);
    }
  });
});
