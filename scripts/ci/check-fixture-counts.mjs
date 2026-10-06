#!/usr/bin/env node
// 🔴 What the CI fixture ADDS UP TO, as a number in code.
//
// CAMP-182. The visual suite says, in its own header, that the counts on
// these pages "are the same on every run". That is true of one build and
// says nothing across builds — and the only place the numbers lived was
// inside PNG baselines. A baseline is refreshed with
// `--update-snapshots`, which makes it agree with whatever the code now
// does: the headline went 71 → 72 and Croatia 36 → 37 between two runs
// over a BYTE-IDENTICAL fixture, and the suite stayed green through it,
// because the evidence had been regenerated from the thing it was meant
// to judge.
//
// So the number is written down here, where a change to it is an edit
// somebody has to make on purpose and explain, rather than a side effect
// of a flag.
//
// 🔴 WHAT THIS IS NOT. It is not a determinism check — the count path
// was read and holds no clock: `countries()` filters on `region IS NOT
// NULL`, `missing_since IS NULL` and `notSecondarySql`, and none of the
// three touches `now()`, `current_date` or any other moving value. The
// fixture's own `LIMIT`s all carry `ORDER BY`. The calendar hypothesis
// in the card is dead by construction; what moved the number was the
// code between the two runs, unnoticed.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
// 🔴 The parser lives in `scripts/seed-rows.mjs` so that a unit test can
// read the SAME rows this guard counts. Re-exported, because callers of
// this file already import them from here.
import { splitTuple, literal, readSpots } from '../seed-rows.mjs';

export { splitTuple, literal, readSpots };

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', '..', 'apps', 'api', 'test', 'fixtures', 'ci-seed.sql');

/**
 * What the fixture is supposed to show.
 *
 * 🔴 Change these only together with the fixture, and say why in the
 * commit. A number that moves on its own is the defect this file exists
 * to name.
 */
export const EXPECTED = {
  visibleSpots: 72,
  byCountry: { hr: 37, si: 35 },
};

/**
 * Split one SQL tuple on its top-level commas.
 *
 * Quotes come first because a comma inside `'{"a": 1, "b": 2}'::jsonb`
 * is not a separator, and depth comes second because of
 * `ST_GeomFromText('POINT(16.8 45.9)', 4326)`. Postgres writes an
 * embedded quote as `''`, so a doubled quote is a character, not an end.
 */
export function goneSlug(rows) {
  const eligible = rows.filter((r) => {
    if (!r.region) return false;
    let toilets = 'unknown';
    try {
      toilets = JSON.parse(r.amenities ?? '{}').toilets ?? 'unknown';
    } catch {
      toilets = 'unknown';
    }
    return toilets === 'unknown' && (r.context ?? '{}') === '{}';
  });
  return [...eligible].sort(bySlug).at(-1)?.slug ?? null;
}

/**
 * One ordering for both `ORDER BY slug`, and it is code-unit.
 *
 * 🔴 These were two different comparators — `.sort()` on strings in one
 * place and `localeCompare` in the other — for two identical SQL
 * clauses. Harmless on today's data (review ordered all 73 slugs under
 * C, macOS en_US.UTF-8 and ICU: zero inversions) but inconsistent by
 * construction, and a pair like `adria-z` / `adriaa` would split them.
 * Postgres is asked for one order, so this asks for one too.
 */
const bySlug = (a, b) => (String(a.slug) < String(b.slug) ? -1 : String(a.slug) > String(b.slug) ? 1 : 0);

/** Words too generic to tell two campsites apart, as the fixture lists them. */
const GENERIC = new Set([
  'camping', 'campings', 'campsite', 'caravaning', 'caravanning', 'carava',
  'aires', 'residence', 'domaine', 'village', 'municipal', 'municipale',
  'communal', 'communale', 'intercommunal',
]);

