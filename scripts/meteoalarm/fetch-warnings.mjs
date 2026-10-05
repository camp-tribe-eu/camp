#!/usr/bin/env node
// CAMP-148: MeteoAlarm warnings, and the filtering that makes them true.
//
//   node scripts/meteoalarm/fetch-warnings.mjs [--self-test] [--dry-run] [--country=poland]
//
// 🔴 THE FEED IS AN ARCHIVE WITH LIVE WARNINGS IN IT, and the provider's
// own documentation says otherwise. The Redistribution Hub states, word
// for word, "Therefore, only active warnings are included".
//
// Measured against the live JSON API on 05.10.2026, with the filter as
// it stands now:
//
//   Poland     878 blocks →  264   350 expired, 264 language repeats
//   Germany    688 blocks →   10   608 expired,  70 repeats (8 languages)
//   Croatia    110 blocks →    4    42 expired,  60 green
//   Slovenia     8 blocks →    4     8 blocks are 4 alerts in 2 languages
//   Hungary    490 blocks →    0   294 expired, 196 green — honestly none
//
// 🔴 EVERY NUMBER IN THIS BLOCK HAS BEEN WRONG ONCE. The first version
// advertised Poland 528 and Croatia 8, which were the counts before
// duplicates were removed; they stayed in the comment after the code
// changed under them. A table that is not re-measured with the code it
// describes is a claim, and this file's whole subject is claims that
// were not re-measured.
//
// Believing that sentence means showing a driver yesterday's wind
// warning as current. So we drop, on EVERY read: anything whose
// `expires` has passed, anything answering `AllClear`, and anything at
// awareness level 1 — green is the absence of a warning, not a warning.
//
// 🔴 AND THE CARD'S REASON FOR CHOOSING THIS API IS WRONG — AS WAS MY
// FIRST CORRECTION OF IT.
//
// CAMP-148 said the JSON API is taken "because only it carries the NUTS
// codes we need". I measured four countries, found `EMMA_ID` in all of
// them, and wrote "there is no NUTS code anywhere in it". Review
// measured ELEVEN and that is false too — I had corrected a
// generalisation with a generalisation, from a sample one country
// wider:
//
//   EMMA_ID      22 194   most countries
//   WARNCELLID    5 608   Germany, alongside EMMA_ID
//   NUTS3         2 554   France — and France has NO EmMA_ID at all
//   FIPS            393   Ireland — likewise none
//
// So there are four schemes, they differ by country, and some warnings
// (Slovenia) carry no code at all. That makes CAMP-149 harder than
// either version of this paragraph claimed, and it is the reason this
// script keeps whatever the source gives — every `SCHEME:VALUE` pair,
// the free-text `areaDesc`, and any polygon — rather than reaching for
// the one scheme we expected.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

export const DROPPED = ['expired', 'notYet', 'allClear', 'green', 'unusable', 'duplicate'];

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

  // 🔴 "CURRENT" MEANS PUBLISHED AND NOT EXPIRED — and my first attempt
  // at this silenced six countries.
  //
  // I added a check that dropped every warning whose `onset` is in the
  // future, to stop a Croatian storm 58 hours out reading as in force.
  // Review measured what it actually killed across 13 feeds: 528
  // dropped, of which **496 had `effective` already in the past** —
  // published, in force, and forecasting a hazard for later today. Only
  // 23 were more than 48 hours out. Croatia went 110 → 0, Hungary
  // 490 → 0, Ireland 18 → 0, Slovenia 8 → 0.
  //
  // A forecast warning IS the product. "There will be ice tonight" is
  // the sentence a driver needs before they set off, not after.
  //
  // So the test is PUBLICATION, not start: a warning counts while the
  // issuing service has released it (`effective`) and it has not
  // expired. The `onset` is carried so the page can say when it begins
  // — which is the honest way to show a storm 58 hours out, rather than
  // hiding it or pretending it is already blowing.
  const effective = info?.effective ? Date.parse(info.effective) : Number.NaN;
  const published = Number.isFinite(effective)
    ? effective
    : (info?.onset ? Date.parse(info.onset) : Number.NaN);
  if (Number.isFinite(published) && published > now.getTime()) return 'notYet';

  const response = [alert?.responseType, info?.responseType].flat().filter(Boolean).map(String);
  if (response.some((r) => r.toLowerCase() === 'allclear')) return 'allClear';

  const level = awareness(paramOf(info, 'awareness_level')).code;
  // 🔴 Level 1 is green: "no particular awareness required". It is the
  // absence of a warning, and 60 of Croatia's 110 blocks were this.
  //
  // ⚠️ `level === null ||` is written out although JS does not need it:
  // `null <= 1` is already true, because `null` coerces to 0. Review
  // listed this clause as untested, and it is — deleting it keeps every
  // assertion green, because the two forms are behaviourally identical.
  // That is not a hole in the test; no test can distinguish them.
  //
  // It stays because the coercion is a trap, not a feature: a reader
  // who deletes it will be right, and a reader who later changes `<=`
  // to a comparison that does NOT coerce will be wrong and will have
  // had no warning. The explicit clause says what the code means
  // without depending on a rule nobody should have to remember.
  if (level === null || level <= 1) return 'green';

  if (!info?.event && !info?.headline) return 'unusable';
  return null;
}

