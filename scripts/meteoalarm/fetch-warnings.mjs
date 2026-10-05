#!/usr/bin/env node
// CAMP-148: MeteoAlarm warnings, and the filtering that makes them true.
//
//   node scripts/meteoalarm/fetch-warnings.mjs [--self-test] [--dry-run] [--country=poland]
//
// 🔴 THE FEED IS AN ARCHIVE WITH LIVE WARNINGS IN IT, and the provider's
// own documentation says otherwise. The Redistribution Hub states, word
// for word, "Therefore, only active warnings are included".
//
// Measured against the live JSON API on 05.10.2026:
//
//   Poland      878 info blocks, 350 expired (40%),  0 green, 528 kept
//   Croatia     110 info blocks,  42 expired (38%), 60 green,   8 kept
//   Slovenia      8 info blocks,   0 expired,        0 green,   8 kept
//   Austria       0 info blocks
//
// Believing that sentence means showing a driver yesterday's wind
// warning as current. So we drop, on EVERY read: anything whose
// `expires` has passed, anything answering `AllClear`, and anything at
// awareness level 1 — green is the absence of a warning, not a warning.
//
// 🔴 AND THE CARD'S REASON FOR CHOOSING THIS API IS WRONG.
//
// CAMP-148 and `docs/road-hazard-sources.md` §1 both say the JSON API is
// taken "because only it carries the NUTS codes we need to attach a
// warning to a campsite". Measured above: every geocode in all four
// countries is `EMMA_ID`, not NUTS — 878 of 878 in Poland — and
// Slovenia's eight blocks carry no geocode at all. So the codes are
// EMMA ids, some warnings have no code of any kind, and attaching them
// to a campsite is a harder problem than the card assumed. That is
// CAMP-149's subject; what this script must do is keep what the source
// actually gives, including the bare `areaDesc`, rather than throw away
// a warning because it is not shaped the way we expected.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'apps', 'web', 'src', 'data', 'warnings.json');

/** The 27 member states, as this feed spells them. EU-27 only (CAMP-124). */
export const COUNTRIES = [
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'denmark',
  'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland',
  'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands',
  'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden',
];

export const feedUrl = (country) =>
  `https://feeds.meteoalarm.org/api/v1/warnings/feeds-${country}`;

/**
 * `"4; Fog"` → `{ code: 4, label: 'Fog' }`.
 *
 * 🔴 The parameter values are a number and a word joined by a
 * semicolon, in both `awareness_level` and `awareness_type` — measured
 * on the live feed, not read in a schema. A reader that took the whole
 * string as the level would compare `"1; Minor"` against `1` and never
 * drop a green warning.
 */
export function awareness(value) {
  if (typeof value !== 'string') return { code: null, label: null };
  const [head, ...rest] = value.split(';');
  const code = Number.parseInt(head, 10);
  const label = rest.join(';').trim();
  return { code: Number.isFinite(code) ? code : null, label: label || null };
}

const paramOf = (info, name) =>
  (info?.parameter ?? []).find((p) => String(p?.valueName).toLowerCase() === name)?.value;

/** Every geocode on an area, as `SCHEME:VALUE`, plus the free-text name. */
export function areasOf(info) {
  return (info?.area ?? []).map((a) => ({
    name: typeof a?.areaDesc === 'string' ? a.areaDesc.trim() : null,
    codes: (a?.geocode ?? [])
      .filter((g) => g?.valueName && g?.value)
      .map((g) => `${g.valueName}:${g.value}`),
    // 🔴 Kept when the source gives it. Slovenia's warnings carry no
    // geocode at all, so a shape is the only thing that could place
    // them — throwing it away here would make that unrecoverable later.
    polygon: typeof a?.polygon === 'string' ? a.polygon : null,
    circle: typeof a?.circle === 'string' ? a.circle : null,
  }));
}

export const DROPPED = ['expired', 'allClear', 'green', 'unusable'];

/**
 * One reason, or null when the block is a warning we may show.
 *
 * 🔴 A REASON, NOT A BOOLEAN. The counts are what prove the filter is
 * doing anything, and a boolean cannot tell "nothing expired today"
 * from "the expiry check stopped running".
 */
export function dropReason(alert, info, now) {
  const expires = info?.expires ? Date.parse(info.expires) : Number.NaN;
  if (!Number.isFinite(expires)) return 'unusable';
  if (expires <= now.getTime()) return 'expired';

  const response = [alert?.responseType, info?.responseType].flat().filter(Boolean).map(String);
  if (response.some((r) => r.toLowerCase() === 'allclear')) return 'allClear';

  const level = awareness(paramOf(info, 'awareness_level')).code;
  // 🔴 Level 1 is green: "no particular awareness required". It is the
  // absence of a warning, and 60 of Croatia's 110 blocks were this.
  if (level === null || level <= 1) return 'green';

  if (!info?.event && !info?.headline) return 'unusable';
  return null;
}