/**
 * The campsite the cross-source DO block builds a DATAtourisme twin of.
 *
 * 🔴 THE 73rd ROW, and the reason this file nearly shipped a wrong
 * number. The twin is not a literal INSERT — it is
 * `INSERT … VALUES ('Camping ' || anchor.name, anchor.country, …)` inside
 * a DO block, so a parser that reads literals finds 72 rows and misses
 * it. It carries a region and no `missing_since`, nothing links it as a
 * secondary (the fixture seeds NO `spot_links`; CI runs the reconciler
 * only as a dry run), so the pages DO count it.
 *
 * Its anchor is chosen by rule: an OSM row, present, named, and with at
 * least one word of five letters or more that is not a generic camping
 * word — lowest slug.
 */
export function anchorRow(rows) {
  const eligible = rows.filter((r) => {
    if (!r.osm_ref || !r.region || r.missing_since !== null || !r.name) return false;
    return String(r.name)
      .toLowerCase()
      .split(/[^a-zà-ÿ0-9]+/)
      .some((w) => w.length >= 5 && !GENERIC.has(w));
  });
  return [...eligible].sort(bySlug)[0] ?? null;
}

/** What `countries()` would count, computed from the file alone. */
export function tally(sql) {
  const rows = readSpots(sql);
  const gone = goneSlug(rows);
  const visible = rows.filter(
    (r) => r.region !== null && r.missing_since === null && r.slug !== gone,
  );
  const byCountry = {};
  for (const r of visible) {
    const c = String(r.country).toLowerCase();
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }

  // The twin, when the fixture builds one.
  let twin = null;
  if (/anchor\.slug \|\| '-dt'/.test(sql)) {
    const anchor = anchorRow(visible);
    if (anchor) {
      twin = `${anchor.slug}-dt`;
      const c = String(anchor.country).toLowerCase();
      byCountry[c] = (byCountry[c] ?? 0) + 1;
    }
  }

  return {
    // Rows the parser matched but could not read. Carried out rather
    // than skipped: a count built from fewer rows than the file holds
    // is wrong in the quietest possible way.
    unreadable: rows.unreadable ?? [],
    rows: rows.length + (twin ? 1 : 0),
    gone,
    twin,
    visibleSpots: visible.length + (twin ? 1 : 0),
    byCountry,
  };
}

