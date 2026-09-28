import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// CAMP-153 — the fetch script's guards, in the suite that actually runs.
//
// 🔴 WHY THIS FILE EXISTS, AND IT IS NOT DUPLICATION.
//
// `scripts/effis/fetch-wildfires.mjs --self-test` drives 49 checks, and
// every one of them was rehearsed only when a human typed the command.
// Nothing imported the script and no job invoked it, so the 2 000-feature
// ceiling, the `maxfeatures` throw that stands between us and a 132 MB
// response, the two licence-marker loops and the refusal to write a word
// the CEMS terms reserve were guards that never fired on their own. Every
// other guard in this repository — check-secrets, check-eu-scope,
// check-flaky, check-skips — has a step in CI. A safeguard nobody has
// watched fail is a safeguard nobody has.
//
// 🔴 The step is here rather than in `.github/workflows/ci.yml` because
// that file belongs to another card in flight. The unit project already
// runs on every job, needs no network and no database, and this file
// fails in milliseconds on a pull request.

const SCRIPT = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'effis',
  'fetch-wildfires.mjs',
);

/**
 * 🔴 A REAL dynamic import, written so the transpiler cannot rewrite it.
 *
 * Playwright compiles this spec to CommonJS, and a static
 * `import … from '….mjs'` then loads the script as CJS and dies on
 * `import.meta`. `new Function` keeps the import native, so Node
 * evaluates the module as the ESM it is — and the script's
 * `invokedDirectly` guard means evaluating it does nothing at all: no
 * fetch, no write, which is the property that made it safe to import.
 */
const load = new Function('u', 'return import(u)') as (
  u: string,
) => Promise<Record<string, never>>;

/* eslint-disable @typescript-eslint/no-explicit-any */
let mod: any;

test.beforeAll(async () => {
  mod = await load(pathToFileURL(SCRIPT).href);
});

test('🔴 the script’s own 49 checks run here, not only when somebody types the command', () => {
  // The whole point of the file. `--self-test` touches no network and no
  // filesystem, so CI can run it as-is; a non-zero exit throws here and
  // the output names which check failed.
  const out = execFileSync(process.execPath, [SCRIPT, '--self-test'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(out).not.toContain('FAIL');
  expect(out).toMatch(/(\d+)\/\1 passed/);
});

test('an unbounded WFS request cannot be built', () => {
  // 🔴 The 132 MB rule, and why it is a throw rather than a comment.
  for (const bad of [
    undefined,
    null,
    0,
    -1,
    1.5,
    '2000',
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ]) {
    expect(
      () => mod.wfsUrl({ maxfeatures: bad }),
      `maxfeatures=${String(bad)} produced a URL`,
    ).toThrow();
  }
  expect(mod.wfsUrl({ maxfeatures: mod.MAX_FEATURES })).toContain(
    `maxfeatures=${mod.MAX_FEATURES}`,
  );
});

test('a hits request is the one exemption, and it asks for no features', () => {
  const u = mod.wfsUrl({ hits: true });
  expect(u).toContain('resultType=hits');
  expect(u).not.toContain('outputformat');
  expect(u).not.toContain('maxfeatures');
});

test('the cutoff must be a bare date, because the server compares strings', () => {
  // Measured 28.09.2026: '2026-09-01' → 717 fires, '2026-09-01T00:00:00'
  // → 693. 'T' sorts after a space, so the ISO form silently drops every
  // fire that started on the cutoff day.
  expect(mod.sinceFilter(['PT'], '2026-09-14')).toContain('2026-09-14');
  for (const bad of ['2026-09-14T00:00:00', '14/09/2026', 'last week', '2026-9-4', '']) {
    expect(() => mod.sinceFilter(['PT'], bad), `${bad} was accepted`).toThrow();
  }
});

test('the window is counted back from the moment it is given', () => {
  expect(mod.windowStart(new Date('2026-09-28T18:00:00Z'), 14)).toBe('2026-09-14');
  expect(mod.windowStart(new Date('2026-01-05T00:00:00Z'), 10)).toBe('2025-12-26');
});

test('EFFIS speaks Eurostat: Greece is EL, and every code maps back', () => {
  // Measured: COUNTRY='GR' → 0 fires, COUNTRY='EL' → 147.
  expect(mod.EFFIS_CODE.gr).toBe('EL');
  expect(mod.ISO_CODE.EL).toBe('GR');
  expect(Object.keys(mod.EFFIS_CODE)).toHaveLength(27);
  expect(Object.keys(mod.ISO_CODE)).toHaveLength(27);
  for (const [iso, effis] of Object.entries(mod.EFFIS_CODE)) {
    expect(mod.ISO_CODE[effis as string]).toBe(iso.toUpperCase());
  }
});

test('one bad record costs one record, and nothing in normalise throws', () => {
  const good = (over: Record<string, unknown> = {}) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]],
    },
    properties: {
      id: '1',
      FIREDATE: '2026-09-20 02:06:00',
      COUNTRY: 'IT',
      AREA_HA: '63',
      PROVINCE: 'Sicilia',
      COMMUNE: 'Enna',
      ...over,
    },
  });
  const opts = { since: '2026-09-14' };
  const batch = [
    good({ id: '1' }),
    good({ id: '2', FIREDATE: 'yesterday' }),
    good({ id: '3', COUNTRY: 'UA' }),
    good({ id: '4', AREA_HA: 'lots' }),
    good({ id: '5' }),
  ];
  const kept = batch
    .map((f) => mod.normalise(f, opts))
    .filter((r: { fire?: unknown }) => r.fire);
  expect(kept).toHaveLength(2);

  for (const junk of [null, undefined, {}, { properties: null }, { properties: {} }, 'x', 42, []]) {
    expect(() => mod.normalise(junk, opts)).not.toThrow();
    expect(mod.normalise(junk, opts).reason).toBeTruthy();
  }
});

