import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedSpot } from './parse';
import {
  KNOWN_FLAGS,
  MAX_FILE_AGE_HOURS,
  MAX_GONE_SHARE,
  REQUIRED_REGIONS,
  planRefresh,
  regionFiles,
  type Held,
} from './refresh';

// CAMP-528 — the decisions of the scheduled refresh, without a database.

const spot = (ref: string, over: Partial<ParsedSpot> = {}): ParsedSpot => ({
  ref,
  name: `Camping ${ref}`,
  lat: 45.1,
  lon: 5.2,
  stars: 3,
  description: 'Au bord du lac.',
  address: null,
  postcode: null,
  commune: null,
  website: 'https://example.test',
  updatedAt: '2026-09-01',
  accessibilityMarks: [],
  ...over,
});

const held = (ref: string, over: Partial<Held> = {}): Held => ({
  id: `id-${ref}`,
  ref,
  updatedAt: '2026-09-01',
  name: `Camping ${ref}`,
  description: 'Au bord du lac.',
  stars: 3,
  website: 'https://example.test',
  lat: 45.1,
  lon: 5.2,
  missing: false,
  folded: false,
  ...over,
});

/** `n` held rows that are all listed again — ballast under the 5% limit. */
const crowd = (n: number) => {
  const refs = Array.from({ length: n }, (_, i) => `c${i}`);
  return { held: refs.map((r) => held(r)), spots: refs.map((r) => spot(r)) };
};

describe('planRefresh', () => {
  it('a record listed again unchanged is seen and nothing about it changed', () => {
    const p = planRefresh([held('a')], [spot('a')]);
    expect(p.seen).toHaveLength(1);
    expect(p.seen[0]).toMatchObject({
      contentChanged: false,
      dateChanged: false,
    });
    expect(p.refusal).toBeNull();
  });

  it('🔴 a re-dated record with the same words is NOT a content change', () => {
    const p = planRefresh(
      [held('a')],
      [spot('a', { updatedAt: '2026-11-12' })],
    );
    expect(p.seen[0]).toMatchObject({
      contentChanged: false,
      dateChanged: true,
    });
  });

  it.each([
    ['name', { name: 'Camping Renommé' }],
    ['description', { description: 'Nouveau texte.' }],
    ['stars', { stars: 4 }],
    ['stars withdrawn', { stars: null }],
    ['website', { website: 'https://autre.test' }],
  ])('🔴 a changed %s is a content change', (_n, over) => {
    const p = planRefresh(
      [held('a')],
      [spot('a', over as Partial<ParsedSpot>)],
    );
    expect(p.seen[0].contentChanged).toBe(true);
  });

  it('🔴 a URI we do not hold is counted and is not in `seen`', () => {
    const p = planRefresh([held('a')], [spot('a'), spot('new')]);
    expect(p.unknown.map((s) => s.ref)).toEqual(['new']);
    expect(p.seen.map((s) => s.held.ref)).toEqual(['a']);
  });

  it('🔴 an absent record is gone; an absent FOLDED record is held back', () => {
    const c = crowd(100);
    const p = planRefresh(
      [...c.held, held('x'), held('y', { folded: true })],
      c.spots,
    );
    expect(p.gone.map((g) => g.ref)).toEqual(['x']);
    expect(p.heldBack.map((g) => g.ref)).toEqual(['y']);
    expect(p.refusal).toBeNull();
  });

  it('an already-missing record that stays absent is not stamped twice', () => {
    const c = crowd(10);
    const p = planRefresh([...c.held, held('x', { missing: true })], c.spots);
    expect(p.gone).toEqual([]);
  });

  it('a missing record that is listed again counts as returned', () => {
    const p = planRefresh([held('a', { missing: true })], [spot('a')]);
    expect(p.returned).toBe(1);
    expect(p.seen).toHaveLength(1);
  });

  it('a record listed far from where we hold it is counted, and still seen', () => {
    const p = planRefresh([held('a')], [spot('a', { lat: 45.2 })]);
    expect(p.moved).toBe(1);
    expect(p.seen).toHaveLength(1);
  });

  it('🔴 the limit: exactly 5% gone passes, one more refuses', () => {
    const c = crowd(95);
    const five = ['g1', 'g2', 'g3', 'g4', 'g5'].map((r) => held(r));
    expect(5 / 100).toBe(MAX_GONE_SHARE);
    expect(planRefresh([...c.held, ...five], c.spots).refusal).toBeNull();
    // 6 of 100 live: drop one of the listed, so 94 seen + 6 gone.
    const p = planRefresh([...c.held, ...five], c.spots.slice(1));
    expect(p.gone).toHaveLength(6);
    expect(p.refusal).toMatch(/6 of 100 .*\(6\.0%/);
  });

  it('🔴 folded rows do not count towards the limit', () => {
    const c = crowd(95);
    const folded = Array.from({ length: 20 }, (_, i) =>
      held(`f${i}`, { folded: true }),
    );
    const p = planRefresh([...c.held, ...folded], c.spots);
    expect(p.heldBack).toHaveLength(20);
    expect(p.refusal).toBeNull();
  });

  it('--no-mark-missing lifts the limit, because nothing will be stamped', () => {
    const c = crowd(10);
    const many = Array.from({ length: 10 }, (_, i) => held(`g${i}`));
    expect(planRefresh([...c.held, ...many], c.spots).refusal).not.toBeNull();
    expect(
      planRefresh([...c.held, ...many], c.spots, { markMissing: false })
        .refusal,
    ).toBeNull();
  });

  it('🔴 an empty table is a refusal: this tool does not load', () => {
    expect(planRefresh([], [spot('a')]).refusal).toMatch(/does not load/);
  });

  it('the same URI twice in the files is one record', () => {
    const p = planRefresh(
      [held('a')],
      [spot('a'), spot('a'), spot('n'), spot('n')],
    );
    expect(p.seen).toHaveLength(1);
    expect(p.unknown).toHaveLength(1);
  });
});

// 🔴 The unit and the tool are tied together HERE, in CI. CAMP-399 was
// three weeks of a unit passing a flag its script did not know.
describe('the systemd unit runs this tool the way it is written', () => {
  const unit = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'infra',
      'systemd',
      'camptribe-datatourisme-campsites.service',
    ),
    'utf8',
  );
  const steps = [...unit.matchAll(/^ExecStart=(.+)$/gm)].map((m) =>
    m[1].split(/\s+/),
  );

  it('two steps, in order: fetch the files, then refresh from them', () => {
    expect(steps).toHaveLength(2);
    expect(steps[0][1]).toMatch(/scripts\/datatourisme\/fetch-regions\.mjs$/);
    expect(steps[1][1]).toBe('dist/datatourisme/refresh.js');
  });

  it('🔴 the fetch re-downloads all thirteen and never trusts a matching size', () => {
    expect(steps[0]).toEqual(
      expect.arrayContaining(['--metropolitan', '--refetch']),
    );
  });

  it('🔴 the refresh reads the directory the fetch wrote', () => {
    const out = steps[0][steps[0].indexOf('--out') + 1];
    expect(out).toMatch(/^\/srv\/camptribe\/data\//);
    expect(steps[1][2]).toBe(out);
  });

  it('🔴 it passes --apply, and only flags the tool knows', () => {
    const flags = steps[1].slice(3);
    expect(flags).toContain('--apply');
    expect(
      flags.filter((f) => !(KNOWN_FLAGS as readonly string[]).includes(f)),
    ).toEqual([]);
  });

  // 🔴 Stamping hides a page at once (242 of them on 13.11.2026) and
  // whether those campsites closed or were unpublished for the winter
  // is not established. Until somebody decides, the schedule refreshes
  // and does not hide. Removing the flag is that decision — this test
  // is here so it is made on purpose and not by a tidy-up.
  it('🔴 the schedule does not stamp anything missing until that is decided', () => {
    expect(steps[1]).toContain('--no-mark-missing');
  });
});