// Prove the counting can fail. Nothing here reads the real fixture.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };

  const cols =
    'id, name, country, region, slug, amenities, location, missing_since, context';
  const row = (slug, country, region, missing, amenities = '{}', context = '{}') =>
    `INSERT INTO camping_spots (${cols}) VALUES ('i', 'n', '${country}', ${
      region === null ? 'NULL' : `'${region}'`
    }, '${slug}', '${amenities}'::jsonb, ST_GeomFromText('POINT(1 2)', 4326), ${
      missing ? `'${missing}'` : 'NULL'
    }, '${context}'::jsonb);`;

  // A comma inside JSON and inside a function call must not split a row.
  const tricky = splitTuple(
    `'a', '{"x": 1, "y": 2}'::jsonb, ST_GeomFromText('POINT(1 2)', 4326), NULL`,
  );
  if (tricky.length !== 4) bad(`a tuple split into ${tricky.length}, not 4`);
  if (literal(tricky[1]) !== '{"x": 1, "y": 2}') bad('json literal mangled');
  if (literal(tricky[3]) !== null) bad('NULL not read as null');
  if (literal("'it''s'") !== "it's") bad('a doubled quote is a character');

  const sql = [
    row('aaa', 'HR', 'Zagreb', null),
    row('bbb', 'HR', 'Zagreb', null),
    row('ccc', 'SI', null, null), // no region: never counted
    row('ddd', 'SI', 'Bovec', '2026-01-01'), // already gone
    // Highest slug among the eligible, so the DO block takes it.
    row('zzz', 'SI', 'Bovec', null),
  ].join('\n');

  const t = tally(sql);
  if (t.rows !== 5) bad(`read ${t.rows} rows, not 5`);
  if (t.gone !== 'zzz') bad(`marked ${t.gone} gone, not the highest slug`);
  if (t.visibleSpots !== 2) bad(`counted ${t.visibleSpots}, not 2`);
  if (JSON.stringify(t.byCountry) !== '{"hr":2}') {
    bad(`by country was ${JSON.stringify(t.byCountry)}, not {"hr":2}`);
  }

  // 🔴 The twin, which a literal-only parser does not see at all. Add
  // the DO block's marker and the count must rise by one, in the
  // anchor's country — the lowest slug whose name carries a word of five
  // letters or more that is not a generic camping word. Here that is
  // 'aaa' ("Lakeside"), not 'bbb' ("Camping"), whose only long word is
  // generic.
  // 🔴 `toilets` matters in the input, and leaving it out is how the
  // first draft of this case fouled itself: with every row eligible, the
  // gone block ate one of the two and there was nothing left to anchor
  // on. The real fixture has the same shape for the same reason — rows
  // put there on purpose carry an explicit answer so the gone block
  // passes them by.
  const named = (slug, country, name, toilets) =>
    `INSERT INTO camping_spots (id, name, country, region, slug, amenities, location, missing_since, context, osm_ref) VALUES ` +
    `('i', '${name}', '${country}', 'Zagreb', '${slug}', '{"toilets": "${toilets}"}'::jsonb, ` +
    `ST_GeomFromText('POINT(1 2)', 4326), NULL, '{}'::jsonb, 'n1');`;

  // 'aaa' is the only gone-eligible row, so it is marked. Of what is
  // left, 'bbb' carries "Lakeside" and 'ccc' only the GENERIC word
  // "Camping" — if the generic list were ignored, 'ccc' could never be
  // the anchor anyway, but 'aaa' would, and the twin would land in HR.
  // 🔴 'aab' sorts BEFORE 'bbb' and is named only with a generic word.
  // That ordering is the whole case: ignore the generic list and the
  // anchor becomes 'aab', so the twin lands in HR instead of SI. An
  // earlier draft put the generic row last, where it could never win
  // anyway, and deleting the generic filter left the rehearsal green.
  const three = [
    named('aaa', 'HR', 'Camping', 'unknown'), // the only gone-eligible row
    named('aab', 'HR', 'Camping', 'yes'), // lowest visible slug, generic name
    named('bbb', 'SI', 'Lakeside', 'yes'), // the anchor the rule should pick
  ].join('\n');

  const tw = tally(`${three}\n-- the block's marker: anchor.slug || '-dt'\n`);
  if (tw.gone !== 'aaa') bad(`marked ${tw.gone} gone, not the only eligible row`);
  if (tw.twin !== 'bbb-dt') bad(`twin was ${tw.twin}, not built on the eligible anchor`);
  if (tw.visibleSpots !== 3) bad(`with a twin the count was ${tw.visibleSpots}, not 3`);
  if (tw.byCountry.si !== 2) bad('the twin was not counted in its anchor’s country');

  // And without the block's marker there is no twin at all.
  const noTwin = tally(three);
  if (noTwin.twin !== null || noTwin.visibleSpots !== 2) {
    bad(`a twin appeared although the fixture builds none (${noTwin.visibleSpots})`);
  }

  // 🔴 THREE RULES THAT NOTHING ABOVE REACHES, found by review: deleting
  // the `osm_ref` filter, loosening the five-letter rule, or dropping
  // the region test in `goneSlug` each left the rehearsal AND the real
  // check green, because the inputs above never varied those fields. A
  // rule no input distinguishes is a rule no test has.
  const full = (slug, country, name, toilets, osmRef, region) =>
    `INSERT INTO camping_spots (id, name, country, region, slug, amenities, location, missing_since, context, osm_ref) VALUES ` +
    `('i', ${name === null ? 'NULL' : `'${name}'`}, '${country}', ${region === null ? 'NULL' : `'${region}'`}, '${slug}', ` +
    `'{"toilets": "${toilets}"}'::jsonb, ST_GeomFromText('POINT(1 2)', 4326), NULL, '{}'::jsonb, ` +
    `${osmRef === null ? 'NULL' : `'${osmRef}'`});`;

  const marker = `\n-- anchor.slug || '-dt'\n`;

  // Only an OSM row may anchor. 'aaa' sorts first and is well named, but
  // has no osm_ref, so the twin must be built on 'bbb'.
  const noOsm = tally(
    [
      full('aaa', 'HR', 'Lakeside', 'yes', null, 'Zagreb'),
      full('bbb', 'SI', 'Riverside', 'yes', 'n1', 'Bovec'),
      full('zzz', 'HR', 'Camping', 'unknown', 'n2', 'Zagreb'),
    ].join('\n') + marker,
  );
  if (noOsm.twin !== 'bbb-dt') bad(`a row without osm_ref anchored the twin (${noOsm.twin})`);

  // Five letters, not four. 'Lido' is the only non-generic word on
  // 'aaa' and it is four long, so 'bbb' anchors.
  const shortWord = tally(
    [
      full('aaa', 'HR', 'Lido', 'yes', 'n1', 'Zagreb'),
      full('bbb', 'SI', 'Riverside', 'yes', 'n2', 'Bovec'),
      full('zzz', 'HR', 'Camping', 'unknown', 'n3', 'Zagreb'),
    ].join('\n') + marker,
  );
  if (shortWord.twin !== 'bbb-dt') {
    bad(`a four-letter name anchored the twin (${shortWord.twin})`);
  }

  // The gone block only ever marks a row that HAS a region. 'zzz' sorts
  // highest and is otherwise eligible, but its region is NULL.
  const noRegion = tally(
    [
      full('aaa', 'HR', 'Lakeside', 'unknown', 'n1', 'Zagreb'),
      full('zzz', 'HR', 'Lakeside', 'unknown', 'n2', null),
    ].join('\n'),
  );
  if (noRegion.gone !== 'aaa') bad(`a region-less row was marked gone (${noRegion.gone})`);

  // 🔴 The anchor is the LOWEST slug, and until this case there was only
  // ever one eligible row, so first and last were the same thing and the
  // direction was untested.
  const twoAnchors = tally(
    [
      full('aaa', 'HR', 'Lakeside', 'yes', 'n1', 'Zagreb'),
      full('bbb', 'SI', 'Riverside', 'yes', 'n2', 'Bovec'),
      full('zzz', 'HR', 'Camping', 'unknown', 'n3', 'Zagreb'),
    ].join('\n') + marker,
  );
  if (twoAnchors.twin !== 'aaa-dt') {
    bad(`the anchor was not the lowest slug (${twoAnchors.twin})`);
  }

  // 🔴 And the `context` half of the same rule, which the case above
  // does not reach either: the fixture leaves rows with COMPUTED
  // surroundings alone, because other blocks put them there on purpose.
  // 'zzz' sorts highest and is otherwise eligible; its context is not
  // empty, so 'aaa' is marked instead.
  const withContext =
    full('aaa', 'HR', 'Lakeside', 'unknown', 'n1', 'Zagreb') +
    '\n' +
    full('zzz', 'HR', 'Lakeside', 'unknown', 'n2', 'Zagreb').replace(
      `'{}'::jsonb, 'n2'`,
      `'{"town": {"name": "Zagreb"}}'::jsonb, 'n2'`,
    );
  const ctx = tally(withContext);
  if (ctx.gone !== 'aaa') {
    bad(`a row with computed surroundings was marked gone (${ctx.gone})`);
  }

  // A row the parser matches but cannot read must be reported, not
  // skipped: that silent skip is how the twin went missing.
  const broken = tally(
    `INSERT INTO camping_spots (id, name, country) VALUES ('i', 'n');`,
  );
  if (broken.unreadable.length !== 1) bad('an unreadable row was swallowed');
  if (compare({ visibleSpots: 0, byCountry: {} }, broken).length === 0) {
    bad('an unreadable row did not reach the verdict');
  }

  // 🔴 And the gate itself, not only the arithmetic. A check whose
  // comparison is wired loosely reports a changed number as success —
  // the same hole the migration-stamp guard had.
  if (compare({ visibleSpots: 2, byCountry: { hr: 2 } },
    { visibleSpots: 3, byCountry: { hr: 2 } }).length === 0) {
    bad('a changed total was accepted');
  }
  if (compare({ visibleSpots: 2, byCountry: { hr: 2 } },
    { visibleSpots: 2, byCountry: { hr: 1 } }).length === 0) {
    bad('a changed country count was accepted');
  }
  if (compare({ visibleSpots: 2, byCountry: { hr: 2 } },
    { visibleSpots: 2, byCountry: { hr: 2, si: 1 } }).length === 0) {
    bad('a country that appeared out of nowhere was accepted');
  }
  if (compare({ visibleSpots: 2, byCountry: { hr: 2 } },
    { visibleSpots: 2, byCountry: { hr: 2 } }).length !== 0) {
    bad('an unchanged tally was reported as a difference');
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: tuples split on their own commas, the gone row is the\n' +
        '  highest eligible slug, and the comparison rejects a moved total,\n' +
        '  a moved country and a country that was not there before.',
    );
  }
  return rc;
}