/** The feed, filtered and normalised. Pure, so the self-test can drive it. */
export function warningsFrom(payload, country, now) {
  const counts = Object.fromEntries(DROPPED.map((d) => [d, 0]));
  const kept = [];
  let seen = 0;

  for (const entry of payload?.warnings ?? []) {
    const alert = entry?.alert;
    for (const info of alert?.info ?? []) {
      seen += 1;
      const why = dropReason(alert, info, now);
      if (why) {
        counts[why] += 1;
        continue;
      }
      const level = awareness(paramOf(info, 'awareness_level'));
      const type = awareness(paramOf(info, 'awareness_type'));
      kept.push({
        id: `${alert.identifier}#${kept.length}`,
        country,
        event: info.event ?? info.headline,
        headline: info.headline ?? null,
        description: info.description ?? null,
        instruction: info.instruction ?? null,
        onset: info.onset ?? info.effective ?? null,
        expires: info.expires,
        level: level.code,
        // 🔴 The source's own word for the hazard, passed through. We do
        // not translate it and we do not add one of our own.
        type: type.label,
        typeCode: type.code,
        areas: areasOf(info),
        sender: info.senderName ?? alert.sender ?? null,
        language: info.language ?? null,
      });
    }
  }
  return { country, seen, kept, counts };
}

// ---------------------------------------------------------------- self-test

function selfTest() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      bad += 1;
      console.log(`✗    ${name}${detail ? `  ${detail}` : ''}`);
    }
  };
  const NOW = new Date('2026-10-05T12:00:00Z');
  const block = (over = {}) => ({
    event: 'Fog',
    headline: 'Fog warning',
    expires: '2026-10-06T00:00:00Z',
    parameter: [
      { valueName: 'awareness_level', value: '3; Orange' },
      { valueName: 'awareness_type', value: '4; Fog' },
    ],
    area: [{ areaDesc: 'Coast', geocode: [{ valueName: 'EMMA_ID', value: 'PL803' }] }],
    ...over,
  });
  const feed = (infos, alertOver = {}) => ({
    warnings: [{ alert: { identifier: 'X', ...alertOver, info: infos } }],
  });

  ok('`"3; Orange"` is a level of 3, not a string', awareness('3; Orange').code === 3);
  ok('…and its label survives', awareness('4; Fog').label === 'Fog');
  ok('a value that is not that shape yields null, not NaN', awareness('Fog').code === null);
  ok('and a missing value does not throw', awareness(undefined).code === null);

  // 🔴 THE CARD'S OWN CRITERION: a payload where every record has
  // expired must produce ZERO warnings, not the record count. This is
  // the Polish shape measured on 28.09.2026 — 69 records, all expired.
  const polish = feed(
    Array.from({ length: 69 }, () => block({ expires: '2026-10-04T05:00:00Z' })),
  );
  const out = warningsFrom(polish, 'poland', NOW);
  ok(
    '🔴 69 expired records produce 0 warnings, not 69',
    out.kept.length === 0 && out.counts.expired === 69,
    JSON.stringify(out.counts),
  );
  ok('…and the count says so out loud', out.seen === 69);

  const green = warningsFrom(
    feed([block({ parameter: [{ valueName: 'awareness_level', value: '1; Minor' }] })]),
    'croatia',
    NOW,
  );
  ok('green is not a warning', green.kept.length === 0 && green.counts.green === 1);

  for (const shape of [{ responseType: 'AllClear' }, { responseType: ['AllClear'] }]) {
    const ac = warningsFrom(feed([block(shape)]), 'x', NOW);
    ok(
      `an all-clear is dropped however it is spelt (${JSON.stringify(shape.responseType)})`,
      ac.kept.length === 0 && ac.counts.allClear === 1,
    );
  }
  const acAlert = warningsFrom(feed([block()], { responseType: 'AllClear' }), 'x', NOW);
  ok('…including one declared on the alert rather than the info', acAlert.counts.allClear === 1);

  const noExpiry = warningsFrom(feed([block({ expires: undefined })]), 'x', NOW);
  ok(
    '🔴 a block with no expiry is dropped, not kept for ever',
    noExpiry.kept.length === 0 && noExpiry.counts.unusable === 1,
  );
  const badExpiry = warningsFrom(feed([block({ expires: 'soon' })]), 'x', NOW);
  ok('…and neither is one whose expiry is not a date', badExpiry.counts.unusable === 1);

  // 🔴 The boundary, named: expiring exactly now is expired.
  const edge = warningsFrom(feed([block({ expires: NOW.toISOString() })]), 'x', NOW);
  ok('a warning expiring at this instant is over', edge.counts.expired === 1);
  const live = warningsFrom(feed([block({ expires: '2026-10-05T12:00:01Z' })]), 'x', NOW);
  ok('…and one second later it is not', live.kept.length === 1);

  // Offsets, because the feed writes local time with one.
  const offset = warningsFrom(feed([block({ expires: '2026-10-05T15:00:00+02:00' })]), 'x', NOW);
  ok(
    'an expiry written with an offset is compared as an instant',
    offset.kept.length === 1,
    JSON.stringify(offset.counts),
  );

  const slovene = warningsFrom(feed([block({ area: [{ areaDesc: 'Gorenjska' }] })]), 'slovenia', NOW);
  ok(
    '🔴 a warning with no geocode is KEPT, with its area name',
    slovene.kept.length === 1 &&
      slovene.kept[0].areas[0].codes.length === 0 &&
      slovene.kept[0].areas[0].name === 'Gorenjska',
  );
  const shaped = warningsFrom(
    feed([block({ area: [{ areaDesc: 'Bay', polygon: '45,13 45,14 46,14 45,13' }] })]),
    'x',
    NOW,
  );
  ok('…and a polygon is kept when the source gives one', shaped.kept[0].areas[0].polygon !== null);

  const kept = warningsFrom(feed([block()]), 'poland', NOW).kept[0];
  ok('the hazard keeps the source’s own word', kept.type === 'Fog' && kept.typeCode === 4);
  ok('the level is the number, not the string', kept.level === 3);
  ok('the area code carries its scheme', kept.areas[0].codes[0] === 'EMMA_ID:PL803');

  ok('every member state is listed exactly once', new Set(COUNTRIES).size === 27);
  ok('the url is built from the country', feedUrl('poland').endsWith('/feeds-poland'));

  console.log(bad ? `\n✗ ${bad} self-test failure(s)` : '\n✓ self-test passed');
  return bad;
}

