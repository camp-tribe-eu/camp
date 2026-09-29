import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CEMS_NOTICE,
  readFire,
  FRESH_FOR_HOURS,
  RESERVED_WORDS,
  bboxOf,
  firesInView,
  formatDay,
  hoursSince,
  readFeed,
  wildfireNote,
  wildfireState,
  type WildfireFeature,
  type WildfireState,
} from '../../src/lib/wildfires';

// CAMP-153. Two things decide whether this layer helps or hurts, and
// neither is visible on a working day:
//
//   1. whether a reader can tell "nothing burnt here" from "we have no
//      data" — because both draw the same empty map;
//   2. whether anything we write turns Copernicus's record into our own
//      instruction, which no licence covers.
//
// 🔴 EVERY TEST BELOW WAS MUTATION-PROVED. The mutation that makes it
// fail is written next to it, and each was applied to src/lib/wildfires.ts
// and the suite re-run. A test that passes over a deleted guard is worse
// than no test: it reports that the guard is there.

const FEED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'wildfires.json'), 'utf8'),
) as Record<string, unknown>;

const MEMBERS = Object.keys(
  (
    JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'api', 'src', 'osm', 'eu-member-states.json'),
        'utf8',
      ),
    ) as { members: Record<string, string> }
  ).members,
).map((c) => c.toUpperCase());

const NOW = new Date('2026-09-28T18:00:00Z');
const feedAt = (iso: string) => ({ ...FEED, meta: { ...(FEED.meta as object), fetchedAt: iso } });

const square = (lon: number, lat: number, d = 0.01): WildfireFeature => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
  },
  properties: { id: 'x', date: '2026-09-20', country: 'IT', place: 'Enna', hectares: 63 },
});

// ── the rule the whole card turns on ──────────────────────────────────

test('every state the layer can be in produces words, never an empty element', () => {
  // 🔴 Mutation: return `{ tone: 'quiet', headline: '', detail: '' }` from
  // any one branch of wildfireNote — this fails on that branch.
  const states: WildfireState[] = [
    { kind: 'loading' },
    { kind: 'missing' },
    { kind: 'stale', meta: (FEED.meta as never), hoursOld: 99 },
    { kind: 'stale', meta: (FEED.meta as never), hoursOld: Number.POSITIVE_INFINITY },
    { kind: 'fresh', meta: (FEED.meta as never), fires: [] },
    { kind: 'fresh', meta: (FEED.meta as never), fires: [square(14, 40)] },
  ];
  for (const state of states) {
    for (const inView of [null, 0, 1, 278]) {
      const note = wildfireNote(state, inView);
      expect(note.headline.trim().length, `${state.kind}/${inView} said nothing`).toBeGreaterThan(20);
      expect(note.detail.trim().length, `${state.kind}/${inView} gave no detail`).toBeGreaterThan(20);
    }
  }
});

