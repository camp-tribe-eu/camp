import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// CAMP-262 — the drift detector has to run SOMEWHERE.
//
// `measure-coverage.ts --check` is the only thing that notices the committed
// coverage table has stopped being true, and on 15.10.2026 nothing called it:
// `grep measure-coverage` over .github/, infra/, scripts/ and package.json
// gave zero. A snapshot nobody compares is a file, not a detector.
//
// CI cannot run it — CI's database is a fixture of 72 campsites, and a table
// of 52 501 would drift from it on the first call. The machine that holds the
// real database runs it, from a systemd timer in infra/, and these tests read
// THAT unit, as it will be laid down, not a constant in this file.

const REPO = join(__dirname, '..', '..', '..', '..');
const API = join(REPO, 'apps', 'api');
const SERVICE = 'camptribe-coverage-drift.service';
const TIMER = 'camptribe-coverage-drift.timer';
const unitPath = (name: string): string => join(REPO, 'infra', 'systemd', name);
// A missing unit reads as empty, so every test below FAILS by assertion. A
// read that threw at describe time would be a suite that "failed to run",
// which prints the same as a mutation caught and proves nothing about which.
const unit = (name: string): string =>
  existsSync(unitPath(name)) ? readFileSync(unitPath(name), 'utf8') : '';

/** What systemd would read: no comments, no blank lines. */
const directives = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

describe('the coverage-drift unit that runs the detector on the machine', () => {
  const service = directives(unit(SERVICE));

  it('is in the repository, where deploy-infra.sh lays it down from', () => {
    expect(existsSync(unitPath(SERVICE))).toBe(true);
    expect(existsSync(unitPath(TIMER))).toBe(true);
  });

  it('runs the checker with --check, once, and nothing else', () => {
    expect(service.filter((l) => l.startsWith('ExecStart='))).toEqual([
      'ExecStart=/usr/bin/node dist/planner/measure-coverage.js --check',
    ]);
  });

  it('never writes: a --write on the machine would rewrite the snapshot inside a release the next deploy replaces', () => {
    expect(service.length).toBeGreaterThan(5); // anchor: the unit was read
    expect(service.filter((l) => l.includes('--write'))).toEqual([]);
  });

  it('works from the release and reads the database from the release’s .env', () => {
    expect(service).toContain(
      'WorkingDirectory=/srv/camptribe/current/apps/api',
    );
    expect(service).toContain(
      'EnvironmentFile=/srv/camptribe/current/apps/api/.env',
    );
  });

  it('leaves a trace when it fails and removes only its own trace when it passes', () => {
    expect(service).toContain('OnFailure=camptribe-failed@%n.service');
    expect(service).toContain(
      `ExecStartPost=/bin/rm -f /srv/camptribe/failed/${SERVICE}`,
    );
  });

  it('is a one-shot, so a failed check is a failed unit and not a running one', () => {
    expect(service).toContain('Type=oneshot');
  });
});

describe('the timer that fires it', () => {
  const timer = directives(unit(TIMER));

  it('has a calendar, catches up after a night the machine was off, and is enabled by the deploy script', () => {
    expect(timer.some((l) => /^OnCalendar=\S/.test(l))).toBe(true);
    expect(timer).toContain('Persistent=true');
    // deploy-infra.sh enables `camptribe-*.timer`: a timer that is not
    // WantedBy timers.target is copied and never scheduled.
    expect(timer).toContain('WantedBy=timers.target');
  });
});

describe('the command the unit names is a live entry point', () => {
  const exec = directives(unit(SERVICE)).find((l) =>
    l.startsWith('ExecStart='),
  );
  const compiled = /ExecStart=\S*node (\S+\.js)/.exec(exec ?? '')?.[1];

  it('names a compiled file whose source is in the repository', () => {
    expect(compiled).toMatch(/^dist\/planner\/[\w-]+\.js$/);
    const source = join(
      API,
      compiled.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'),
    );
    expect(existsSync(source)).toBe(true);
  });

  it('does something when started: an unknown flag is refused with exit 2, not ignored with exit 0', () => {
    // A module that only defines functions would also "run" under node and
    // exit 0 without a word — a detector that is scheduled, enabled, and
    // silent. So the unit's own script is started for real, with a flag it
    // must refuse, and it must refuse BEFORE connecting to any database.
    const source = join(
      API,
      compiled.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'),
    );
    let status: number | null = null;
    let stderr = '';
    try {
      execFileSync(
        process.execPath,
        ['-r', 'ts-node/register', source, '--no-such-flag'],
        {
          cwd: API,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          // Nothing it could reach, even if it ignored the flag.
          env: {
            ...process.env,
            NODE_OPTIONS: '',
            DATABASE_URL: 'postgres://127.0.0.1:1/never',
          },
          timeout: 60_000,
        },
      );
      status = 0;
    } catch (e) {
      const err = e as { status: number | null; stderr: string };
      status = err.status;
      stderr = String(err.stderr);
    }
    expect(stderr).toMatch(/^usage: measure-coverage\.ts/m);
    expect(status).toBe(2);
  });
});