if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

// -------------------------------------------------------------------- main

const PAUSE_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv.find((a) => a.startsWith('--country='))?.split('=')[1];
  const countries = only ? [only] : COUNTRIES;
  const now = new Date();
  const all = [];
  const totals = Object.fromEntries(DROPPED.map((d) => [d, 0]));
  let seen = 0;
  const silent = [];

  for (const country of countries) {
    await sleep(PAUSE_MS);
    let payload;
    try {
      const res = await fetch(feedUrl(country));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload = await res.json();
    } catch (err) {
      // 🔴 One country failing is not the run failing, but it is not
      // silence either: a country that answers nothing and a country
      // that errors must not look the same in the output.
      console.log(`  ${country}: ${String(err.message).slice(0, 60)}`);
      silent.push(country);
      continue;
    }
    const out = warningsFrom(payload, country, now);
    seen += out.seen;
    for (const d of DROPPED) totals[d] += out.counts[d];
    all.push(...out.kept);
    console.log(
      `  ${country.padEnd(12)} ${String(out.seen).padStart(4)} seen  ${String(out.kept.length).padStart(4)} kept` +
        `  (${DROPPED.map((d) => `${d} ${out.counts[d]}`).join(', ')})`,
    );
  }

  console.log(
    `\n${seen} info blocks, ${all.length} warnings kept; dropped ` +
      DROPPED.map((d) => `${totals[d]} ${d}`).join(', '),
  );
  if (silent.length) console.log(`countries that did not answer: ${silent.join(', ')}`);

  // 🔴 Refuses to write a file that says Europe is calm because the
  // filter broke. Every country failing, or nothing at all surviving
  // across 27 states, is far more likely to be us than the weather.
  if (silent.length === countries.length) throw new Error('no country answered');
  if (seen === 0) throw new Error('every feed was empty — that is a fetch failure, not a quiet day');

  const doc = {
    meta: {
      source: 'MeteoAlarm (EUMETNET)',
      sourceUrl: 'https://meteoalarm.org/',
      fetchedAt: now.toISOString(),
      seen,
      kept: all.length,
      dropped: totals,
      silent,
      note:
        'The feed is an archive with live warnings in it. Expired, all-clear ' +
        'and green (level 1) records are dropped on every read — the Hub says ' +
        'only active warnings are included, and 40% of Poland was expired.',
    },
    warnings: all,
  };
  if (process.argv.includes('--dry-run')) {
    console.log('(dry run — nothing written)');
    return;
  }
  await writeFile(OUT, `${JSON.stringify(doc)}\n`, 'utf8');
  console.log(`wrote ${OUT}`);
}

await main();