test('🔴 the six states say six different things, and each dies on its own', () => {
  // 🔴 THE DEFECT THIS REPLACES. Three of the six branches were
  // interchangeable: replacing `loading` with the `missing` text verbatim
  // left 25/25 green, and so did gutting `stale` of its age, its "we last
  // read Copernicus EFFIS successfully" and its 72-hour budget. Every
  // earlier assertion was on the phrase they SHARE. So each state now has
  // a sentence only it can produce, and they are asserted as a set —
  // `map-chunks.spec.ts` has asserted `dataMessage({kind:'loading'})`
  // against /Loading/ all along, which is why this was a miss, not a
  // choice.
  const meta = FEED.meta as never;
  const said = (state: WildfireState, inView: number | null = null) => {
    const note = wildfireNote(state, inView);
    return `${note.headline} ${note.detail}`;
  };

  const loading = said({ kind: 'loading' });
  const missing = said({ kind: 'missing' });
  const stale = said({ kind: 'stale', meta, hoursOld: 96 });
  const none = said({ kind: 'fresh', meta, fires: [] });
  const noneHere = said({ kind: 'fresh', meta, fires: [square(14, 40)] }, 0);
  const some = said({ kind: 'fresh', meta, fires: [square(14, 40), square(15, 41)] }, 2);

  // Each one's own words, absent from every other state.
  expect(loading).toContain('Loading the Copernicus EFFIS wildfire layer');
  expect(loading).toContain('still fetching');
  expect(missing).toContain('we could not load the Copernicus EFFIS layer');
  expect(stale).toContain('We last read Copernicus EFFIS successfully');
  expect(stale).toContain(`${FRESH_FOR_HOURS}-hour budget`);
  expect(stale).toContain('96 hours');
  expect(none).toContain('recorded no burnt areas across the EU-27');
  expect(noneHere).toContain('is in this view');
  expect(noneHere).toContain('none was recorded here');
  expect(some).toMatch(/2 are in this view/);

  expect(loading).not.toContain('No fresh wildfire data');

  // 🔴 The tone is part of the state too. It decides whether the box under
  // the map is drawn as a gap (warm border) or as ordinary information,
  // and a gap drawn as ordinary is the empty map again in a quieter voice.
  // Mutation: return 'quiet' from the `total === 0` branch — fails here.
  const tone = (state: WildfireState, inView: number | null = null) =>
    wildfireNote(state, inView).tone;
  expect(tone({ kind: 'loading' })).toBe('gap');
  expect(tone({ kind: 'missing' })).toBe('gap');
  expect(tone({ kind: 'stale', meta, hoursOld: 96 })).toBe('gap');
  expect(tone({ kind: 'fresh', meta, fires: [] })).toBe('gap');
  expect(tone({ kind: 'fresh', meta, fires: [square(14, 40)] }, 0)).toBe('quiet');
  expect(tone({ kind: 'fresh', meta, fires: [square(14, 40)] }, 1)).toBe('quiet');

  // 🔴 AND EACH MARKER APPEARS IN EXACTLY ONE STATE.
  //
  // "no two are the same string" was not enough on its own: the mutation
  // run showed the stale HEADLINE could be replaced by the missing one
  // and everything stayed green, because the two details still differed —
  // leaving a reader told in one sentence that we could not load the
  // layer and in the next when we last loaded it. So every state's own
  // phrase is asserted present in it and ABSENT from the other five.
  const states: [string, string, string][] = [
    ['loading', loading, 'Loading the Copernicus EFFIS wildfire layer'],
    ['missing', missing, 'could not load the Copernicus EFFIS layer'],
    ['stale', stale, 'We last read Copernicus EFFIS successfully'],
    ['none recorded', none, 'recorded no burnt areas across the EU-27'],
    ['none in view', noneHere, 'None of the'],
    ['some in view', some, 'are in this view'],
  ];
  for (const [name, text, marker] of states) {
    expect(text, `${name} lost its own words`).toContain(marker);
    for (const [other, otherText] of states) {
      if (other === name) continue;
      expect(
        otherText,
        `${other} borrowed ${name}'s words: "${marker}"`,
      ).not.toContain(marker);
    }
  }
});

test('a clock ahead of us is described as a wrong clock, not as an age', () => {
  // 🔴 `Math.round(Math.abs(hoursOld))` printed a `fetchedAt` four hours
  // in the future as "4 hours ago" — a confident sentence about a clock
  // that is wrong. Review found it.
  // 🔴 Mutation: restore Math.abs and drop the `ahead` branch — fails.
  const ahead = wildfireNote({ kind: 'stale', meta: FEED.meta as never, hoursOld: -4 }, null);
  expect(`${ahead.headline} ${ahead.detail}`).toContain('in the future');
  expect(`${ahead.headline} ${ahead.detail}`).not.toContain('4 hours ago');
  const behind = wildfireNote({ kind: 'stale', meta: FEED.meta as never, hoursOld: 96 }, null);
  expect(`${behind.headline} ${behind.detail}`).toContain('96 hours ago');
  expect(`${behind.headline} ${behind.detail}`).not.toContain('in the future');
});

