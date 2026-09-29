import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

// CAMP-159 — every way of running the API's jest must go through the guard.
//
// 🔴 test/require-node-24.cjs turns "Must use import to load ES Module" into
// a message that says which Node and which flag. It only speaks on a jest
// run whose config names it as `globalSetup`, and the first version of this
// change named it in ONE of two configs. `npm run test:e2e` used the other,
// so on the one path the guard could not speak on, it produced exactly the
// raw error the guard exists to explain — on Node 24 as well as 22, because
// the script also lacked the flag. Nothing caught it: CI runs only
// `npm run test`, and the API lint and typecheck globs do not reach test/.
//
// So the property is checked where it can be: the configs and the scripts
// are read as data. A config added later is found by its name or by the
// `--config` flag of the script that runs it, and if it is not wired up
// this fails, instead of the next person meeting the raw error.

const API = join(__dirname, '..');
const GUARD = join(API, 'test', 'require-node-24.cjs');
const FLAG = 'NODE_OPTIONS=--experimental-vm-modules';

const pkg = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8'));

interface JestConfig {
  rootDir?: string;
  globalSetup?: string;
}

/** name -> [directory the config lives in, its contents] */
const configs = new Map<string, [string, JestConfig]>([
  ['package.json#jest', [API, pkg.jest]],
]);
for (const f of readdirSync(join(API, 'test'))) {
  if (!/^jest.*\.json$/.test(f)) continue;
  configs.set(`test/${f}`, [
    join(API, 'test'),
    JSON.parse(readFileSync(join(API, 'test', f), 'utf8')),
  ]);
}

/** Scripts that run the `jest` binary by name (test:debug's path does not). */
const jestScripts = Object.entries<string>(pkg.scripts).filter(([, cmd]) =>
  /(^|\s)jest(\s|$)/.test(cmd),
);

describe('🔴 every jest config names the Node guard', () => {
  it('finds both configs, or this proves less than it says', () => {
    expect([...configs.keys()].sort()).toEqual([
      'package.json#jest',
      'test/jest-e2e.json',
    ]);
  });

  it.each([...configs.keys()])('%s has it as globalSetup', (name) => {
    const [dir, config] = configs.get(name)!;
    expect(config.globalSetup).toBeDefined();
    const root = join(dir, config.rootDir ?? '.');
    const file = normalize(config.globalSetup!.replace('<rootDir>', root));
    // Resolves to the real file, not to a path that merely looks right.
    expect(existsSync(file)).toBe(true);
    expect(file).toBe(GUARD);
  });
});

describe('🔴 every script that runs jest sets the flag and names a covered config', () => {
  it('finds the scripts, or this proves less than it says', () => {
    expect(jestScripts.map(([n]) => n).sort()).toEqual([
      'test',
      'test:cov',
      'test:e2e',
      'test:watch',
    ]);
  });

  it.each(jestScripts)(
    '%s sets NODE_OPTIONS=--experimental-vm-modules',
    (_n, cmd) => {
      expect(cmd).toContain(FLAG);
    },
  );

  it.each(jestScripts)('%s runs a config the guard covers', (_n, cmd) => {
    const named = /--config\s+(\S+)/.exec(cmd)?.[1];
    // No --config means the `jest` key in package.json.
    const name = named ? named.replace(/^\.\//, '') : 'package.json#jest';
    expect([...configs.keys()]).toContain(name);
  });
});
