import { main, writeRefusal } from './measure-coverage';

// CAMP-262 — `--write` rewrites the snapshot next to the script. Run from a
// compiled build on the server, "next to the script" is `dist/planner/` inside
// a live release, and the next deploy rebuilds the release from git: the
// write is taken back without a word, after a run that printed "wrote" and
// exited 0. Measured 15.10.2026 on a copy of `dist/`: `node
// dist/planner/measure-coverage.js --write` exit 0, snapshot rewritten.
//
// The directories below are written out as paths, not derived from
// __dirname's own answer, so a refusal that keyed on the wrong thing cannot
// agree with itself.

const SOURCE = '/work/camp/apps/api/src/planner';
const RELEASE = '/srv/camptribe/releases/ba808ed/apps/api/dist/planner';

describe('writeRefusal', () => {
  it('lets the repository write its own snapshot', () => {
    expect(writeRefusal(SOURCE)).toBeUndefined();
  });

  it('refuses a compiled build in a release, and says where to run it instead', () => {
    const why = writeRefusal(RELEASE);
    expect(why).toContain('--write refuses to run from ' + RELEASE);
    expect(why).toContain(
      'npx ts-node src/planner/measure-coverage.ts --write',
    );
  });

  it('refuses any directory that is not a src/ one, not only dist', () => {
    for (const dir of [
      '/srv/camptribe/current/apps/api/dist/planner',
      '/work/camp/apps/api/build/planner',
      '/work/camp/apps/api/planner',
      '/planner',
      '/',
    ]) {
      expect(writeRefusal(dir)).toMatch(/refuses/);
    }
  });

  it('is decided by the directory the snapshot sits in — the real one, here, is the repository', () => {
    // Under ts-jest this file's own neighbour is src/planner. If this ever
    // fails the spec is being run from a build, and that is worth knowing.
    expect(writeRefusal()).toBeUndefined();
  });
});

describe('the command line', () => {
  const realUrl = process.env.DATABASE_URL;
  let err: jest.SpyInstance;
  let log: jest.SpyInstance;
  beforeEach(() => {
    // Nothing it could reach, even if the guard were gone: a refused
    // connection to port 1 is an error, not a snapshot.
    process.env.DATABASE_URL = 'postgres://127.0.0.1:1/never';
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (realUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = realUrl;
    err.mockRestore();
    log.mockRestore();
  });

  it('--write from a release exits 2 with the reason, before any database is opened', async () => {
    // Had it reached the database, the closed port would have made this
    // REJECT. Resolving 2 is the proof that it stopped first.
    await expect(main(['--write'], RELEASE)).resolves.toBe(2);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('--write refuses to run from ' + RELEASE),
    );
  });

  it('--check from a release is NOT refused: it goes on and meets the database, which is what the timer needs', async () => {
    await expect(main(['--check'], RELEASE)).rejects.toThrow(
      /ECONNREFUSED|connect/i,
    );
  });

  it('--write from the repository is not refused either: it goes on to the database', async () => {
    await expect(main(['--write'], SOURCE)).rejects.toThrow(
      /ECONNREFUSED|connect/i,
    );
  });

  it('an unknown flag is still exit 2 with the usage line', async () => {
    await expect(main(['--no-such-flag'], SOURCE)).resolves.toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^usage: /));
  });
});