test('🔴 a feed that speaks with a national service’s authority is refused', () => {
  // 🔴 THE GATE THAT WAS NOT A GATE. `RESERVED_WORDS` was defined,
  // unit-tested against itself, and applied to nothing: `authorityNote`
  // and `attribution` are rendered verbatim, so a feed saying this went
  // straight onto the page. Review proved it with a scratch feed; the old
  // reserved-word test could not, because it only ever fed the function
  // the committed metadata.
  const meta = FEED.meta as Record<string, unknown>;
  const hostile =
    'This is an official fire danger warning: extreme risk, evacuate the area immediately.';
  expect(RESERVED_WORDS.test(hostile)).toBe(true);
  expect(readFeed({ ...FEED, meta: { ...meta, authorityNote: hostile } })).toBeNull();
  expect(
    readFeed({
      ...FEED,
      meta: {
        ...meta,
        attribution: `${String(meta.attribution)} — severe weather warning`,
      },
    }),
  ).toBeNull();
  // …and it reaches the sentence a reader sees, not an exception.
  const state = wildfireState({ ...FEED, meta: { ...meta, authorityNote: hostile } }, NOW);
  expect(state.kind).toBe('missing');
  expect(wildfireNote(state, null).headline).toContain('No fresh wildfire data');
});

test('🔴 every string the note prints is gated, not only the two the review named', () => {
  // 🔴 The gate above was applied to `authorityNote` and `attribution`,
  // and the note under the map also prints `source` and `licence` as the
  // visible text of two links. A feed whose `source` said "Fire danger
  // service" therefore went straight to the page. The field list here is
  // written out by hand on purpose: derived from the code it would shrink
  // whenever the code did, and the test would follow it down.
  // 🔴 Mutation: remove 'source' or 'licence' from RENDERED_META — fails on
  // that field's row.
  const meta = FEED.meta as Record<string, unknown>;
  for (const field of ['source', 'licence', 'attribution', 'authorityNote']) {
    const value = String(meta[field]);
    // Appended, so `attribution` keeps the CEMS notice it must carry and
    // the ONLY thing wrong with the feed is the word.
    for (const word of ['danger', 'a severe weather warning', 'alerts', 'evacuation']) {
      expect(
        readFeed({ ...FEED, meta: { ...meta, [field]: `${value} — ${word}` } }),
        `${field} carrying "${word}" was accepted`,
      ).toBeNull();
    }
    // An empty one renders an empty link (or, for the note, nothing).
    expect(
      readFeed({ ...FEED, meta: { ...meta, [field]: '  ' } }),
      `a blank ${field} was accepted`,
    ).toBeNull();
    expect(
      readFeed({ ...FEED, meta: { ...meta, [field]: undefined } }),
      `a missing ${field} was accepted`,
    ).toBeNull();
  }
  // The control: the shipped strings themselves are fine, so the rows
  // above fail for the word and for nothing else.
  expect(readFeed(FEED)).not.toBeNull();
});

test('🔴 an address that becomes a link must be https', () => {
  // 🔴 Mutation: delete the RENDERED_LINKS loop — fails on every row.
  const meta = FEED.meta as Record<string, unknown>;
  for (const field of ['sourceUrl', 'licenceUrl', 'termsUrl']) {
    for (const bad of [
      'javascript:alert(1)',
      'http://example.org/',
      '//example.org/',
      '',
      'https://',
      'https:// spaced',
    ]) {
      expect(
        readFeed({ ...FEED, meta: { ...meta, [field]: bad } }),
        `${field}=${JSON.stringify(bad)} was accepted`,
      ).toBeNull();
    }
    expect(readFeed({ ...FEED, meta: { ...meta, [field]: undefined } })).toBeNull();
  }
});

test('🔴 a place name we may not print costs the name, never the fire', () => {
  // `place` is EFFIS's proper noun, so the fetch script deliberately does
  // not refuse it — but it is rendered on the popup, under our voice.
  // Dropping the perimeter would lose a real fire; dropping the label
  // loses nothing, because the card falls back to "Burnt area in XX".
  // 🔴 Mutation: delete the RESERVED_WORDS test in readFire — fails.
  const fire = readFire({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 45]]] },
    properties: { id: '1', date: '2026-09-20', country: 'IT', place: 'Alert Ridge', hectares: 5 },
  });
  expect(fire, 'the fire itself was thrown away').not.toBeNull();
  expect(fire!.properties.place).toBe('');
  expect(fire!.properties.hectares).toBe(5);
  // An ordinary name survives untouched.
  expect(
    readFire({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 45]]] },
      properties: { id: '2', date: '2026-09-20', country: 'PT', place: 'Portel', hectares: 5 },
    })!.properties.place,
  ).toBe('Portel');
});

