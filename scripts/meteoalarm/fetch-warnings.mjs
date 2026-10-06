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
// 🔴 AND THE CARD'S REASON FOR CHOOSING THIS API IS WRONG — AS WERE MY
// FIRST TWO CORRECTIONS OF IT.
//
// CAMP-148 said the JSON API is taken "because only it carries the NUTS
// codes we need". I measured four countries, found `EMMA_ID` in all of
// them, and wrote "there is no NUTS code anywhere in it". Review
// measured ELEVEN: also false. I then wrote "four schemes" from those
// eleven — correcting a generalisation with a generalisation, twice,
// each time from a sample one country wider.
//
// All 27 feeds, 2026-10-05T08:17Z — reproduce with `--census`:
//
//   EMMA_ID      26 686   16 countries
//   NUTS3         7 594   France, Bulgaria
//   WARNCELLID    5 672   Germany, alongside EMMA_ID
//   NUTS2           566   Belgium (alongside EMMA_ID), Hungary
//   FIPS            393   Ireland — and Ireland has no EMMA_ID at all
//   CISORP            6   Czechia, alongside EMMA_ID
//
// Six schemes, several countries carrying two at once, and three member
// states — Estonia, Slovenia, Sweden — putting no code on any area.
// Latvia codes 14 of its 508. That makes CAMP-149 harder than any
// version of this paragraph claimed, and it is why this script keeps
// whatever the source gives — every `SCHEME:VALUE` pair, the free-text
// `areaDesc`, and any polygon — rather than reaching for the one scheme
// we expected.
//
// 🔴 THESE COUNTS DRIFT, AND THAT IS WHY `--census` EXISTS. Review and I
// disagreed on NUTS3 by 504 and neither of us was wrong: we had measured
// snapshots 22 minutes apart. EMMA_ID moved 26 404 → 26 686 within the
// hour. Re-run the command rather than trusting the figures above; a
// number in a comment is a measurement or it is a decoration.

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

/** A CAP shape field, which may be absent, one string, or several. */
export const shapesOf = (v) =>
  (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x.trim() !== '');

/** Every geocode on an area, as `SCHEME:VALUE`, plus the free-text name. */
export function areasOf(info) {
  return (info?.area ?? []).map((a) => ({
    name: typeof a?.areaDesc === 'string' ? a.areaDesc.trim() : null,
    codes: (a?.geocode ?? [])
      .filter((g) => g?.valueName && g?.value)
      .map((g) => `${g.valueName}:${g.value}`),
    // 🔴 AND THIS LINE WAS THROWING AWAY THE THING ITS OWN COMMENT SAID
    // IT WAS SAVING. It read `typeof a?.polygon === 'string' ? … : null`,
    // and CAP lets `<polygon>` repeat, so the feed sends an ARRAY. Every
    // one of Estonia's 192 areas carries a shape and `areasOf` returned
    // null for all 192 — in the one country where a shape is the only
    // thing that could place a warning, because it sends no geocode at
    // all. Slovenia and Sweden are in the same position.
    //
    // Always a list, never a bare string: one polygon and three are the
    // same kind of answer, and a caller that forgets to check which it
    // got would otherwise place a warning over the wrong ring.
    polygons: shapesOf(a?.polygon),
    circles: shapesOf(a?.circle),
  }));
}

