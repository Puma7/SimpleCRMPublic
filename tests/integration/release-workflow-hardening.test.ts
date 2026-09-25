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
});