test('🔴 one unusable feature costs one feature, and never the render', () => {
  // 🔴 readFeed checked that `features` WAS an array and nothing about
  // what was in it, which made its own opening comment false:
  // `features: [null]` reached `fresh`, and `firesInView` then threw
  // "Cannot read properties of null (reading 'geometry')" out of a React
  // effect — the unmount this function exists to prevent, landing on a
  // blank map instead of on "No fresh wildfire data". Review found it.
  const good = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[10, 45], [11, 45], [11, 46], [10, 45]]] },
    properties: { id: 'ok', date: '2026-09-20', country: 'IT', place: 'Enna', hectares: 63 },
  };
  const rubbish = [
    null,
    undefined,
    42,
    'feature',
    {},
    { type: 'Feature' },
    { type: 'Feature', geometry: null, properties: good.properties },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 45] }, properties: good.properties },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: good.properties },
    { ...good, properties: { ...good.properties, date: undefined } },
    { ...good, properties: { ...good.properties, hectares: 'lots' } },
    { ...good, properties: null },
    // 🔴 Found by asking what ELSE the card prints: with no `place` it
    // prints `country`, so "Burnt area in DANGER" was one field away.
    { ...good, properties: { ...good.properties, country: 'DANGER' } },
    { ...good, properties: { ...good.properties, country: 'it' } },
    { ...good, properties: { ...good.properties, country: '' } },
    // 🔴 An array is not yet a shape. These all passed "non-empty array".
    { ...good, geometry: { type: 'Polygon', coordinates: [[['a', 'b']]] } },
    { ...good, geometry: { type: 'Polygon', coordinates: [[[Number.NaN, 45]]] } },
    { ...good, geometry: { type: 'Polygon', coordinates: [[[1e9, 45], [1e9, 46], [1e9 + 1, 46]]] } },
    { ...good, geometry: { type: 'Polygon', coordinates: [[[10, 95], [11, 95], [11, 96]]] } },
    { ...good, geometry: { type: 'Polygon', coordinates: [[]] } },
  ];
  const feed = readFeed({ ...FEED, features: [...rubbish, good] });
  expect(feed).not.toBeNull();
  expect(feed!.features).toHaveLength(1);
  expect(feed!.features[0].properties.id).toBe('ok');
  // 🔴 And the thing that actually crashed: it must not any more.
  expect(() =>
    firesInView(feed!.features, { west: -20, south: 30, east: 40, north: 60 }),
  ).not.toThrow();
  // Every one of them alone, so no single row carries the whole case.
  for (const bad of rubbish) {
    expect(readFire(bad), `${JSON.stringify(bad)} was accepted`).toBeNull();
  }

  // 🔴 A file whose records are ALL unreadable is not "no fires": `total ===
  // 0` would print "recorded no burnt areas" over it, the all-clear this
  // layer exists to refuse, produced by a schema change instead of the
  // world. It is `missing`, and says so.
  // Mutation: delete the `fires.length === 0` line in readFeed — fails.
  expect(readFeed({ ...FEED, features: [null] })).toBeNull();
  expect(readFeed({ ...FEED, features: rubbish })).toBeNull();
  expect(wildfireState({ ...FEED, features: [null] }, NOW).kind).toBe('missing');
  // …while a file that genuinely holds nothing is a legitimate feed.
  const empty = readFeed({ ...FEED, features: [] });
  expect(empty).not.toBeNull();
  expect(empty!.features).toHaveLength(0);
});

test('a state with nothing drawn never lets the reader read it as an all-clear', () => {
  // 🔴 The three states where the map is blank for a reason that is ours,
  // not the world's. Each has to disown the blankness in words.
  // 🔴 Mutation: drop the second sentence from the `missing` branch — fails.
  for (const state of [
    { kind: 'loading' } as const,
    { kind: 'missing' } as const,
    { kind: 'stale', meta: FEED.meta as never, hoursOld: 99 } as const,
  ]) {
    const note = wildfireNote(state, null);
    const said = `${note.headline} ${note.detail}`.toLowerCase();
    expect(note.tone, `${state.kind} was not marked as a gap`).toBe('gap');
    expect(said, `${state.kind} did not disown its own emptiness`).toMatch(
      /not a statement that nothing has burnt|not that nothing has burnt/,
    );
    expect(said).not.toMatch(/all clear|no fires|safe to/);
  }
});