/** The feed, filtered and normalised. Pure, so the self-test can drive it. */
export function warningsFrom(payload, country, now) {
  const counts = Object.fromEntries(DROPPED.map((d) => [d, 0]));
  const kept = [];
  let seen = 0;

  // 🔴 ONE ROW PER ALERT AND AREA, NOT PER LANGUAGE.
  //
  // An alert carries one `info` block per language it is published in,
  // and the first version of this kept every one of them. Measured by
  // review across 11 feeds: 994 rows for 470 distinct alerts — 53%
  // repeats. Poland's advertised "528 kept" was 264 warnings in pl-PL
  // and en-GB; Germany ships each alert eight times.
  //
  // We take the English block where there is one, because that is the
  // language this site is written in, and otherwise the first one the
  // source gives — never a guess and never a translation of ours.
  const byKey = new Map();
  const preferEnglish = (a, b) => {
    const en = (x) => /^en/i.test(String(x?.language ?? ''));
    return en(a) && !en(b);
  };

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
      const areas = areasOf(info);
      // 🔴 AN IDENTITY, NOT A POSITION. This was
      // `${identifier}#${kept.length}` — an index into whatever
      // survived the filter. Review stepped `now` across a single
      // expiry on the live Poland feed and 876 of 876 survivors were
      // renumbered, so every id changed between two runs minutes
      // apart. Anything downstream that upserts or dedups by id would
      // see a wholly new set each time.
      //
      // The alert's own identifier plus the areas it is about is
      // stable across runs and distinguishes the one case where a
      // single alert carries several areas.
      // 🔴 THE KEY MUST NOT CONTAIN A TRANSLATED STRING.
      //
      // It fell back to `a.name`, which is `areaDesc` — and `areaDesc`
      // is in the language of the block. So in exactly the countries
      // that send no geocode, the same alert produced two different
      // keys and two rows: Estonia 32 of 32 alerts doubled, Slovenia 4
      // of 4, and `counts.duplicate` reported ZERO, because the
      // duplicates never collided. One Slovenian alert came out as both
      // `…|Slovenija / jugozahod` and `…|Slovenia / South-West`.
      //
      // The counter certifying a failure is worse than the failure. So
      // the fallback is the area's POSITION within the alert, which is
      // the same number in every language, and the shape where there is
      // one — never a word a translator chose.
      const areaKey = areas
        .map((a, i) => a.codes.join('+') || a.polygon || a.circle || `#${i}`)
        .join('|');
      const key = `${alert.identifier}|${areaKey}`;
      const row = {
        id: key,
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
        areas,
        sender: info.senderName ?? alert.sender ?? null,
        language: info.language ?? null,
      };
      const held = byKey.get(key);
      if (!held) {
        byKey.set(key, row);
      } else {
        // 🔴 Counted on EVERY repeat, whichever of the two we keep. The
        // first version incremented only when the newcomer lost, so an
        // English block arriving after a Polish one was replaced
        // silently and the number said no duplicates existed.
        counts.duplicate += 1;
        if (preferEnglish(row, held)) byKey.set(key, row);
      }
    }
  }
  kept.push(...byKey.values());
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
      // 🔴 Real shapes, measured on the live feed. `awareness_level`
      // carries THREE fields — `"2; yellow; Moderate"` 2 953 times,
      // `"1; green; Minor"` 763 — and the comment above once claimed it
      // had the same two-field shape as `awareness_type`. Only `.code`
      // is read, so nothing shipped wrong, but the fixture was a shape
      // the source never sends.
      { valueName: 'awareness_level', value: '3; orange; Severe' },
      { valueName: 'awareness_type', value: '4; Fog' },
    ],
    area: [{ areaDesc: 'Coast', geocode: [{ valueName: 'EMMA_ID', value: 'PL803' }] }],
    ...over,
  });
  const feed = (infos, alertOver = {}) => ({
    warnings: [{ alert: { identifier: 'X', ...alertOver, info: infos } }],
  });

  ok('`"3; orange; Severe"` is a level of 3, not a string', awareness('3; orange; Severe').code === 3);
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

  // 🔴 THE PAYLOAD, NOT ONLY THE FILTER — and this half did not exist.
  //
  // Review changed eleven single lines and every assertion stayed
  // green: `event: null`, a hardcoded `country`, a constant `id`, and
  // `expires`/`headline`/`description`/`instruction`/`onset`/`sender`/
  // `language`/`circle` all forced to null. `event: null` alone would
  // ship every warning on the site without its text, with CI green.
  //
  // So every field a page could read is now asserted to come from the
  // source, by a value that appears nowhere else.
  {
    const full = block({
      event: 'EVT',
      headline: 'HEAD',
      description: 'DESC',
      instruction: 'INST',
      onset: '2026-10-05T11:00:00Z',
      expires: '2026-10-06T00:00:00Z',
      senderName: 'SENDER',
      language: 'en-GB',
      area: [
        {
          areaDesc: 'AREA',
          geocode: [{ valueName: 'NUTS3', value: 'FR712' }],
          polygon: 'POLY',
          circle: 'CIRC',
        },
      ],
    });
    const w = warningsFrom(feed([full], { identifier: 'ID1' }), 'france', NOW).kept[0];
    const carried = {
      event: w?.event,
      headline: w?.headline,
      description: w?.description,
      instruction: w?.instruction,
      onset: w?.onset,
      expires: w?.expires,
      sender: w?.sender,
      language: w?.language,
      country: w?.country,
      level: w?.level,
      type: w?.type,
      areaName: w?.areas?.[0]?.name,
      areaCode: w?.areas?.[0]?.codes?.[0],
      polygon: w?.areas?.[0]?.polygon,
      circle: w?.areas?.[0]?.circle,
    };
    const want = {
      event: 'EVT',
      headline: 'HEAD',
      description: 'DESC',
      instruction: 'INST',
      onset: '2026-10-05T11:00:00Z',
      expires: '2026-10-06T00:00:00Z',
      sender: 'SENDER',
      language: 'en-GB',
      country: 'france',
      level: 3,
      type: 'Fog',
      areaName: 'AREA',
      areaCode: 'NUTS3:FR712',
      polygon: 'POLY',
      circle: 'CIRC',
    };
    for (const [field, expected] of Object.entries(want)) {
      ok(
        `the payload carries ${field} from the source`,
        carried[field] === expected,
        `got ${JSON.stringify(carried[field])}, want ${JSON.stringify(expected)}`,
      );
    }
    ok('the id is the alert identifier and its areas, not a position',
      w?.id === 'ID1|NUTS3:FR712', String(w?.id));
  }

  // 🔴 MORE THAN ONE OF EVERYTHING, because every fixture above has
  // exactly one area carrying exactly one code — and four mutations
  // walked through that gap with the suite green:
  //
  //   `.slice(0, 1)` on areas    → 60 of 80 live areas lost
  //   `.slice(0, 1)` on geocodes → 724 codes lost, including ALL 666
  //                                German WARNCELLIDs — the very scheme
  //                                this file's doc correction is about
  //   dropping `?? info.effective`
  //   dropping `?? alert.sender`
  //
  // Measured live: 1 012 blocks carry more than one area, the largest
  // 169 of them.
  {
    const many = block({
      onset: undefined,
      effective: '2026-10-05T09:00:00Z',
      senderName: undefined,
      area: [
        {
          areaDesc: 'First',
          geocode: [
            { valueName: 'WARNCELLID', value: '111' },
            { valueName: 'EMMA_ID', value: 'DE222' },
          ],
        },
        { areaDesc: 'Second', geocode: [{ valueName: 'EMMA_ID', value: 'DE333' }] },
        { areaDesc: 'Third', geocode: [{ valueName: 'EMMA_ID', value: 'DE444' }] },
      ],
    });
    const w = warningsFrom(feed([many], { identifier: 'M', sender: 'ALERT-SENDER' }), 'germany', NOW)
      .kept[0];
    ok('every area of a warning is carried, not just the first', w?.areas?.length === 3,
      JSON.stringify(w?.areas?.map((a) => a.name)));
    ok('every geocode of an area is carried, not just the first',
      w?.areas?.[0]?.codes?.length === 2, JSON.stringify(w?.areas?.[0]?.codes));
    ok('…and both schemes survive side by side',
      w?.areas?.[0]?.codes?.join(',') === 'WARNCELLID:111,EMMA_ID:DE222');
    ok('🔴 onset falls back to `effective` when the source gives no onset',
      w?.onset === '2026-10-05T09:00:00Z', String(w?.onset));
    ok('🔴 the sender falls back to the alert when the info has none',
      w?.sender === 'ALERT-SENDER', String(w?.sender));
    ok('the id lists every area, so two alerts over different ground differ',
      w?.id === 'M|WARNCELLID:111+EMMA_ID:DE222|EMMA_ID:DE333|EMMA_ID:DE444', String(w?.id));
  }

  // 🔴 THE DEDUP KEY MUST NOT CONTAIN A TRANSLATED WORD. Where there is
  // no geocode, the fallback used to be `areaDesc` — which differs by
  // language, so Estonia's 32 alerts all became 64 rows and the
  // duplicate counter said zero.
  {
    const sl = feed(
      [
        block({ language: 'sl-SI', area: [{ areaDesc: 'Slovenija / jugozahod' }] }),
        block({ language: 'en-GB', area: [{ areaDesc: 'Slovenia / South-West' }] }),
      ],
      { identifier: 'SI-1' },
    );
    const out = warningsFrom(sl, 'slovenia', NOW);
    ok('🔴 the same alert in two languages with NO geocode is one warning',
      out.kept.length === 1, JSON.stringify(out.kept.map((k) => k.id)));
    ok('…and the counter sees the repeat it used to be blind to',
      out.counts.duplicate === 1, JSON.stringify(out.counts));
    ok('…and the key holds no translated word',
      !/Slovenija|South-West/.test(String(out.kept[0]?.id)), String(out.kept[0]?.id));
  }

  // 🔴 ONE ROW PER ALERT AND AREA, not per language. 53% of what the
  // first version kept were the same warnings in another language.
  {
    const two = feed(
      [
        block({ language: 'pl-PL', event: 'Mgła' }),
        block({ language: 'en-GB', event: 'Fog' }),
      ],
      { identifier: 'SAME' },
    );
    const out = warningsFrom(two, 'poland', NOW);
    ok('the same alert in two languages is one warning', out.kept.length === 1, JSON.stringify(out.counts));
    ok('…and the English text is the one kept', out.kept[0].event === 'Fog', out.kept[0].event);
    ok('…and the repeat is counted, not silently dropped', out.counts.duplicate === 1);
    // Two AREAS of one alert are two warnings, which is the case this
    // must not over-merge.
    const twoAreas = feed(
      [
        block({ area: [{ areaDesc: 'North', geocode: [{ valueName: 'EMMA_ID', value: 'A' }] }] }),
        block({ area: [{ areaDesc: 'South', geocode: [{ valueName: 'EMMA_ID', value: 'B' }] }] }),
      ],
      { identifier: 'SAME' },
    );
    ok('two areas of one alert stay two warnings', warningsFrom(twoAreas, 'x', NOW).kept.length === 2);
  }

  // 🔴 A WARNING THAT HAS NOT STARTED IS NOT CURRENT. 336 of 986 kept
  // rows had a future `onset`, one of them 58 hours out.
  {
    const future = warningsFrom(feed([block({ onset: '2026-10-07T00:00:00Z' })]), 'x', NOW);
    ok('a warning that starts in two days is not current', future.kept.length === 0 && future.counts.notYet === 1);
    const started = warningsFrom(feed([block({ onset: '2026-10-05T11:59:59Z' })]), 'x', NOW);
    ok('…and one that started a second ago is', started.kept.length === 1);
    const noOnset = warningsFrom(feed([block({ onset: undefined, effective: undefined })]), 'x', NOW);
    ok('…and no onset at all does not drop it', noOnset.kept.length === 1);
  }

  // 🔴 The three filter branches no mutation touched.
  {
    const noLevel = warningsFrom(feed([block({ parameter: [] })]), 'x', NOW);
    ok('a block with no awareness level is not a warning', noLevel.kept.length === 0 && noLevel.counts.green === 1);
    const noText = warningsFrom(feed([block({ event: undefined, headline: undefined })]), 'x', NOW);
    ok('a block with neither event nor headline is unusable', noText.counts.unusable === 1);
    const lower = warningsFrom(feed([block({ responseType: 'allclear' })]), 'x', NOW);
    ok('an all-clear in lower case is still an all-clear', lower.counts.allClear === 1);
  }

  ok('every member state is listed exactly once', new Set(COUNTRIES).size === 27);
  ok('the url is built from the country', feedUrl('poland').endsWith('/feeds-poland'));

  console.log(bad ? `\n✗ ${bad} self-test failure(s)` : '\n✓ self-test passed');
  return bad;
}