export const DROPPED = ['expired', 'allClear', 'green', 'unusable', 'duplicate'];

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

  // 🔴 THERE IS NO "NOT YET PUBLISHED" TEST, AND THIS LINE HAS NOW BEEN
  // WRONG THREE TIMES.
  //
  // First I dropped every warning whose `onset` was in the future, so a
  // storm 58 hours out would not read as in force. That silenced four
  // countries outright — Croatia 110 → 0, Hungary 490 → 0, Ireland
  // 18 → 0, Slovenia 8 → 0 — because 496 of the 528 blocks it killed
  // had already been published and were forecasting later the same day.
  //
  // So I moved the test to `effective`. Review measured that too: 128
  // blocks across five countries, every one with `alert.sent` in the
  // past. Sweden kept 2 of 22. Estonia kept 6 of 80 — Estonia omits
  // `effective` entirely (892 blocks do), so the fallback landed back
  // on `onset`: the original bug wearing the fix's name. And in SMHI,
  // Italy, France and Bulgaria `effective` EQUALS `onset` on 679
  // blocks. It is when the hazard starts, not when the notice issued.
  //
  // The publication field is `alert.sent` — present on 6 669 of 6 669
  // blocks. But a `sent` in the future cannot mean "unpublished": it is
  // the issuing time of the message already in our hands. The only 18
  // such blocks measured are Bulgaria's, all exactly 72 minutes ahead.
  // That is a clock, not an embargo.
  //
  // A filter with no demonstrated true positive and three demonstrated
  // classes of false positive is not a filter. It is gone. `onset` and
  // `effective` ride through to the page so it can say when a hazard
  // begins — the actual requirement behind all three attempts — and a
  // `sent` ahead of now is COUNTED in `meta.publishedAhead` rather than
  // dropped, so a genuine future-dating would surface instead of
  // passing in silence.

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
  // 🔴 Counted, never dropped. See the note in `dropReason`.
  let publishedAhead = 0;
  // 🔴 THE SHAPE WE DEPEND ON, NOT THE WEATHER IT REPORTS.
  // `awareness(…).code` of `null` falls into the `green` branch, so a
  // renamed upstream parameter does not announce itself as broken — it
  // declares the whole continent calm. Measured on all 27 feeds: 6 669
  // of 6 669 blocks across the 23 countries that serve any carry a
  // readable level. A country where NONE does has stopped being
  // understood, and that is independent of how quiet its sky is.
  let unreadable = 0;

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
      const sentAt = alert?.sent ? Date.parse(alert.sent) : Number.NaN;
      if (Number.isFinite(sentAt) && sentAt > now.getTime()) publishedAhead += 1;
      if (awareness(paramOf(info, 'awareness_level')).code === null) unreadable += 1;
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
        // 🔴 The shape half of this key read `.polygon`/`.circle`, renamed
        // in this same commit, so it was always `undefined` and every
        // shape-only area fell through to its POSITION. Nothing is lost
        // today only because `alert.identifier` happens to be unique;
        // two alerts sharing one would have collided into a single row.
        .map((a, i) => a.codes.join('+') || a.polygons.join('+') || a.circles.join('+') || `#${i}`)
        .join('|');
      const key = `${alert.identifier}|${areaKey}`;
      const row = {
        id: key,
        country,
        event: info.event ?? info.headline,
        headline: info.headline ?? null,
        description: info.description ?? null,
        instruction: info.instruction ?? null,
        // 🔴 TWO FIELDS, NOT A FALLBACK. This was `onset ?? effective`,
        // and review mutated it to `effective ?? onset`: the self-test
        // stayed green while 5 100 of 6 691 live blocks changed their
        // published start — Croatia by 5h43m. No fixture had both
        // present and different, so the suite could not tell apart the
        // two fields this script spent three attempts distinguishing.
        // The fallback was dead anyway: 0 blocks carry `effective`
        // without `onset`. Each is now reported as what it is.
        // 🔴 CAMP-150: THE TIME OF ISSUE, which this row did not keep.
        //
        // MeteoAlarm's clause 5.4 requires "the time of issue of the
        // Information being redistributed, as indicated on the MeteoAlarm
        // Website at the time the Information is extracted". That is CAP's
        // `sent`. This row kept `onset`, `effective` and `expires` — three
        // times, none of them the one the licence asks for — so a panel
        // built on it could satisfy the clause only by printing a
        // different time under the words "issued at".
        //
        // Measured across all 27 feeds, 06.10.2026, 1 279 surviving
        // blocks: `sent` and `onset` are BOTH present on 1 279 of 1 279
        // and DIFFER on 1 279 of 1 279. Median gap 1 001 minutes — 16.7
        // hours — 1 170 of them over an hour apart, the widest 4.2 days,
        // and 135 with `onset` BEFORE `sent`. There is no block on which
        // the substitution would have gone unnoticed by being close.
        sent: alert.sent ?? null,
        onset: info.onset ?? null,
        effective: info.effective ?? null,
        expires: info.expires,
        level: level.code,
        // 🔴 CAMP-150: THE SOURCE'S OWN WORD FOR THE SEVERITY, which this
        // row dropped — it kept the code and threw the label away.
        //
        // Without it a reader cannot tell a red warning from a yellow
        // one unless the event text happens to say so, and measured
        // across all 27 feeds on 06.10.2026 it usually does not: 232 of
        // 1 279 live blocks name their level in `event` or `headline`,
        // 18.1%. Spain alone contributes 672 that do not. On a panel
        // whose whole purpose is "a high-sided van in a squall on a
        // pass", "Wind warning" and "Wind warning" reading the same at
        // level 2 and level 4 is the defect, not a nicety.
        //
        // The source says `2; yellow; Moderate`, so the word is theirs.
        // We pick from their string; we never invent a word for a code.
        levelLabel: level.label,
        // 🔴 The source's own word for the hazard, passed through. We do
        // not translate it and we do not add one of our own.
        type: type.label,
        typeCode: type.code,
        areas,
        // 🔴 THE SAME DEFECT AS `onset`, ONE LINE DOWN, AND I DID NOT
        // LOOK. Review swapped this to `alert.sender ?? info.senderName`
        // with the suite green: no fixture carried both. On the live
        // feeds 4 602 of 4 602 blocks carry both AND THEY DIFFER ON
        // EVERY ONE — Croatia's name is "DHMZ Državni hidrometeorološki
        // zavod" while the alert's sender is "https://meteo.hr" — so
        // 400 of 400 published warnings would have changed hands. They
        // are two different things in CAP: a readable name and the
        // issuing identifier. Each is reported as itself.
        sender: info.senderName ?? null,
        senderId: alert.sender ?? null,
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
  return { country, seen, kept, counts, publishedAhead, unreadable };
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
  // 🔴 EVERY FIXTURE IN THIS SUITE HAD EXACTLY ONE ALERT, and review
  // proved what that hid: `.slice(0, 1)` on the outer loop over
  // `payload.warnings` passed all 144 assertions while costing Poland
  // 1 158 of its 1 160 blocks — 99.8% of the feed, with no guard firing
  // (seen > 0, so nothing looks quiet or blind; kept > 0, so the yield
  // guard is satisfied) and the file written. A feed is a list of
  // ALERTS, each with its own list of language blocks, and the suite
  // only ever exercised the inner list.
  const alerts = (list) => ({
    warnings: list.map((infos, i) => ({
      alert: { identifier: `A${i}`, info: Array.isArray(infos) ? infos : [infos] },
    })),
  });

  // 🔴 CAP LETS `<polygon>` REPEAT, SO THE FEED SENDS AN ARRAY — and the
  // old `typeof === 'string'` test returned null for every one of
  // Estonia's 192 areas, in the one country that sends no geocode at
  // all and where the shape is the only way to place a warning.
  {
    ok('a shape sent as an array survives',
      areasOf({ area: [{ areaDesc: 'A', polygon: ['58.6,25.7 58.7,25.8'] }] })[0].polygons.length === 1);
    ok('…a shape sent as a bare string survives too',
      areasOf({ area: [{ areaDesc: 'A', polygon: '58.6,25.7' }] })[0].polygons.join() === '58.6,25.7');
    ok('…several rings are all kept',
      areasOf({ area: [{ areaDesc: 'A', polygon: ['a', 'b', 'c'] }] })[0].polygons.length === 3);
    ok('…an absent shape is an empty list, not null',
      areasOf({ area: [{ areaDesc: 'A' }] })[0].polygons.length === 0);
    ok('…and an empty string is not a shape',
      areasOf({ area: [{ areaDesc: 'A', polygon: ['', '  '] }] })[0].polygons.length === 0);
    ok('circles follow the same rule',
      areasOf({ area: [{ areaDesc: 'A', circle: ['58.6,25.7 10'] }] })[0].circles.length === 1);
  }

  // 🔴 Review found this filter removable with a green suite.
  ok('a geocode with no value is not a code',
    areasOf({ area: [{ areaDesc: 'A', geocode: [{ valueName: 'EMMA_ID' }] }] })[0].codes.length === 0);
  ok('…nor is one with no scheme',
    areasOf({ area: [{ areaDesc: 'A', geocode: [{ value: 'X1' }] }] })[0].codes.length === 0);
  ok('…while a complete one is',
    areasOf({ area: [{ areaDesc: 'A', geocode: [{ valueName: 'EMMA_ID', value: 'X1' }] }] })[0].codes.join() === 'EMMA_ID:X1');

  ok('`"3; orange; Severe"` is a level of 3, not a string', awareness('3; orange; Severe').code === 3);
  ok('…and its label survives', awareness('4; Fog').label === 'Fog');
  ok('a value that is not that shape yields null, not NaN', awareness('Fog').code === null);
  ok('and a missing value does not throw', awareness(undefined).code === null);

  // 🔴 THE CARD'S OWN CRITERION: a payload where every record has
  // expired must produce ZERO warnings, not the record count. This is
  // the Polish shape measured on 28.09.2026 — 69 records, all expired.
  //
  // ⚠️ AND IT USED TO PROVE SOMETHING WEAKER THAN IT CLAIMED. The 69
  // records were 69 language blocks of ONE alert, all sharing identifier
  // and area — so they collapsed to a single key, and review measured
  // that disabling the expiry filter entirely still gave `kept = 1,
  // duplicate = 68`. The assertion named "not 69" was really proving
  // "not more than one", and dedup was holding it up. Sixty-nine
  // separate alerts is the shape the card measured.
  const polish = alerts(
    Array.from({ length: 69 }, () => block({ expires: '2026-10-04T05:00:00Z' })),
  );
  const out = warningsFrom(polish, 'poland', NOW);
  ok(
    '🔴 69 expired records produce 0 warnings, not 69',
    out.kept.length === 0 && out.counts.expired === 69,
    JSON.stringify(out.counts),
  );
  ok('…and the count says so out loud', out.seen === 69);
  ok('…and not one of them was merely deduplicated', out.counts.duplicate === 0);
  // The same 69, unexpired: every one survives, so the zero above is the
  // filter's doing and nothing else.
  const alive = warningsFrom(
    alerts(Array.from({ length: 69 }, () => block())),
    'poland',
    NOW,
  );
  ok('…while 69 live records produce 69 warnings', alive.kept.length === 69);
  ok('…which is how we know the zero came from the filter', alive.counts.expired === 0);

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
  // 🔴 THIS READ `.polygon`, THE KEY THIS COMMIT RENAMED. `undefined !==
  // null` is true, so the one assertion named for keeping a polygon
  // could not fail — it passed for an area with no shape at all.
  ok('…and a polygon is kept when the source gives one',
    shaped.kept[0].areas[0].polygons.length === 1, JSON.stringify(shaped.kept[0].areas[0].polygons));

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
      polygon: w?.areas?.[0]?.polygons?.join('|'),
      circle: w?.areas?.[0]?.circles?.join('|'),
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
    ok('🔴 an absent onset is null, never borrowed from `effective`',
      w?.onset === null, String(w?.onset));
    ok('…and `effective` is reported as itself',
      w?.effective === '2026-10-05T09:00:00Z', String(w?.effective));
    ok('🔴 an absent senderName is null, never borrowed from the alert',
      w?.sender === null, String(w?.sender));
    ok('…and the alert-level sender is reported as itself',
      w?.senderId === 'ALERT-SENDER', String(w?.senderId));
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

  // 🔴 A PUBLISHED WARNING IS CURRENT WHENEVER IT STARTS. Three versions
  // of this test asserted the opposite; see `dropReason`. Each case
  // below is one of the live shapes that a start-time filter killed.
  {
    const future = warningsFrom(feed([block({ onset: '2026-10-07T00:00:00Z' })]), 'x', NOW);
    ok('a warning that starts in two days is still current', future.kept.length === 1);
    ok('…and its onset rides through, so the page can say when', future.kept[0]?.onset === '2026-10-07T00:00:00Z');
    // Estonia's shape: no `effective` at all. The second version of the
    // filter fell back onto `onset` here and kept 6 of 80.
    const noEffective = warningsFrom(
      feed([block({ onset: '2026-10-07T00:00:00Z', effective: undefined })]),
      'x',
      NOW,
    );
    ok('…and a missing `effective` does not reinstate the start-time test', noEffective.kept.length === 1);
    // SMHI's shape: `effective` EQUALS `onset`, both ahead. Sweden kept
    // 2 of 22 on this one.
    const effectiveAhead = warningsFrom(
      feed([block({ onset: '2026-10-07T00:00:00Z', effective: '2026-10-07T00:00:00Z' })]),
      'x',
      NOW,
    );
    ok('…nor does an `effective` equal to a future `onset`', effectiveAhead.kept.length === 1);
    const started = warningsFrom(feed([block({ onset: '2026-10-05T11:59:59Z' })]), 'x', NOW);
    ok('…and one that started a second ago is kept too', started.kept.length === 1);
    const noOnset = warningsFrom(feed([block({ onset: undefined, effective: undefined })]), 'x', NOW);
    ok('…and no onset at all does not drop it', noOnset.kept.length === 1);
  }

  // 🔴 EVERY FIELD AT ONCE, BECAUSE FIXING THEM ONE AT A TIME FAILED.
  //
  // Review found `onset ?? effective` swappable with a green suite. I
  // fixed that line and did not look at the next one, so review found
  // `senderName ?? alert.sender` — the same defect, one row down, 4 602
  // of 4 602 live blocks carrying both. Two rounds, two instances, one
  // class. This gives every source field a value only it can have, so
  // any swap, alias or silent drop anywhere in the row fails here
  // rather than waiting for someone to measure the live feed.
  {
    const row = warningsFrom(
      feed(
        [
          {
            event: 'EVENT',
            headline: 'HEADLINE',
            description: 'DESCRIPTION',
            instruction: 'INSTRUCTION',
            onset: '2026-10-05T18:00:00Z',
            effective: '2026-10-05T09:00:00Z',
            expires: '2026-10-06T00:00:00Z',
            senderName: 'SENDER-NAME',
            language: 'LANGUAGE',
            parameter: [
              { valueName: 'awareness_level', value: '3; orange; LEVEL-LABEL' },
              { valueName: 'awareness_type', value: '4; TYPE-LABEL' },
            ],
            area: [{ areaDesc: 'AREA', geocode: [{ valueName: 'SCHEME', value: 'CODE' }] }],
          },
        ],
        { sender: 'ALERT-SENDER', sent: '2026-10-05T07:15:00Z' },
      ),
      'COUNTRY',
      NOW,
    ).kept[0];
    const expected = {
      country: 'COUNTRY',
      event: 'EVENT',
      headline: 'HEADLINE',
      description: 'DESCRIPTION',
      instruction: 'INSTRUCTION',
      // 🔴 CAMP-150: three times that are not interchangeable, and the
      // licence asks for the FIRST of them. On the live feeds `sent` and
      // `onset` differ on 1 279 of 1 279 blocks, so this fixture keeps
      // them apart too: a row that read `onset` into `sent` would be
      // wrong here as it is wrong in production.
      sent: '2026-10-05T07:15:00Z',
      onset: '2026-10-05T18:00:00Z',
      effective: '2026-10-05T09:00:00Z',
      expires: '2026-10-06T00:00:00Z',
      level: 3,
      levelLabel: 'orange; LEVEL-LABEL',
      type: 'TYPE-LABEL',
      typeCode: 4,
      sender: 'SENDER-NAME',
      senderId: 'ALERT-SENDER',
      language: 'LANGUAGE',
    };
    for (const [field, want] of Object.entries(expected)) {
      ok(`row.${field} is ${JSON.stringify(want)} and nothing else`, row?.[field] === want, JSON.stringify(row?.[field]));
    }
    ok('row.areas carries the area name', row?.areas?.[0]?.name === 'AREA');
    ok('…and its code, scheme first', row?.areas?.[0]?.codes?.join() === 'SCHEME:CODE');
    // 🔴 The key-set guard below was top-level only: review added a
    // field to every area entry and the suite stayed green.
    ok('an area entry has exactly the fields this test names',
      Object.keys(row?.areas?.[0] ?? {}).sort().join() === 'circles,codes,name,polygons',
      Object.keys(row?.areas?.[0] ?? {}).sort().join());
    // Anything added to the row later must be added here too, or this
    // fails — which is the point.
    // 🔴 AND THE SECOND HALF, WHICH THE FIRST VERSION LACKED. Giving
    // every field a value means the right-hand side of a `??` is never
    // reached, so a fallback ADDED later survives: review proved
    // `headline: info.headline ?? info.event` passes 123/123 while
    // changing 6 of 413 published rows on the live feeds — 147 of 5 154
    // blocks carry no headline. Swaps were caught; borrowing was not.
    // Each field is now also removed in turn and must read `null`.
    const source = {
      headline: 'HEADLINE',
      description: 'DESCRIPTION',
      instruction: 'INSTRUCTION',
      onset: '2026-10-05T18:00:00Z',
      effective: '2026-10-05T09:00:00Z',
      senderName: 'SENDER-NAME',
      language: 'LANGUAGE',
    };
    for (const field of Object.keys(source)) {
      const row = Object.fromEntries(Object.entries(source).filter(([k]) => k !== field));
      const got = warningsFrom(
        feed([{ ...block(), ...row, [field]: undefined }], { sender: 'ALERT-SENDER' }),
        'x',
        NOW,
      ).kept[0];
      const seen = field === 'senderName' ? got?.sender : got?.[field];
      ok(`a missing ${field} reads null, never borrowed from a neighbour`, seen === null, JSON.stringify(seen));
    }
    // The alert-level sender is absent in its own case, since the loop
    // above only removes fields from the `info` block.
    const noAlertSender = warningsFrom(feed([block({ senderName: 'NAME' })]), 'x', NOW).kept[0];
    ok('a missing alert sender reads null, never borrowed from senderName',
      noAlertSender?.senderId === null, JSON.stringify(noAlertSender?.senderId));
    ok('…while the readable name is still reported', noAlertSender?.sender === 'NAME');

    // `event` is the one deliberate fallback: `dropReason` admits a block
    // that has a headline and no event, so the row must still say what
    // the hazard is. That makes it reachable, and it is tested.
    const headlineOnly = warningsFrom(feed([block({ event: undefined })]), 'x', NOW).kept[0];
    ok('an event-less block takes its event from the headline', headlineOnly?.event === 'Fog warning');
    ok('…and a block with neither is dropped, not published blank',
      warningsFrom(feed([block({ event: undefined, headline: undefined })]), 'x', NOW).counts.unusable === 1);

    ok('the row has exactly the fields this test names',
      Object.keys(row ?? {}).sort().join() === ['id', 'areas', ...Object.keys(expected)].sort().join(),
      Object.keys(row ?? {}).sort().join());
  }

  // 🔴 THE SAME CASE FOR THE SENDER, which had the same hole one line
  // below and 4 602 of 4 602 live blocks carrying both.
  {
    const w = warningsFrom(
      feed([block({ senderName: 'DHMZ' })], { sender: 'https://meteo.hr' }),
      'x',
      NOW,
    ).kept[0];
    ok('the readable name is the sender', w?.sender === 'DHMZ');
    ok('…and the issuing identifier is its own field', w?.senderId === 'https://meteo.hr');
    ok('…so the two can never be swapped unseen', w?.sender !== w?.senderId);
  }

  // 🔴 BOTH PRESENT AND DIFFERENT — the case no fixture had. Swapping
  // `onset` and `effective` left the whole suite green while it moved
  // the published start on 5 100 of 6 691 live blocks.
  {
    const both = warningsFrom(
      feed([block({ onset: '2026-10-05T18:00:00Z', effective: '2026-10-05T09:00:00Z' })]),
      'x',
      NOW,
    );
    ok('onset is the onset when both are given', both.kept[0]?.onset === '2026-10-05T18:00:00Z');
    ok('…and effective is the effective', both.kept[0]?.effective === '2026-10-05T09:00:00Z');
    ok('…so the two can never be swapped unseen', both.kept[0]?.onset !== both.kept[0]?.effective);
  }

  // 🔴 TWO ALERTS SHARING AN IDENTIFIER, TOLD APART ONLY BY THEIR SHAPE.
  // The dedup key's shape half read the pre-rename `.polygon`, so it was
  // always `undefined` and every shape-only area fell back to its
  // POSITION in the list. Nothing is lost today only because
  // `alert.identifier` happens to be unique in every feed — which is a
  // property of the data, not of our code.
  {
    const ring = (n) => `${n}.1,25.1 ${n}.2,25.2 ${n}.3,25.3 ${n}.1,25.1`;
    const sameId = {
      warnings: [
        { alert: { identifier: 'SAME', info: [block({ area: [{ areaDesc: 'North', polygon: [ring(58)] }] })] } },
        { alert: { identifier: 'SAME', info: [block({ area: [{ areaDesc: 'South', polygon: [ring(59)] }] })] } },
      ],
    };
    const out = warningsFrom(sameId, 'estonia', NOW);
    ok('two shapes under one identifier stay two warnings', out.kept.length === 2, JSON.stringify(out.counts));
    ok('…and neither is counted as a duplicate', out.counts.duplicate === 0);
    const sameShape = {
      warnings: [
        { alert: { identifier: 'SAME', info: [block({ area: [{ areaDesc: 'North', polygon: [ring(58)] }] })] } },
        { alert: { identifier: 'SAME', info: [block({ area: [{ areaDesc: 'North again', polygon: [ring(58)] }] })] } },
      ],
    };
    const merged = warningsFrom(sameShape, 'estonia', NOW);
    ok('…while the SAME shape under one identifier is one warning', merged.kept.length === 1);
    ok('…counted as the duplicate it is', merged.counts.duplicate === 1);
  }

  // 🔴 Bulgaria's clock runs 72 minutes ahead on all 18 of its blocks.
  // That is surfaced, never dropped.
  {
    const ahead = warningsFrom(feed([block()], { sent: '2026-10-05T13:12:00Z' }), 'x', NOW);
    ok('a `sent` in the future is kept', ahead.kept.length === 1);
    ok('…and counted, so a real embargo would surface', ahead.publishedAhead === 1);
    const behind = warningsFrom(feed([block()], { sent: '2026-10-05T11:00:00Z' }), 'x', NOW);
    ok('…while a `sent` in the past counts for nothing', behind.publishedAhead === 0);
  }

  // 🔴 The shape guard. An unreadable level is scored `green`, so this
  // is the one failure that publishes itself as good news.
  {
    const renamed = warningsFrom(feed([block({ parameter: [{ valueName: 'awareness_lvl', value: '3; orange; Severe' }] })]), 'x', NOW);
    ok('a renamed awareness parameter leaves the block unreadable', renamed.unreadable === 1 && renamed.seen === 1);
    ok('…and it is scored green, which is why counting it matters', renamed.counts.green === 1);
    const fine = warningsFrom(feed([block()]), 'x', NOW);
    ok('…while a readable level counts as readable', fine.unreadable === 0);
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

  // 🔴 A debugging flag must never be able to publish.
  {
    const threw = (argv) => { try { runPlan(argv); return false; } catch { return true; } };
    ok('`--country=` with no value is refused, not run', threw(['node', 'x', '--country=']));
    ok('`--country` bare is refused too', threw(['node', 'x', '--country']));
    const one = runPlan(['node', 'x', '--country=croatia']);
    ok('…a named country runs only that country', one.countries.length === 1 && one.countries[0] === 'croatia');
    ok('…and never writes', one.dryRun === true);
    const full = runPlan(['node', 'x']);
    ok('a plain run asks all 27 and may write', full.countries.length === 27 && full.dryRun === false);
    ok('`--dry-run` alone asks all 27 and may not', runPlan(['node', 'x', '--dry-run']).dryRun === true);
  }

  // 🔴 A typo in a flag may not publish.
  {
    const threw = (argv) => { try { runPlan(argv); return false; } catch { return true; } };
    ok('`--dry-run=true` is a dry run, not a full write', runPlan(['n', 'x', '--dry-run=true']).dryRun === true);
    ok('`--dry-run` bare is too', runPlan(['n', 'x', '--dry-run']).dryRun === true);
    ok('`--dryrun` is refused, not run', threw(['n', 'x', '--dryrun']));
    ok('`--selftest` is refused, not run', threw(['n', 'x', '--selftest']));
    ok('`-dry-run` with one dash is refused', threw(['n', 'x', '-dry-run']));
    ok('…and a bare `dry-run` with none is too', threw(['n', 'x', 'dry-run']));
    ok('…and `--self-test=1` is recognised by the entry point', hasFlag(['n', 'x', '--self-test=1'], 'self-test'));
    ok('…while `--selftest` is not', !hasFlag(['n', 'x', '--selftest'], 'self-test'));
  }

  // 🔴 Keeping nothing means something different for one country.
  {
    ok('a full run that kept nothing from 6 669 blocks is broken', yieldLooksBroken({ only: null, seen: 6669, kept: 0 }));
    ok('…but one country keeping nothing is an ordinary day', !yieldLooksBroken({ only: 'poland', seen: 878, kept: 0 }));
    ok('…and a full run that kept something is fine', !yieldLooksBroken({ only: null, seen: 6669, kept: 1 }));
    ok('…as is a full run that saw nothing at all', !yieldLooksBroken({ only: null, seen: 0, kept: 0 }));
  }

  // 🔴 Six erroring plus six empty is twelve lost, and each half clears
  // the threshold alone.
  {
    const n = (k) => Array.from({ length: k }, (_, i) => `c${i}`);
    ok('six silent and six empty of 27 is too much missing', tooMuchMissing(n(6), n(6), 27));
    ok('…while six silent alone is not', !tooMuchMissing(n(6), [], 27));
    ok('…and six empty alone is not', !tooMuchMissing([], n(6), 27));
    ok('today — four answer empty, none fail — publishes', !tooMuchMissing([], n(4), 27));
    ok('a quarter exactly is already too much', tooMuchMissing(n(7), [], 27));
    ok('…and one country asked, failing, is too', tooMuchMissing(n(1), [], 1));
  }

  // 🔴 A 200 with an empty array is its own answer: not an error, not
  // silence, and invisible to every other guard.
  {
    const quiet = quietCountries([
      { country: 'empty', seen: 0, kept: [] },
      { country: 'busy', seen: 148, kept: [] },
    ]);
    ok('a country that answered with nothing is quiet', quiet.length === 1 && quiet[0] === 'empty');
    ok('…and one that served blocks is not, even keeping none', !quiet.includes('busy'));
  }

  // 🔴 The header table is a command now, not a hand-copied number.
  {
    const c = census({
      // Two occurrences, deliberately: with one, `count = 1` and
      // `count += 1` are the same number and the mutation lives.
      a: feed([
        block({
          area: [
            { areaDesc: 'N', geocode: [{ valueName: 'EMMA_ID', value: 'A1' }] },
            { areaDesc: 'E', geocode: [{ valueName: 'EMMA_ID', value: 'A2' }] },
          ],
        }),
      ]),
      b: feed([block({ area: [{ areaDesc: 'S', geocode: [] }] })]),
      // Partly coded: one area with a code, two without. Nothing
      // asserted `partial` before, so the counters behind "Latvia codes
      // 14 of its 508" could be wrong while `--census` read confidently.
      d: feed([
        block({
          area: [
            { areaDesc: 'A', geocode: [{ valueName: 'NUTS3', value: 'X1' }] },
            { areaDesc: 'B', geocode: [] },
            { areaDesc: 'C', geocode: [] },
          ],
        }),
      ]),
      c: { warnings: [] },
    });
    ok('the census counts every occurrence, not the first', c.schemes.EMMA_ID?.count === 2);
    ok('…and names the country it came from', c.schemes.EMMA_ID?.countries.join() === 'a');
    ok('…lists a country whose areas carry no code', c.uncoded.join() === 'b');
    ok('…and separates one that served no area at all', c.quiet.join() === 'c');
    ok('…reports a partly coded country as coded/total', c.partial.join() === 'd 1/3');
    ok('…and a partly coded country is neither uncoded nor quiet',
      !c.uncoded.includes('d') && !c.quiet.includes('d'));
  }

  // 🔴 Nine countries keep nothing today and are healthy; a country
  // whose every block is unreadable is not.
  {
    const blind = blindCountries([
      { country: 'quiet', seen: 878, unreadable: 0 },
      { country: 'empty', seen: 0, unreadable: 0 },
      { country: 'broken', seen: 148, unreadable: 148 },
      { country: 'partly', seen: 10, unreadable: 9 },
    ]);
    ok('a country that keeps nothing but reads fine is not blind', !blind.includes('quiet'));
    ok('…a country that served nothing is not blind either', !blind.includes('empty'));
    ok('…one malformed block among ten is not blindness', !blind.includes('partly'));
    ok('…but a country we cannot read at all is', blind.length === 1 && blind[0] === 'broken');
  }

  ok('every member state is listed exactly once', new Set(COUNTRIES).size === 27);
  ok('the url is built from the country', feedUrl('poland').endsWith('/feeds-poland'));

  console.log(bad ? `\n✗ ${bad} self-test failure(s)` : '\n✓ self-test passed');
  return bad;
}



// -------------------------------------------------------------------- main

const PAUSE_MS = 400;
/**
 * A flag, however it is written. `--dry-run` and `--dry-run=true` are the
 * same request.
 *
 * 🔴 `--dry-run=true` USED TO RUN ALL 27 COUNTRIES AND WRITE THE FILE.
 * The commit that taught `--country` to accept both spellings left its
 * sibling on a bare `includes('--dry-run')`, in a section titled "a
 * debugging flag must never be able to publish". `--self-test=1` missed
 * the same way and fell through into a live run.
 */
export const KNOWN_FLAGS = ['dry-run', 'country', 'self-test', 'census'];

export const hasFlag = (argv, name) =>
  argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

/**
 * What a command line asks for. Pure, because the bug it replaces was a
 * decision — `--country=` with an empty value ran all 27 countries AND
 * wrote the file — and a decision that lives only inside `main` cannot
 * be tested.
 */
export function runPlan(argv) {
  // 🔴 AN UNKNOWN FLAG IS A REFUSAL, NOT A FULL RUN. `--dryrun` and
  // `--selftest` are not this script's flags, and both used to mean "do
  // everything and write the file". A typo may not publish.
  // The test above this was titled "a typo in a flag may not publish"
  // and then only inspected tokens beginning with `--`, so `-dry-run`
  // and a bare `dry-run` both ran all 27 countries and WROTE THE FILE.
  // This script takes no positional arguments, so anything that is not
  // a known flag is a typo.
  const unknown = argv
    .slice(2)
    .filter((a) => !KNOWN_FLAGS.some((k) => a === `--${k}` || a.startsWith(`--${k}=`)));
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(', ')}`);
  const flag = argv.find((a) => a === '--country' || a.startsWith('--country='));
  const only = flag?.startsWith('--country=') ? flag.slice('--country='.length) : undefined;
  if (flag && !only) throw new Error('--country= needs a country, e.g. --country=croatia');
  const dryRun = hasFlag(argv, 'dry-run') || Boolean(flag);
  return {
    countries: only ? [only] : COUNTRIES,
    // Which of the two refusals to write this was, for the log.
    only: only ?? null,
    // ⚠️ `Boolean(flag)` and `Boolean(only)` are identical HERE, and a
    // mutation proved it: the throw above means a flag without a value
    // never reaches this line, so no test can tell the two apart. It is
    // written as presence because that is the rule the throw enforces —
    // a partial read may be inspected, it may not become the published
    // answer — and a later reader who removes the throw must not
    // silently get the old bug back.
    dryRun,
  };
}

/**
 * The scheme census, over payloads already in hand.
 *
 * 🔴 BECAUSE THE NUMBERS IN THIS FILE'S HEADER HAVE BEEN WRONG FOUR
 * TIMES. The last pair disagreed with review by 504 — and neither was a
 * mistake: the feed moved 504 NUTS3 occurrences in 22 minutes, and we
 * had measured different snapshots of a live archive. A hand-copied
 * number rots. This makes the table a command instead.
 */
export function census(payloads) {
  const schemes = {};
  const where = {};
  const areas = {};
  for (const [country, payload] of Object.entries(payloads)) {
    for (const entry of payload?.warnings ?? []) {
      for (const info of entry?.alert?.info ?? []) {
        for (const area of areasOf(info)) {
          areas[country] ??= { total: 0, coded: 0 };
          areas[country].total += 1;
          if (area.codes.length) areas[country].coded += 1;
          for (const code of area.codes) {
            const scheme = code.slice(0, code.indexOf(':'));
            schemes[scheme] = (schemes[scheme] ?? 0) + 1;
            (where[scheme] ??= new Set()).add(country);
          }
        }
      }
    }
  }
  return {
    schemes: Object.fromEntries(
      Object.entries(schemes)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, { count: v, countries: [...where[k]].sort() }]),
    ),
    uncoded: Object.entries(areas)
      .filter(([, a]) => a.coded === 0)
      .map(([c]) => c)
      .sort(),
    partial: Object.entries(areas)
      .filter(([, a]) => a.coded > 0 && a.coded < a.total)
      .map(([c, a]) => `${c} ${a.coded}/${a.total}`)
      .sort(),
    quiet: Object.keys(payloads)
      .filter((c) => !areas[c])
      .sort(),
  };
}

/**
 * Whether keeping nothing is us rather than the weather.
 *
 * Only a FULL run can make that claim. For one country, keeping nothing
 * is ordinary — nine of 27 are at zero on a normal day, and Poland went
 * from 878 expired with nothing kept to 141 kept inside a day.
 */
// ⚠️ Named, not positional. Review swapped `seen` and `kept` at the call
// site and all 144 assertions passed — three unlabelled numbers in a row
// is a mis-wiring waiting to happen, and nothing covers `main`.
export const yieldLooksBroken = ({ only, seen, kept }) => !only && seen > 0 && kept === 0;

/**
 * Whether too much of the union is missing to publish an answer.
 *
 * 🔴 THE TWO LOSSES WERE JUDGED SEPARATELY AND THAT WAS THE HOLE. Six
 * countries erroring and six answering empty cleared both thresholds on
 * their own — 6 < 7 and 6 < 7 — while twelve of twenty-seven
 * contributed nothing and the file was written. A country missing is
 * missing however it went.
 *
 * ⚠️ THE HEADROOM IS DELIBERATE AND IT IS TIGHT. Four countries answer
 * empty every day, so this leaves room for two transport failures of 27
 * before a run refuses to publish at all. Review asked whether three
 * flaky feeds is a legitimate day. The answer here is to ask each feed
 * twice (see the fetch loop) rather than to raise the number, because
 * raising it reinstates exactly the hole this function was written for:
 * six erroring plus six empty cleared two separate thresholds and
 * published anyway. Refusing to publish is recoverable; publishing a
 * third of Europe as calm is not.
 */
export function tooMuchMissing(silent, quiet, asked) {
  return silent.length + quiet.length >= Math.ceil(asked / 4);
}

/**
 * Countries that ANSWERED and served nothing at all.
 *
 * 🔴 THE HOLE THE SHAPE GUARD BELOW DID NOT CLOSE. Review drove 26 feeds
 * returning `{"warnings":[]}` — the exact 15-byte body Luxembourg,
 * Malta, Romania and Slovakia serve today — with Spain alone real: no
 * country errored, so `silent` was empty; none served a block, so
 * `blind` (which needs `seen > 0`) was empty; Spain's 200 warnings kept
 * the yield guard quiet. The file was written, shape-identical to a
 * healthy run, with 26 states and a third of Europe's warnings gone.
 *
 * A 200 carrying an empty array is not an error and not silence. It is
 * its own answer, and it has to be counted as one.
 */
export function quietCountries(results) {
  return results.filter((r) => r.seen === 0).map((r) => r.country);
}

/** Countries that served blocks of which NONE carried a readable level. */
export function blindCountries(results) {
  return results.filter((r) => r.seen > 0 && r.unreadable === r.seen).map((r) => r.country);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 🔴 `--country=` WITH NOTHING AFTER THE EQUALS WAS A FULL RUN THAT
  // WROTE THE FILE — falsy twice over, so the list fell back to all 27
  // and the dry run fell back to false. A typo in a debugging flag
  // published a document. The decision is `runPlan`, which is testable.
  const { countries, dryRun, only } = runPlan(process.argv);
  // 🔴 ONE COUNTRY NEVER WRITES THE FILE. `--country=croatia` produced a
  // document shaped like a full-Europe run, with `meta.silent: []` —
  // nothing in it recorded that twenty-six countries were never asked.
  // A partial read may be inspected; it may not become the published
  // answer.
  const now = new Date();
  const all = [];
  const totals = Object.fromEntries(DROPPED.map((d) => [d, 0]));
  let seen = 0;
  let publishedAhead = 0;
  const silent = [];
  const shapes = [];

  for (const country of countries) {
    await sleep(PAUSE_MS);
    // 🔴 ASKED TWICE BEFORE BEING CALLED SILENT. Review pointed out that
    // four countries answer empty every single day, so the combined
    // loss guard leaves room for only two transport failures before the
    // whole run aborts — and there was no retry at all. Loosening the
    // guard would reinstate the hole it was written for; a flaky feed
    // is better answered by asking again. A second attempt costs one
    // pause and only happens when the first fails.
    let payload;
    let lastError;
    for (let attempt = 0; attempt < 2 && payload === undefined; attempt += 1) {
      if (attempt > 0) await sleep(PAUSE_MS * 2);
      try {
        const res = await fetch(feedUrl(country));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json();
      } catch (err) {
        lastError = err;
      }
    }
    if (payload === undefined) {
      // 🔴 One country failing is not the run failing, but it is not
      // silence either: a country that answers nothing and a country
      // that errors must not look the same in the output.
      console.log(`  ${country}: ${String(lastError?.message).slice(0, 60)} (asked twice)`);
      silent.push(country);
      continue;
    }
    const out = warningsFrom(payload, country, now);
    seen += out.seen;
    publishedAhead += out.publishedAhead;
    shapes.push(out);
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
  // 🔴 AND THE GUARD BELOW IS REALLY A QUESTION ABOUT SPAIN.
  //
  // `kept === 0` across all of Europe sounds continental, but Spain
  // alone supplies 402 of the 580 warnings kept today — 69%. Twenty-six
  // countries could stop parsing and this guard would stay silent on
  // Spain's strength alone. Review proved exactly that: 26 countries
  // forced to zero, `seen` 6 669, `kept` 201, not a word.
  //
  // It cannot be fixed by lowering a threshold, because keeping nothing
  // IS normal for a country: nine of the 27 are at zero right now —
  // Poland 878 → 0, the Netherlands 1 038 → 0, Hungary 490 → 0 — all of
  // it real expiry and real green. Weather decides what we KEEP.
  //
  // So the guard asks about the shape instead, which weather does not
  // touch: a country that serves blocks none of which carry a readable
  // awareness level is a country we have stopped understanding.
  // 🔴 Four states answer empty every day. A quarter of the union doing
  // it is the same kind of claim as a quarter being unreachable, and is
  // judged by the same measure.
  // 🔴 AND THE TWO LOSSES MUST BE COUNTED TOGETHER. Measured by review
  // on a stubbed fetch: 6 countries erroring plus 6 answering empty
  // plus 15 healthy satisfied BOTH thresholds separately — 6 < 7 and
  // 6 < 7 — and the file was written with 12 of 27 contributing
  // nothing. A country missing from the answer is missing whether it
  // refused to speak or had nothing to say, so they are judged as one
  // number. Four answer empty every day; a quarter of the union, by any
  // combination of the two, is us.
  const quiet = quietCountries(shapes);
  const missing = silent.length + quiet.length;
  if (tooMuchMissing(silent, quiet, countries.length)) {
    throw new Error(
      `${missing} of ${countries.length} countries contributed nothing — ` +
        `${silent.length} did not answer (${silent.join(', ') || '—'}) and ` +
        `${quiet.length} answered with no warnings at all (${quiet.join(', ') || '—'})`,
    );
  }
  const blind = blindCountries(shapes);
  if (blind.length) {
    throw new Error(
      `${blind.join(', ')} served blocks and not one carried a readable ` +
        'awareness level — the feed changed shape, and an unreadable level ' +
        'is counted as green, so this would have published as "calm"',
    );
  }
  // ⚠️ Full runs only. Keeping nothing is ORDINARY for one country —
  // nine of the 27 are at zero on a normal day, and Poland went from
  // 878 expired and nothing kept to 141 kept within a day. Asking
  // `--country=poland` and being told the parser is broken would be a
  // false alarm, and false alarms are how guards stop being read.
  if (yieldLooksBroken({ only, seen, kept: all.length })) {
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
      // 🔴 Surfaced, not filtered: see `dropReason`. Today every one of
      // these is Bulgaria, 72 minutes ahead on a clock.
      publishedAhead,
      // 🔴 Written because the failure above was INVISIBLE in the output:
      // a run missing 26 countries produced a document indistinguishable
      // from a full one. A reader must be able to see who answered.
      perCountry: shapes.map((r) => ({ country: r.country, seen: r.seen, kept: r.kept.length })),
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
// `apps/web/src/data/warnings.json`, which is NOT tracked and is built
// by this script. A module that
// cannot be imported without side effects cannot be unit-tested at all.
const RUN_DIRECTLY =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

// 🔴 BOTH entry points below the guard. `--self-test` used to sit above
// it, so importing this module with `--self-test` anywhere in argv ran
// the suite and called `process.exit` — a module that can kill its
// importer is not importable.
/** `--census`: re-measure the table in this file's header. Never writes. */
async function runCensus() {
  const payloads = {};
  for (const country of COUNTRIES) {
    await sleep(PAUSE_MS);
    try {
      const res = await fetch(feedUrl(country));
      payloads[country] = await res.json();
    } catch (err) {
      console.log(`  ${country}: ${String(err.message).slice(0, 60)}`);
    }
  }
  const c = census(payloads);
  console.log(`\ngeocode schemes, ${new Date().toISOString()}`);
  for (const [scheme, { count, countries }] of Object.entries(c.schemes)) {
    console.log(`  ${scheme.padEnd(12)} ${String(count).padStart(6)}   ${countries.join(', ')}`);
  }
  console.log(`\nno code on any area: ${c.uncoded.join(', ') || '—'}`);
  console.log(`partly coded:        ${c.partial.join(', ') || '—'}`);
  console.log(`served no area:      ${c.quiet.join(', ') || '—'}`);
}

if (RUN_DIRECTLY) {
  if (hasFlag(process.argv, 'self-test')) process.exit(selfTest() ? 1 : 0);
  if (hasFlag(process.argv, 'census')) await runCensus();
  else await main();
}