test('“no fresh data” is said in those words, because that is the settled wording', () => {
  // 🔴 Mutation: change "No fresh wildfire data" to "Wildfire data
  // unavailable" — fails. The phrase is the one the hazard work agreed on
  // (docs/road-hazard-sources.md §2, point 6) and the e2e reads the page
  // for it, so it is not free to drift.
  expect(wildfireNote({ kind: 'missing' }, null).headline).toContain('No fresh wildfire data');
  expect(
    wildfireNote({ kind: 'stale', meta: FEED.meta as never, hoursOld: 99 }, null).headline,
  ).toContain('No fresh wildfire data');
});

test('nothing this layer says uses a word the CEMS terms reserve', () => {
  // 🔴 NOT A STYLE RULE. EFFIS and GWIS are named members of the CEMS
  // early warning and monitoring systems, and the CEMS terms say the data
  // "does not constitute in any way an early warning for which only
  // national/regional institutions are authorized within their region of
  // responsibility" (read 28.09.2026). So "warning", "danger", "risk" and
  // "alert" are words whose authority belongs to somebody else, and using
  // one of them against this data would be claiming that authority.
  // 🔴 Mutation: put "fire risk" anywhere in the caveat — fails.
  const states: WildfireState[] = [
    { kind: 'loading' },
    { kind: 'missing' },
    { kind: 'stale', meta: FEED.meta as never, hoursOld: 99 },
    { kind: 'fresh', meta: FEED.meta as never, fires: [] },
    { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] },
  ];
  for (const state of states) {
    for (const inView of [null, 0, 3]) {
      const note = wildfireNote(state, inView);
      const said = `${note.headline} ${note.detail}`;
      expect(said, `${state.kind}/${inView} used a reserved word: ${said}`).not.toMatch(
        RESERVED_WORDS,
      );
    }
  }
});

test('where fires are drawn, the page names whose job an official notice is', () => {
  // 🔴 The other half of the same clause. Refusing the reserved words is
  // not enough on its own: a reader still has to be told who does issue
  // them, or "not a warning" reads as "nobody is watching".
  // 🔴 Mutation: drop `meta.authorityNote` from the caveat — fails.
  for (const inView of [null, 0, 3]) {
    const note = wildfireNote(
      { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] },
      inView,
    );
    expect(`${note.headline} ${note.detail}`).toContain(
      'national and regional services are authorised',
    );
  }
});

test('the shipped credit is the one the CEMS terms dictate for modified data', () => {
  // 🔴 "Contains modified", not "Generated using". We filtered to the
  // EU-27, cut a window and rounded the coordinates, so the unmodified
  // notice would be the wrong one — and a feed carrying only the CC BY
  // line satisfies one licence while breaching the other.
  // 🔴 Mutation: drop the CEMS_NOTICE check from readFeed — fails below.
  const meta = (FEED as { meta: Record<string, string> }).meta;
  expect(meta.attribution).toMatch(CEMS_NOTICE);
  expect(meta.attribution).toContain('CC BY 4.0');
  expect(meta.termsUrl).toContain('terms');
  for (const bad of [
    'Copernicus EFFIS/GWIS — CC BY 4.0',
    'Contains modified Copernicus Emergency Management Service information [Year]',
    'Generated using Copernicus Emergency Management Service information 2026',
    // 🔴 The two notices, deliberately crossed. The mutation run showed
    // why: loosening the pattern to accept either verb changed no result,
    // because no fixture mixed them — so the half of the rule that says
    // WHICH notice ours is was never being driven.
    'Generated using modified Copernicus Emergency Management Service information 2026',
    '',
  ]) {
    expect(
      readFeed({ ...FEED, meta: { ...meta, attribution: bad } }),
      `a feed credited "${bad}" was accepted`,
    ).toBeNull();
  }
  expect(readFeed({ ...FEED, meta: { ...meta, authorityNote: '' } })).toBeNull();
});