test('a fire too small for the grid keeps its own coordinates', () => {
  const tiny = [
    [
      [10.00011, 45.00011],
      [10.00019, 45.00011],
      [10.00019, 45.00019],
      [10.00011, 45.00019],
      [10.00011, 45.00011],
    ],
  ];
  expect(mod.simplifyRing(tiny[0])).toBeNull();
  const g = mod.simplify({ type: 'Polygon', coordinates: tiny });
  expect(g).not.toBeNull();
  expect(g.coordinates[0][1][0]).toBe(10.00019);
});

test('dates that are not days are refused', () => {
  expect(mod.fireDate('2026-09-14 02:06:00')).toBe('2026-09-14');
  for (const bad of ['2026-02-31', '2026-13-01', '', null, 20260914]) {
    expect(mod.fireDate(bad), `${String(bad)} passed as a date`).toBeNull();
  }
});

test('the credit is the CEMS notice for MODIFIED data, with a real year', () => {
  expect(mod.attributionFor(2026)).toContain(
    'Contains modified Copernicus Emergency Management Service information 2026',
  );
  expect(mod.attributionFor(2026)).toContain('CC BY 4.0');
  for (const bad of [undefined, null, '2026', 1026, 2101, 2026.5]) {
    expect(() => mod.attributionFor(bad), `${String(bad)} was accepted as a year`).toThrow();
  }
});

test('🔴 the run refuses to WRITE a word the CEMS terms reserve', () => {
  // The guard that had never run unattended: it is the last thing
  // `collect()` does before the file is written, and `collect()` needs two
  // live HTTP requests, so until now it was rehearsed by hand or not at
  // all. Exported so it can be driven without either.
  expect(() => mod.checkMetaWording({ authorityNote: 'a plain sentence' })).not.toThrow();
  for (const bad of [
    'this is a fire danger warning',
    'extreme risk in the area',
    'weather alerts are issued',
    'evacuate immediately',
    'DANGEROUS conditions',
  ]) {
    expect(() => mod.checkMetaWording({ note: bad }), `${bad} was written`).toThrow(
      /REFUSING TO WRITE/,
    );
  }
  // And words that merely look like them are not a licence breach — a
  // guard that fires on innocent text is a guard somebody switches off.
  for (const fine of ['a brisk walk', 'Warwickshire', 'Alerta, a commune']) {
    expect(() => mod.checkMetaWording({ note: fine }), `${fine} was refused`).not.toThrow();
  }
  expect(mod.FORBIDDEN_WORDS.test('risk')).toBe(true);
  expect(mod.FORBIDDEN_WORDS.test('brisk')).toBe(false);
});

test('the committed data file is what this script would write today', () => {
  // 🔴 Not a re-fetch: a shape check against the guards above, so a hand
  // edit to the committed JSON cannot quietly bypass them.
  const feed = JSON.parse(
    execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))',
        join(__dirname, '..', '..', 'src', 'data', 'wildfires.json')],
      { encoding: 'utf8' },
    ),
  ) as { meta: Record<string, string>; features: { properties: { country: string } }[] };

  expect(() => mod.checkMetaWording(feed.meta)).not.toThrow();
  expect(feed.meta.attribution).toBe(mod.attributionFor(new Date(feed.meta.fetchedAt).getUTCFullYear()));
  expect(feed.features.length).toBeLessThan(mod.MAX_FEATURES);
  for (const f of feed.features) {
    expect(Object.values(mod.ISO_CODE)).toContain(f.properties.country);
  }
});