describe('regionFiles', () => {
  const NOW = Date.parse('2026-11-13T12:00:00Z');
  const all = REQUIRED_REGIONS.map((r) => `${r}.csv`);
  const fresh = () => NOW - 3600e3;

  it('all thirteen present and fresh: thirteen paths, no refusal', () => {
    const r = regionFiles('/d', NOW, () => all, fresh);
    expect(r.refusal).toBeNull();
    expect(r.files).toHaveLength(13);
  });

  it('🔴 one region absent is a refusal that names it', () => {
    const r = regionFiles(
      '/d',
      NOW,
      () => all.filter((f) => f !== 'bre.csv'),
      fresh,
    );
    expect(r.refusal).toMatch(/bre/);
  });

  it('🔴 a file older than the limit is a refusal', () => {
    const old = (p: string) =>
      p.endsWith('naq.csv') ? NOW - (MAX_FILE_AGE_HOURS + 1) * 3600e3 : fresh();
    expect(regionFiles('/d', NOW, () => all, old).refusal).toMatch(
      /older than/,
    );
  });

  it('🔴 the list is the fetcher’s METROPOLITAN, read from its source', () => {
    const src = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'scripts',
        'datatourisme',
        'fetch-regions.mjs',
      ),
      'utf8',
    );
    const block = /export const METROPOLITAN = \[([\s\S]*?)\];/.exec(src);
    const theirs = [...(block?.[1] ?? '').matchAll(/'([a-z]{3})'/g)].map(
      (m) => m[1],
    );
    expect(theirs).toHaveLength(13);
    expect([...REQUIRED_REGIONS].sort()).toEqual(theirs.sort());
  });
});