test('nothing this layer says is an instruction', () => {
  // 🔴 Mirroring an official record is licensed; "do not drive there" is
  // an assertion of ours that no licence covers and no disclaimer repairs
  // (docs/road-hazard-sources.md §2). The decision stays the driver's, and
  // the text has to say so where there is something to decide about.
  // 🔴 Mutation: add "Avoid this area." to the caveat — fails on /avoid/.
  const banned =
    /\b(do not|don't|never|avoid|evacuate|stay away|you should not|unsafe|dangerous|danger|warning|alert|risk)\b/i;
  const states: WildfireState[] = [
    { kind: 'loading' },
    { kind: 'missing' },
    { kind: 'stale', meta: FEED.meta as never, hoursOld: 99 },
    { kind: 'fresh', meta: FEED.meta as never, fires: [] },
    { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] },
  ];
  for (const state of states) {
    for (const inView of [null, 0, 3]) {
      const note = wildfireNote(state, inView);
      const said = `${note.headline} ${note.detail}`;
      expect(said, `${state.kind}/${inView} gave an instruction: ${said}`).not.toMatch(banned);
    }
  }
});

test('where there is something to decide about, the decision is named as the reader’s', () => {
  // 🔴 Mutation: delete "where to drive is your call" from the caveat — fails.
  for (const inView of [null, 0, 3]) {
    const note = wildfireNote(
      { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] },
      inView,
    );
    expect(`${note.headline} ${note.detail}`).toContain('your call');
  }
});

test('the figure is always dated and always credited to Copernicus', () => {
  // 🔴 CC BY 4.0 asks for the source and, per this project's rule, the
  // date of the data beside it. A number with no date is a claim about
  // today made out of a fortnight-old file.
  // 🔴 Mutation: drop `period` from the fresh headline — fails.
  const note = wildfireNote(
    { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40), square(15, 41)] },
    1,
  );
  expect(note.headline).toContain('Copernicus EFFIS');
  expect(note.headline).toMatch(/\d{4}/);
  expect(note.headline).toContain('2');
});

test('“none recorded at all” and “none in this view” are different sentences', () => {
  // 🔴 We hold the WHOLE EU-27 set for the window, so an empty view here
  // really does mean none was recorded here — the campsites' "nothing in
  // view, not that we checked" would understate what we know. The two
  // must not collapse into one message.
  // 🔴 Mutation: make the `total === 0` branch fall through to the
  // `inView === 0` branch — fails, because "in this view" appears where
  // there is no view involved.
  const none = wildfireNote({ kind: 'fresh', meta: FEED.meta as never, fires: [] }, 0);
  const noneHere = wildfireNote(
    { kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] },
    0,
  );
  expect(none.headline).toContain('no burnt areas');
  expect(none.headline).not.toContain('this view');
  expect(noneHere.headline).toContain('this view');
  expect(noneHere.detail).toContain('none was recorded here');
});

// ── the clock ─────────────────────────────────────────────────────────

test('a successful read of an archive is stale, which is the realistic failure', () => {
  // 🔴 §8: the failure to design against is not "the fetch errored", it is
  // "the fetch succeeded and returned an archive". A green pipeline with
  // three-day-old perimeters looks healthy from every angle but one.
  // 🔴 Mutation: change `> FRESH_FOR_HOURS` to `> FRESH_FOR_HOURS * 10` — fails.
  const stale = wildfireState(feedAt('2026-09-24T18:00:00Z'), NOW); // 96 h
  expect(stale.kind).toBe('stale');
  const fresh = wildfireState(feedAt('2026-09-27T18:00:00Z'), NOW); // 24 h
  expect(fresh.kind).toBe('fresh');
});

test('the budget boundary is exactly where it claims to be', () => {
  // 🔴 Mutation: change `>` to `>=` — fails on the first of these.
  const at = new Date(NOW.getTime() - FRESH_FOR_HOURS * 3_600_000).toISOString();
  expect(wildfireState(feedAt(at), NOW).kind).toBe('fresh');
  const justOver = new Date(NOW.getTime() - (FRESH_FOR_HOURS * 3_600_000 + 60_000)).toISOString();
  expect(wildfireState(feedAt(justOver), NOW).kind).toBe('stale');
});

test('a clock that runs backwards does not buy infinite freshness', () => {
  // 🔴 A `fetchedAt` in the future reads as a negative age, and `age >
  // budget` is false for every negative number — a guard that would agree
  // with the bug for ever. Skew is real: the committed file is written on
  // one machine and read on another.
  // 🔴 Mutation: drop the `!(hoursOld >= 0)` arm — fails here.
  expect(wildfireState(feedAt('2027-01-01T00:00:00Z'), NOW).kind).toBe('stale');
  expect(hoursSince('2027-01-01T00:00:00Z', NOW)).toBeLessThan(0);
});