/** Differences between what we expect and what the fixture says. */
export function compare(expected, actual) {
  const out = [];
  for (const u of actual.unreadable ?? []) {
    out.push(`a camping_spots row could not be read (${u}) — the count is built from fewer rows than the file holds`);
  }
  if (expected.visibleSpots !== actual.visibleSpots) {
    out.push(`total: expected ${expected.visibleSpots}, fixture says ${actual.visibleSpots}`);
  }
  for (const c of new Set([
    ...Object.keys(expected.byCountry),
    ...Object.keys(actual.byCountry),
  ])) {
    const e = expected.byCountry[c];
    const a = actual.byCountry[c];
    if (e !== a) out.push(`${c}: expected ${e ?? 'none'}, fixture says ${a ?? 'none'}`);
  }
  return out;
}

// 🔴 Nothing runs on import. Without this the module executed its own
// gate the moment a test imported `splitTuple`, printed a verdict and
// called `process.exit` — a file that cannot be read by its own tests is
// a file whose parts cannot be tested apart from its conclusion.
// 🔴 `realpathSync`, because `import.meta.url` is already resolved and
// `process.argv[1]` is not. Run through a symlink the two never match,
// the script decides it was imported, and exits 0 having printed nothing
// and checked nothing — a guard that passes by not running. Review
// reproduced it from /tmp. CI uses a relative path and does not hit it,
// which is exactly why it would have sat here.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  main();
}

function main() {
const actual = tally(readFileSync(SEED, 'utf8'));
const diffs = compare(EXPECTED, actual);

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(actual, null, 2));
  process.exit(0);
}

if (diffs.length > 0) {
  console.error('✗ The CI fixture no longer adds up to what the pages claim:\n');
  for (const d of diffs) console.error(`  ${d}`);
  console.error(
    '\n  These numbers appear on the home page and on /camping, and they\n' +
      '  are what the visual baselines show. If the change is intended,\n' +
      '  edit EXPECTED in this file in the same commit and say why — that\n' +
      '  is the whole point of it being here rather than only inside a PNG\n' +
      '  that --update-snapshots would quietly agree with.',
  );
  process.exit(1);
}

console.log(
  `✓ fixture: ${actual.rows} campsites seeded, ${actual.visibleSpots} visible ` +
    `(${Object.entries(actual.byCountry).map(([c, n]) => `${c} ${n}`).join(', ')}), ` +
    `'${actual.gone}' marked gone`,
);
}