// -------------------------------------------------------------------- main

const PAUSE_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv.find((a) => a.startsWith('--country='))?.split('=')[1];
  const countries = only ? [only] : COUNTRIES;
  // 🔴 ONE COUNTRY NEVER WRITES THE FILE. `--country=croatia` produced a
  // document shaped like a full-Europe run, with `meta.silent: []` —
  // nothing in it recorded that twenty-six countries were never asked.
  // A partial read may be inspected; it may not become the published
  // answer.
  const dryRun = process.argv.includes('--dry-run') || Boolean(only);
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
  // 🔴 A PARTIAL FAILURE MUST NOT PUBLISH "EUROPE IS CALM".
  //
  // The first version refused only when EVERY country failed or nothing
  // at all was seen. Review walked through the hole: 26 countries
  // erroring plus one answering with 148 blocks that are all expired
  // satisfies both conditions, and the file is written with an empty
  // warning list. The site would then say nowhere in Europe has a
  // warning, on the strength of one country.
  //
  // A quarter of the union unreachable is us, not the weather; and a
  // run that kept nothing while anything failed cannot tell an empty
  // Europe from a broken fetch.
  const QUARTER = Math.ceil(countries.length / 4);
  if (silent.length >= QUARTER) {
    throw new Error(
      `${silent.length} of ${countries.length} countries did not answer (${silent.join(', ')})`,
    );
  }
  // 🔴 A RUN THAT KEEPS NOTHING FROM A FULL EUROPE IS US, NOT THE
  // WEATHER. Review renamed one upstream parameter and got 6 573 blocks
  // seen, 0 kept, 0 silent — every transport guard satisfied, and the
  // file written saying the continent is calm. The guards asked whether
  // we could REACH the feeds, never whether we understood them.
  if (seen > 0 && all.length === 0) {
    throw new Error(
      `${seen} blocks were read across ${countries.length - silent.length} ` +
        'countries and NONE survived the filter — that is a parsing failure, ' +
        'not a calm continent',
    );
  }
  if (all.length === 0 && silent.length > 0) {
    throw new Error(
      'nothing was kept and ' +
        `${silent.length} country(ies) failed — an empty Europe and a broken fetch look the same`,
    );
  }
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
  if (dryRun) {
    console.log(only ? `(one country — nothing written)` : '(dry run — nothing written)');
    return;
  }
  await writeFile(OUT, `${JSON.stringify(doc)}\n`, 'utf8');
  console.log(`wrote ${OUT}`);
}

// 🔴 ONLY WHEN RUN, NEVER WHEN IMPORTED.
//
// This was a bare `await main()` after seven `export`s. Review did
// `await import('./fetch-warnings.mjs')` and it performed real network
// fetches; without `--dry-run` in argv — and no test runner supplies
// one — it would fetch 27 countries and overwrite
// `apps/web/src/data/warnings.json`, which is tracked. A module that
// cannot be imported without side effects cannot be unit-tested at all.
const RUN_DIRECTLY =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

// 🔴 BOTH entry points below the guard. `--self-test` used to sit above
// it, so importing this module with `--self-test` anywhere in argv ran
// the suite and called `process.exit` — a module that can kill its
// importer is not importable.
if (RUN_DIRECTLY) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  await main();
}