test('an unreadable timestamp is stale, not fresh', () => {
  // 🔴 Mutation: return 0 instead of Infinity from hoursSince on a bad
  // date — fails, because "unparseable" would then read as "just fetched".
  expect(hoursSince('not a date', NOW)).toBe(Number.POSITIVE_INFINITY);
});

// ── what we refuse to draw ────────────────────────────────────────────

test('anything that is not the file we wrote lands on “missing”, and says so', () => {
  // 🔴 A CDN serving an HTML error page, a half-written deploy, a shape
  // change: all of them must reach a sentence, never an exception inside a
  // React render. One absent field once blanked every campsite page on
  // this site (components/source-note.tsx).
  // 🔴 Mutation: delete any single guard in readFeed — fails on its row.
  const meta = FEED.meta as Record<string, unknown>;
  for (const [what, body] of [
    ['nothing', null],
    ['a string', '<html>502</html>'],
    ['a number', 7],
    ['no features array', { meta }],
    ['features not an array', { meta, features: {} }],
    ['no meta', { features: [] }],
    ['meta not an object', { meta: 'x', features: [] }],
    ['no fetchedAt', { meta: { ...meta, fetchedAt: undefined }, features: [] }],
    ['fetchedAt not a date', { meta: { ...meta, fetchedAt: 'soon' }, features: [] }],
    ['no since', { meta: { ...meta, since: undefined }, features: [] }],
    ['no attribution', { meta: { ...meta, attribution: undefined }, features: [] }],
    ['an empty attribution', { meta: { ...meta, attribution: '' }, features: [] }],
    ['no windowDays', { meta: { ...meta, windowDays: undefined }, features: [] }],
    ['windowDays as NaN', { meta: { ...meta, windowDays: Number.NaN }, features: [] }],
  ] as [string, unknown][]) {
    expect(readFeed(body), `${what} was accepted as a feed`).toBeNull();
    expect(wildfireState(body, NOW).kind, `${what} did not reach "missing"`).toBe('missing');
    const note = wildfireNote(wildfireState(body, NOW), null);
    expect(note.headline).toContain('No fresh wildfire data');
  }
});

test('a feed with no attribution is refused even though everything else is sound', () => {
  // 🔴 Drawing somebody else's data with the credit stripped is a licence
  // breach, and it is invisible until it is expensive. Refusing the feed
  // makes it visible on the page instead.
  // 🔴 Mutation: delete the attribution check from readFeed — fails.
  const meta = { ...(FEED.meta as object), attribution: '' };
  expect(readFeed({ ...FEED, meta })).toBeNull();
});

// ── how many are in front of the reader ───────────────────────────────

test('a fire is in view when its own box meets the reader’s', () => {
  const fires = [square(14, 40), square(20, 50), square(-8, 39)];
  const view = { west: 13, south: 39, east: 16, north: 42 };
  // 🔴 Mutation: swap `>=` for `>` on any bound, or drop one of the four
  // comparisons — fails on one of the rows below.
  expect(firesInView(fires, view)).toBe(1);
  expect(firesInView(fires, { west: -180, south: -90, east: 180, north: 90 })).toBe(3);
  expect(firesInView(fires, { west: 0, south: 0, east: 1, north: 1 })).toBe(0);
  // Touching the edge counts: a perimeter half off-screen is on screen.
  expect(firesInView([square(14, 40)], { west: 14.01, south: 40, east: 20, north: 45 })).toBe(1);

  // 🔴 Latitude on its own, because the first version of this test never
  // drove it: every fixture differed in longitude too, so deleting both
  // latitude comparisons left the whole suite green. Found by running the
  // mutation, not by reading the code. These three share one longitude
  // band and differ only in how far north they are.
  const column = [square(14, 30), square(14, 40), square(14, 50)];
  expect(firesInView(column, { west: 13, south: 39, east: 16, north: 42 })).toBe(1);
  expect(firesInView(column, { west: 13, south: 39, east: 16, north: 90 })).toBe(2);
  expect(firesInView(column, { west: 13, south: -90, east: 16, north: 35 })).toBe(1);
});

test('no view means no number, not a number of zero', () => {
  // 🔴 "None in this view" printed before the map has said where it is
  // looking is a false sentence. null travels through to a headline that
  // makes no claim about the view at all.
  // 🔴 Mutation: return 0 instead of null — fails, and so does the
  // headline check below.
  expect(firesInView([square(14, 40)], null)).toBeNull();
  const note = wildfireNote({ kind: 'fresh', meta: FEED.meta as never, fires: [square(14, 40)] }, null);
  expect(note.headline).not.toContain('this view');
});

test('a view made of NaN is not a view', () => {
  // 🔴 `map.getBounds()` on a map that has not yet laid out returns
  // exactly this, and NaN comparisons are all false — so every fire would
  // silently read as out of view.
  // 🔴 Mutation: drop the `Number.isFinite` check — fails.
  expect(firesInView([square(14, 40)], { west: NaN, south: 0, east: 1, north: 1 })).toBeNull();
});

test('a view wrapped past the antimeridian is two boxes, not an empty one', () => {
  // Europe never is one, but a reader who spins the globe should not be
  // told there are no fires because west > east.
  // 🔴 Mutation: drop the wrap arm — fails.
  expect(firesInView([square(179, 40)], { west: 170, south: 30, east: -170, north: 50 })).toBe(1);
});

test('a multipolygon’s box covers all of its parts', () => {
  // 🔴 Mutation: stop recursing in bboxOf — fails.
  const multi: WildfireFeature = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[10, 40], [10.1, 40], [10.1, 40.1], [10, 40]]],
        [[[20, 50], [20.1, 50], [20.1, 50.1], [20, 50]]],
      ],
    },
    properties: { id: 'm', date: '2026-09-20', country: 'IT', place: '', hectares: 1 },
  };
  expect(bboxOf(multi)).toEqual([10, 40, 20.1, 50.1]);
});

// ── the committed file itself ─────────────────────────────────────────

test('the file we ship is a feed this code accepts', () => {
  expect(readFeed(FEED)).not.toBeNull();
});

test('every fire we ship is in the EU-27, inside its window, and dated', () => {
  // 🔴 Scope is an owner decision (apps/api/src/osm/eu-member-states.json),
  // and this reads that file rather than a list of its own — a second copy
  // is how a country goes missing. EFFIS calls Greece EL; the fetch script
  // maps it back, and this proves it, because 147 Greek fires silently
  // absent is exactly the failure that would never be noticed.
  const feed = readFeed(FEED);
  expect(feed).not.toBeNull();
  const since = feed!.meta.since;
  for (const f of feed!.features) {
    expect(MEMBERS, `${f.properties.id} is outside the EU-27`).toContain(f.properties.country);
    expect(f.properties.date >= since, `${f.properties.id} is older than the window`).toBe(true);
    expect(formatDay(f.properties.date), `${f.properties.id} has no readable date`).not.toBeNull();
    expect(Number.isFinite(f.properties.hectares)).toBe(true);
    expect(f.geometry.coordinates.length).toBeGreaterThan(0);
  }
  expect(feed!.features.length).toBe(feed!.meta.kept);
  expect(feed!.features.length).toBeGreaterThan(0);
  // Greece is in the Union and burns every summer. If EFFIS's EL ever
  // stops being mapped back, `byCountry` loses GR and this notices.
  expect(Object.keys(feed!.meta.byCountry).every((c) => MEMBERS.includes(c))).toBe(true);
});

test('the shipped file stays inside the budget the route enforces', () => {
  // 🔴 The map's own view budget is 1.75 MB and this layer is on by
  // default, so it may never be what makes a view too heavy to draw on a
  // phone. 600 000 is the route's ceiling; measured today, 251 KB.
  const bytes = JSON.stringify(FEED).length;
  expect(bytes, `the wildfire file is ${bytes} bytes`).toBeLessThan(600_000);
});

test('the shipped file carries the licence it is used under', () => {
  const meta = (FEED as { meta: Record<string, string> }).meta;
  expect(meta.licence).toBe('CC BY 4.0');
  expect(meta.attribution).toContain('Copernicus');
  expect(meta.licenceUrl).toMatch(/^https:\/\//);
  expect(meta.sourceUrl).toMatch(/^https:\/\//);
});
