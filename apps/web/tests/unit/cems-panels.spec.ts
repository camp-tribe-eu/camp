import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { LayerChip } from '@/components/layer-chip';
import { CEMS_NOTICE, RESERVED_WORDS } from '@/lib/cems';
import { LAYERS } from '@/lib/map-layers';
import * as wildfires from '@/lib/wildfires';
import {
  CARD_WORDS,
  FORBIDDEN_WORDS,
  LICENCE_NOTICE_GENERATED,
  LICENCE_NOTICE_MODIFIED,
  NOTICES,
  creditProblems,
  discoverPanels,
  requiredCredits,
  wordProblems,
  type CemsPanel,
} from './cems-panel';
import { renderComponent } from './render-component';
import { everythingSaid, visibleText } from './rendered-text';

// CAMP-162 — THE CEMS LICENCE, AS A CHECK IN CI RATHER THAN A MEMORY.
//
// The Copernicus Emergency Management Service terms govern EFAS, GloFAS,
// GFM, EDO, GDO, EFFIS and GWIS together, and say (read 28.09.2026 at
// https://drought.emergency.copernicus.eu/terms&conditions):
//
//   "Data from the CEMS early warning and monitoring systems is provided
//    for information purposes only. This means that the data does not
//    constitute in any way an early warning for which only national/
//    regional institutions are authorized within their region of
//    responsibility."
//
// So "EFAS: orange flood level in this basin" is not a sentence we may
// print either: the word belongs to somebody else. The same terms dictate
// the credit for data we have adapted. This file turns both into things
// that go red.
//
// 🔴 THE RULE IS BOUND TO THE SOURCE, NOT TO THE FILE.
//
//   text RENDERED BESIDE DATA FROM A CEMS PRODUCT must not contain
//   "warning", "danger", "risk" or "alert".
//
// A grep over the repository for those words is wrong, and would be worked
// around: `map-layers.ts` says "Official severe-weather warnings" about the
// planned MeteoAlarm layer, and there it is CORRECT — it is the name of
// what a meteorological service publishes, and no CEMS term touches it. A
// check that went red on that would teach everybody to silence it. So
// nothing here reads source files for words. It renders the panel of each
// CEMS-sourced layer, exactly as the page does, and reads the HTML.
//
// 🔴 WHAT IS READ, AND WHAT IS NOT.
//
// "Carries the credit" reads what a sighted reader is SHOWN: hidden
// elements (`sr-only`, `hidden`, `display:none`) are dropped first, since
// a credit nobody can see is not a credit. "Uses no reserved word" reads
// what a reader OR a screen reader is TOLD: hidden text stays in, and so do
// `aria-label`, `title` and `alt`, since a warning spoken beside the data
// is still a warning. Class names, `data-*` and `href`s are not read — see
// `rendered-text.ts`. And neither reads a constant: every assertion below
// is about HTML that `renderComponent` produced from the real component.
//
// 🔴 THE LIST OF WORDS AND THE LICENCE NOTICE ARE WRITTEN OUT IN
// `cems-panel.ts`, NOT IMPORTED FROM `src/lib/cems.ts`. Those are what the
// feed gates use. A check measured against the gate's own list would go
// blind in the same edit that blinded the gate. The two are asserted equal
// below instead, so they can only change together, in view.
//
// The word list exists in THREE places — `RESERVED_WORDS` in
// `src/lib/cems.ts` (canonical), `FORBIDDEN_WORDS` in
// `scripts/effis/fetch-wildfires.mjs` (a script cannot import TypeScript)
// and this check's own copy — and below they are asserted to be the same
// string and each word is driven through all three. And the credit a panel
// owes is not something the panel file chooses: it says WHICH of the
// licence's two notices it owes (`notice`), the pattern comes from
// `cems-panel.ts`, and the file can only add to it. A panel file that could
// supply the list of credits it is measured against could switch the check
// off in the file that supplies the evidence.
//
// ── HOW A NEW CEMS SOURCE IS ADDED (EDO drought, GFM floods, …) ──────────
//
//   1. Make its panel a component that renders on its own: props in, JSX
//      out, no hooks, no map. `src/components/wildfire-panel.tsx` is the
//      example, and was cut out of `campsite-map.tsx` for exactly this
//      reason. A panel that only exists after a browser fetched something
//      cannot be read here, and one that is only read through a string it
//      was built from is not being read at all.
//   2. If it is a map layer, give its `LAYERS` entry `terms: 'cems'`
//      (src/lib/map-layers.ts). The switch for it is then read too, with
//      no further work.
//   3. Copy `tests/unit/cems-panels/wildfire.panel.ts` to
//      `tests/unit/cems-panels/<source>.panel.ts` and swap in the
//      component and the state function. List every state the panel can be
//      in — the gaps as well as the data, because a stray word hides in
//      "no fresh data" as easily as in a figure — and build each from the
//      RAW feed through the reader the browser uses, never from a string.
//      Say which licence notice it owes with `notice`.
//
//      ⚠️ THE PANEL FILE DECIDES WHAT IS EXAMINED. This spec proves that
//      what a file lists is checked; it cannot prove the file lists
//      everything. Two things are yours to keep: every state the panel can
//      be in, and one hostile-feed scenario for each string the panel
//      prints out of the feed (`hostile(...)` in wildfire.panel.ts).
//      Delete those four and the suite stays green while the gate that
//      stands between a feed and the page goes unmeasured — measured, not
//      guessed.
//   4. Nothing else is edited. This file finds `*.panel.ts` by itself, so
//      two cards adding a source cannot collide on a shared list, and a
//      new file cannot be left out of one.
//   5. Prove it: put "risk" into the component and only that panel's
//      "uses no reserved word" test goes red; delete the credit from it and
//      only its "carries the credit" test does.
//
// Leaving step 2 out is not a way round the check: a live layer whose own
// description names a CEMS product without the tag fails below, and so does
// a tagged live layer that has no panel file.
//
// ⚠️ WHAT THIS DOES NOT COVER — READ THIS BEFORE BELIEVING IT COVERS MORE.
//
// THE REGISTRY IS THE ONLY THING BETWEEN A CEMS PRODUCT AND AN UNGATED
// PAGE. This reads the panels and the switches that are REGISTERED here,
// and nothing else. A component or a route page that shows CEMS data and is
// not registered is not read at all: there are 33 components in
// `src/components` and 20 route pages under `src/app` at the time of
// writing (`ls src/components/*.tsx | wc -l`, `find src/app -name page.tsx
// | wc -l`), and a new `drought-panel.tsx` saying "severe drought risk"
// would pass this whole file. Registration is PROMPTED, not forced: a live
// map layer tagged `terms: 'cems'` with no panel file fails, and a live
// layer whose own description names a CEMS product without the tag fails.
// But the prompt only exists for MAP LAYERS, only knows the products by the
// names in the regex below, and is only as honest as the author's tag — a
// live layer described as "Drought indicator" with no tag is not noticed.
// It is a real limit and this card does not close it.
//
// Also outside it: the card a reader gets by clicking a burnt area is built
// with `document.createElement` inside MapLibre's popup, which needs a
// browser; `wildfire-layer.spec.ts` ("the card on a burnt area carries the
// credit and no reserved word") reads it there, with regexes of its own.
// The reader of HTML knows the hiding idioms this codebase uses (Tailwind
// `hidden`/`sr-only`/`invisible`/`opacity-0`, the `hidden` attribute,
// inline `display:none`/`visibility:hidden`/`opacity:0`/`font-size:0`); CSS
// under a name of its own in a stylesheet it cannot see. And the site is
// English: a second language would need its own words here.
//
// 🔴 Every test below was mutation-proved. The mutation that makes it fail
// is written next to it.

const discovered = discoverPanels();
const found = discovered.flatMap((f) => ('panel' in f ? [f] : []));
const CEMS_LAYERS = LAYERS.filter((l) => l.status === 'live' && 'terms' in l && l.terms === 'cems');

// ── the panels ───────────────────────────────────────────────────────────

test.describe('the panels of CEMS-sourced layers', () => {
  // 🔴 One bad file costs one file: a panel that throws while loading is
  // failed here BY NAME, and every other panel is still read below.
  // Mutation: put `throw new Error('x')` at the top of an ADDED *.panel.ts —
  // only this test, for that file, fails. Put it in the ONLY panel file,
  // wildfire.panel.ts, and three fail: this one, "at least one panel was
  // found" and "every live CEMS layer has a panel file" — measured, and
  // right, because the layer then has no panel that reads it.
  for (const f of discovered) {
    if ('error' in f) {
      test(`🔴 [${f.file}] loads as a CemsPanel`, () => {
        throw new Error(`${f.file} did not load: ${f.error}`);
      });
    }
  }

  test('🔴 at least one panel was found, and every file yielded one', () => {
    // 🔴 Mutation: rename wildfire.panel.ts to wildfire.ts — fails. With no
    // panel file every test below is a loop over nothing, and a loop over
    // nothing passes.
    expect(discovered.map((f) => f.file)).toContain('wildfire.panel.ts');
    expect(found.length, 'no panel file loaded').toBeGreaterThan(0);
    for (const { file, panel } of found) {
      expect(panel.scenarios().length, `${file} declares no scenarios`).toBeGreaterThan(0);
    }
    const sources = found.map((f) => f.panel.source);
    expect(new Set(sources).size, `two panels share a source name: ${sources.join(', ')}`).toBe(
      sources.length,
    );
  });

  for (const { panel } of found) {
    const tag = `[${panel.source}]`;

    test(`🔴 ${tag} its scenarios are real states, not empty shells`, () => {
      // The other two tests trust `showsData`, which the panel's author
      // declared. This one checks the declaration against the page.
      //
      // 🔴 Mutation: make the shipped feed unreadable (drop the notice
      // from `attribution`) — the "fresh" scenarios render the gap
      // sentence instead, `dataMarker` is absent from them, and this fails.
      // 🔴 Mutation: have a gap state print the figure — a scenario
      // declared `showsData: false` then shows data, and this fails, which
      // is what stops a state escaping the credit check by being declared
      // a gap.
      // The panel's own declaration is checked, not trusted: a `notice`
      // that is not one of the licence's two, or a `dataMarker` that is not
      // a pattern, is an error and not a panel with nothing required.
      requiredCredits(panel);
      expect(panel.dataMarker, `${tag} dataMarker is not a RegExp`).toBeInstanceOf(RegExp);
      const scenarios = panel.scenarios();
      expect(scenarios.some((s) => s.showsData), `${tag} declares no state that shows data`).toBe(true);
      expect(scenarios.some((s) => !s.showsData), `${tag} declares no gap state`).toBe(true);
      for (const s of scenarios) {
        const seen = visibleText(s.html);
        expect.soft(seen.length, `${tag} / ${s.name} rendered almost nothing: "${seen}"`).toBeGreaterThan(20);
        expect.soft(
          panel.dataMarker.test(seen),
          `${tag} / ${s.name}: declared showsData=${s.showsData} but the page says: "${seen}"`,
        ).toBe(s.showsData);
      }
    });

    test(`🔴 ${tag} every state that shows CEMS data carries the credit the licence dictates`, () => {
      // 🔴 Mutation: delete `{state.meta.attribution}` from
      // wildfire-panel.tsx — fails. The "uses no reserved word" test does
      // not: the panel still says the same figure, without the credit.
      // 🔴 Mutation: hide it — wrap the attribution in
      // `<span className="sr-only">`, or `hidden`, or `md:hidden`, or
      // `style="visibility:hidden"` — fails too, because a credit that is
      // not visible is not on the page.
      // 🔴 Mutation: in wildfire.panel.ts set `alsoCredits: []` (or delete
      // the line) AND delete the attribution — still fails. The notice is
      // the licence's, supplied by `requiredCredits`, and the panel file
      // can only add to it. On the first review that pair was green.
      const owed = requiredCredits(panel);
      for (const s of panel.scenarios().filter((x) => x.showsData)) {
        expect.soft(
          creditProblems(s.html, owed),
          `${tag} / ${s.name} shows data with no credit. It reads: "${visibleText(s.html)}"`,
        ).toEqual([]);
      }
    });

    test(`🔴 ${tag} nothing rendered beside CEMS data says warning, danger, risk or alert`, () => {
      // 🔴 Mutation: add "fire risk" to any sentence in wildfire-panel.tsx,
      // or to `wildfireNote` in wildfires.ts — fails, and the credit test
      // does not.
      // 🔴 Mutation: delete the `RENDERED_META` loop in `readFeed` — the
      // four hostile-feed scenarios now reach the page with their word
      // and this fails, so the gate is being measured by what it lets
      // through, not by a unit test of itself.
      for (const s of panel.scenarios()) {
        expect.soft(wordProblems(s.html), `${tag} / ${s.name} uses a word the CEMS terms reserve`).toEqual([]);
      }
    });
  }
});

// ── the switch for each CEMS layer ───────────────────────────────────────

test.describe('the switches of CEMS-sourced layers', () => {
  test('🔴 there is a CEMS layer to read, or this whole block passes over nothing', () => {
    // 🔴 Mutation: remove `terms: 'cems'` from the wildfire entry — fails
    // here, and in "the registry and the panels agree" below.
    expect(CEMS_LAYERS.map((l) => l.id)).toContain('wildfire');
  });

  for (const layer of CEMS_LAYERS) {
    test(`🔴 [${layer.id}] the switch says none of the four words, in its label or its tooltip`, () => {
      // 🔴 Mutation: label the wildfire layer "Wildfire risk" — fails.
      // 🔴 Mutation: end its description with "…and fire danger" — fails,
      // through the `title` attribute, which `everythingSaid` reads and a
      // plain text strip would not.
      for (const on of [false, true]) {
        const html = renderComponent(LayerChip, { layer, on, onToggle: () => undefined });
        // It rendered what it should have: the reader-facing label and the
        // tooltip, so the words check below had something to read.
        expect(visibleText(html)).toBe(layer.label);
        expect(everythingSaid(html)).toContain(layer.description);
        expect(wordProblems(html), `switch "${layer.label}" (on=${on})`).toEqual([]);
      }
    });
  }
});

// ── every CEMS layer has a panel, and every panel a layer ────────────────

test.describe('the registry and the panels agree', () => {
  test('🔴 every live CEMS layer has a panel file that reads it', () => {
    // 🔴 Mutation: add a LIVE layer with `terms: 'cems'` and no panel file
    // — fails, naming the layer and this file's step 3. That is what makes
    // "EDO drought landed with no check" impossible rather than unlikely.
    const covered = new Set(found.map((f) => f.panel.layer));
    for (const layer of CEMS_LAYERS) {
      expect(
        covered.has(layer.id),
        `layer "${layer.id}" is CEMS-sourced and has no tests/unit/cems-panels/*.panel.ts with layer: '${layer.id}' — see step 3 at the top of cems-panels.spec.ts`,
      ).toBe(true);
    }
  });

  test('🔴 every panel that names a layer names a live one tagged CEMS', () => {
    // 🔴 Mutation: delete `terms: 'cems'` from the wildfire entry — the
    // panel still exists, the layer no longer says it is CEMS, and this
    // fails: dropping the tag cannot silence the check.
    for (const { file, panel } of found) {
      if (panel.layer === undefined) continue;
      const layer = LAYERS.find((l) => l.id === panel.layer);
      expect(layer, `${file} names layer "${panel.layer}", which LAYERS does not have`).toBeTruthy();
      expect(layer!.status, `${file}: layer "${panel.layer}" is not live`).toBe('live');
      expect('terms' in layer! && layer.terms, `${file}: layer "${panel.layer}" lacks terms: 'cems'`).toBe(
        'cems',
      );
    }
  });

  test('🔴 no live layer names a CEMS product in its own words without being tagged', () => {
    // The way round the tag is to leave it off. So the layer's own label
    // and description are read for the products the terms name.
    //
    // 🔴 Mutation: add a live layer "Drought" described as "Combined
    // Drought Indicator from Copernicus EDO" with no `terms` — fails.
    // 🔴 It does not fire on `hazards`, which is planned, says "warnings",
    // and is MeteoAlarm's: the rule follows the source.
    const products = /\b(Copernicus|CEMS|EFFIS|GWIS|EFAS|GloFAS|GFM|EDO|GDO)\b/;
    for (const layer of LAYERS) {
      if (layer.status !== 'live') continue;
      if ('terms' in layer && layer.terms === 'cems') continue;
      expect(
        products.test(`${layer.label} ${layer.description}`),
        `live layer "${layer.id}" names a CEMS product but has no terms: 'cems'`,
      ).toBe(false);
    }
  });
});

// ── the licence's words: one list in three places ────────────────────────

/**
 * Every fetch script that keeps its own copy of the word list.
 *
 * 🔴 DISCOVERED, NOT NAMED. This was one hard-coded path to
 * `scripts/effis/fetch-wildfires.mjs`. CAMP-163 then added
 * `scripts/edo/fetch-drought.mjs` with a fourth copy of the list, and
 * nothing anywhere compared it — a list maintained by hand beside a copy
 * nothing checks is the exact defect this file exists to prevent, and it
 * reappeared the first time a second CEMS source arrived.
 *
 * Scripts cannot import TypeScript, so the copies are unavoidable. What
 * is avoidable is a copy no test has heard of.
 */
const SCRIPTS_DIR = join(__dirname, '..', '..', '..', '..', 'scripts');

function fetchScriptsWithWordList(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...fetchScriptsWithWordList(full));
      continue;
    }
    if (!entry.name.endsWith('.mjs')) continue;
    if (/export const FORBIDDEN_WORDS\b/.test(readFileSync(full, 'utf8'))) out.push(full);
  }
  return out;
}

const SCRIPTS = fetchScriptsWithWordList(SCRIPTS_DIR);

/**
 * A REAL dynamic import, written so the transpiler cannot rewrite it —
 * `wildfire-fetch.spec.ts` explains why. Evaluating the script does nothing:
 * no fetch, no write.
 */
const load = new Function('u', 'return import(u)') as (
  u: string,
) => Promise<{ FORBIDDEN_WORDS: RegExp }>;

/**
 * Every form the list is meant to refuse, written out by hand and NOT
 * derived from any of the three regexes — so weakening all three the same
 * way still fails here.
 */
const FORMS = [
  'warning', 'warnings',
  'danger', 'dangers', 'dangerous', 'dangerously',
  'risk', 'risks', 'risky', 'riskier', 'riskiest', 'risked', 'risking',
  'alert', 'alerts', 'alerted', 'alerting',
  'evacuate', 'evacuates', 'evacuated', 'evacuating', 'evacuation', 'evacuations',
];

/** Words that merely look like them, and are somebody's name or another word. */
const LOOKALIKES = ['brisk', 'Warwickshire', 'Alerta', 'Dangerfield', 'Risko'];

test.describe('the gate, the script and the check are one list', () => {
  test('🔴 the feed gate demands the same notice this check does', () => {
    // 🔴 Mutation: loosen CEMS_NOTICE in src/lib/cems.ts to
    // /Contains modified/ — fails. The rendered-page check uses its own
    // strict copy and would otherwise sit beside a gate that had been
    // weakened, each looking fine to the other.
    expect(CEMS_NOTICE.source).toBe(LICENCE_NOTICE_MODIFIED.source);
    expect(CEMS_NOTICE.flags).toBe(LICENCE_NOTICE_MODIFIED.flags);
    expect(NOTICES.modified).toBe(LICENCE_NOTICE_MODIFIED);
    expect(NOTICES.generated).toBe(LICENCE_NOTICE_GENERATED);
  });

  test('🔴 every copy of the list is found, not just the one named here', () => {
    // 🔴 An empty discovery passes every loop below without running once.
    // The wildfire and drought scripts both keep a copy today; if this
    // ever reads fewer than two, the search is broken rather than the
    // repository tidy.
    expect(SCRIPTS.length, 'no fetch script with a word list was found').toBeGreaterThanOrEqual(2);
    expect(SCRIPTS.some((f) => f.endsWith('fetch-wildfires.mjs'))).toBe(true);
    expect(SCRIPTS.some((f) => f.endsWith('fetch-drought.mjs'))).toBe(true);
  });

  test('🔴 the gate, every fetch script and the check have the same list', async () => {
    // 🔴 Mutation: add or drop ANY word in one of the three — fails, and the
    // message names which two you forgot. Before CAMP-162 they had drifted:
    // "evacuate" and "evacuation" were in the gate and the script and not in
    // the check, so a component could say either and ship. The canonical
    // copy is RESERVED_WORDS in src/lib/cems.ts.
    for (const file of SCRIPTS) {
      const script = (await load(pathToFileURL(file).href)).FORBIDDEN_WORDS;
      expect(script.source, `${file} has drifted from src/lib/cems.ts`).toBe(RESERVED_WORDS.source);
      expect(script.flags, `${file} has drifted from src/lib/cems.ts`).toBe(RESERVED_WORDS.flags);
    }
    expect(FORBIDDEN_WORDS.source, 'tests/unit/cems-panel.ts has drifted from src/lib/cems.ts').toBe(
      RESERVED_WORDS.source,
    );
    expect(FORBIDDEN_WORDS.flags).toBe(RESERVED_WORDS.flags);
  });

  test('🔴 each form is refused by all three, in either case', async () => {
    // Driven from a hand-written list, not from a regex, so a list weakened
    // everywhere identically is still seen. Mutation: delete `risk|` from
    // all three at once — fails on every risk form.
    const scripts = await Promise.all(
      SCRIPTS.map(async (f) => [f, (await load(pathToFileURL(f).href)).FORBIDDEN_WORDS] as const),
    );
    for (const word of FORMS) {
      for (const form of [word, word.toUpperCase(), `${word[0].toUpperCase()}${word.slice(1)}`]) {
        expect(RESERVED_WORDS.test(form), `the gate lets "${form}" through`).toBe(true);
        for (const [f, script] of scripts) {
          expect(script.test(form), `${f} lets "${form}" through`).toBe(true);
        }
        expect(wordProblems(`<p>a ${form} b</p>`), `the page check lets "${form}" through`).toHaveLength(1);
      }
    }
  });

  test('a lookalike is refused by none of them', async () => {
    // A list that refused "Alerta", a commune, would be the false alarm
    // that teaches people to switch it off.
    const scripts = await Promise.all(
      SCRIPTS.map(async (f) => [f, (await load(pathToFileURL(f).href)).FORBIDDEN_WORDS] as const),
    );
    for (const word of LOOKALIKES) {
      expect(RESERVED_WORDS.test(word), `the gate refuses "${word}"`).toBe(false);
      for (const [f, script] of scripts) {
        expect(script.test(word), `${f} refuses "${word}"`).toBe(false);
      }
      expect(wordProblems(`<p>${word}</p>`), `the page check flags "${word}"`).toEqual([]);
    }
  });

  test('the four words on the card are all on the list', () => {
    // 🔴 Mutation: drop one from CARD_WORDS or from FORMS — fails.
    expect([...CARD_WORDS]).toEqual(['warning', 'danger', 'risk', 'alert']);
    for (const word of CARD_WORDS) expect(FORMS).toContain(word);
  });

  test('wildfires.ts re-exports the licence constants rather than keeping copies', () => {
    // 🔴 Mutation: redefine CEMS_NOTICE in wildfires.ts — fails on identity.
    expect(wildfires.CEMS_NOTICE).toBe(CEMS_NOTICE);
    expect(wildfires.RESERVED_WORDS).toBe(RESERVED_WORDS);
  });
});

// ── the check itself ─────────────────────────────────────────────────────
//
// 🔴 A safeguard nobody has watched fail is a safeguard nobody has. Every
// tool the tests above lean on is driven here with HTML written to defeat
// it. If any of these went green over a broken reader, the tests above
// would pass over a panel that said anything at all.

const NOTICE = 'Contains modified Copernicus Emergency Management Service information 2026';
const CREDITS = [LICENCE_NOTICE_MODIFIED];

test.describe('the reader of HTML is honest', () => {
  test('drops what a reader is not shown and keeps what they are', () => {
    expect(visibleText('<p>Data<span class="sr-only">hidden note</span> here</p>')).toBe('Data here');
    expect(visibleText('<p>a<b hidden="">b</b> c<i style="display: none">d</i> e</p>')).toBe('a c e');
  });

  test('🔴 knows where a hidden element ENDS — the case a lazy regex gets wrong', () => {
    // `<div hidden>…</div>` closed at its first `</div>` leaves "b" looking
    // visible, and a credit hidden that way would then count as shown.
    expect(visibleText('<div hidden=""><div>a</div><p>b</p></div><p>c</p>')).toBe('c');
    expect(visibleText('<div class="x sr-only"><ul><li>a</li></ul><p>b</p></div><p>c</p>')).toBe('c');
  });

  test('🔴 knows every way this codebase hides something, at any breakpoint', () => {
    // 🔴 Mutation: delete an entry of HIDING_UTILITIES, or the style regex's
    // `visibility` arm — the matching row fails. On the first review a credit
    // in `class="hidden"`, `md:hidden` or `visibility:hidden` was read as
    // visible and the suite stayed green.
    const hidden = [
      '<span class="hidden">SECRET</span>',
      '<span class="text-sm hidden">SECRET</span>',
      '<span class="md:hidden">SECRET</span>',
      '<span class="max-md:hidden">SECRET</span>',
      '<span class="sm:max-md:hidden">SECRET</span>',
      '<span class="!hidden">SECRET</span>',
      '<span class="md:!hidden">SECRET</span>',
      '<span class="invisible">SECRET</span>',
      '<span class="opacity-0">SECRET</span>',
      '<span class="collapse">SECRET</span>',
      '<span class="sr-only">SECRET</span>',
      '<span style="visibility:hidden">SECRET</span>',
      '<span style="visibility: collapse">SECRET</span>',
      '<span style="opacity:0">SECRET</span>',
      '<span style="font-size:0">SECRET</span>',
      '<span style="display : none">SECRET</span>',
      '<span hidden="">SECRET</span>',
      '<script>SECRET</script>',
      '<style>SECRET</style>',
      '<template>SECRET</template>',
      '<div class="hidden"><p><b>SECRET</b></p></div>',
    ];
    for (const html of hidden) {
      expect(visibleText(`<p>shown ${html} end</p>`), html).toBe('shown end');
    }
  });

  test('does not hide what merely has the word in its name', () => {
    // A check that hid `overflow-hidden` would refuse every panel with a
    // rounded corner, and be argued out of the suite.
    const visible = [
      '<span class="overflow-hidden">SEEN</span>',
      '<span class="text-hidden">SEEN</span>',
      '<span class="opacity-50">SEEN</span>',
      '<span class="not-hidden">SEEN</span>',
      '<span style="opacity:0.5">SEEN</span>',
      '<span style="font-size:0.9rem">SEEN</span>',
      '<span style="display:block">SEEN</span>',
      '<span data-class="hidden" data-hidden="true">SEEN</span>',
      '<span title="a hidden thing">SEEN</span>',
    ];
    for (const html of visible) {
      expect(visibleText(`<p>x ${html} y</p>`), html).toBe('x SEEN y');
    }
  });

  test('🔴 inline elements join what is either side of them, block elements do not', () => {
    // 🔴 Mutation: drop `span` or `wbr` from INLINE, or make glueInline
    // always false — the first rows fail. Reviewed as measured: `Fire
    // <span>Ris</span><span>k</span>` read as "Fire Ris k".
    expect(visibleText('<p>Fire <span>Ris</span><span>k</span> level</p>')).toBe('Fire Risk level');
    expect(visibleText('<p>Dan<wbr>ger</p>')).toBe('Danger');
    expect(visibleText('<p><strong>Alert</strong>s</p>')).toBe('Alerts');
    expect(visibleText('<p>a</p><p>b</p>')).toBe('a b');
    expect(visibleText('<p>a<br>b</p>')).toBe('a b');
    expect(visibleText('<ul><li>a</li><li>b</li></ul>')).toBe('a b');
  });

  test('does not mistake the words "a hidden thing" in a value for the attribute', () => {
    expect(visibleText('<p title="a hidden thing">shown</p>')).toBe('shown');
  });

  test('a comment between text nodes does not split a word', () => {
    // Served HTML separates adjacent text nodes with `<!-- -->`.
    expect(visibleText('<p>War<!-- -->ning</p>')).toBe('Warning');
    expect(wordProblems('<p>War<!-- -->ning</p>')).toHaveLength(1);
  });

  test('decodes each entity once, never twice', () => {
    expect(visibleText('<p>&amp;#x27;</p>')).toBe('&#x27;');
    expect(visibleText('<p>R&amp;D &rsquo;26 &copy; EU</p>')).toBe('R&D ’26 © EU');
  });

  test('void elements do not swallow what follows them', () => {
    expect(visibleText('<div hidden=""><br/></div><p>a<br>b</p>')).toBe('a b');
  });

  test('everythingSaid keeps hidden text and reads spoken attributes, not class or href', () => {
    const said = everythingSaid(
      '<div class="border-danger" data-alert="x"><a href="/x?alert=1" title="T&amp;C" aria-label="lab">go</a>' +
        '<img alt="pic"/><span class="sr-only">hush</span></div>',
    ).join(' | ');
    expect(said).toContain('hush');
    expect(said).toContain('T&C');
    expect(said).toContain('lab');
    expect(said).toContain('pic');
    expect(said).not.toContain('border-danger');
    expect(said).not.toContain('alert=1');
  });
});

test.describe('the credit check is honest', () => {
  const page = (inner: string) => `<div role="status"><p>Figure.</p>${inner}</div>`;

  test('accepts the notice, and accepts it split across lines and comments', () => {
    // The TRAP the card names: served HTML wraps lines, so a long
    // quotation matched against the bytes is absent from a correct page.
    // 🔴 Mutation: read `html` instead of `visibleText(html)` in
    // creditProblems — the wrapped form fails.
    expect(creditProblems(page(`<p>${NOTICE}</p>`), CREDITS)).toEqual([]);
    expect(
      creditProblems(page('<p>Contains modified Copernicus\n      Emergency Management<!-- --> Service information\n 2026</p>'), CREDITS),
    ).toEqual([]);
  });

  test('refuses a page with no notice, a template year, or the other notice', () => {
    expect(creditProblems(page(''), CREDITS)).toHaveLength(1);
    expect(creditProblems(page(`<p>${NOTICE.replace('2026', '[Year]')}</p>`), CREDITS)).toHaveLength(1);
    expect(
      creditProblems(page(`<p>${NOTICE.replace('Contains modified', 'Generated using')}</p>`), CREDITS),
    ).toHaveLength(1);
    // 🔴 The two notices crossed. "Generated using modified …" is neither.
    expect(
      creditProblems(page(`<p>${NOTICE.replace('Contains', 'Generated using')}</p>`), CREDITS),
    ).toHaveLength(1);
  });

  test('🔴 a credit only a screen reader, or nobody, is given is no credit', () => {
    // 🔴 Mutation: stop dropping hidden elements in `visibleText` — fails.
    expect(creditProblems(page(`<span class="sr-only">${NOTICE}</span>`), CREDITS)).toHaveLength(1);
    expect(creditProblems(page(`<p hidden="">${NOTICE}</p>`), CREDITS)).toHaveLength(1);
    expect(creditProblems(page(`<p style="display:none">${NOTICE}</p>`), CREDITS)).toHaveLength(1);
    // …and neither is one that lives only in an attribute.
    expect(creditProblems(page(`<a title="${NOTICE}" href="/x">source</a>`), CREDITS)).toHaveLength(1);
  });

  test('🔴 a credit hidden the way this codebase hides things is no credit', () => {
    // The pair that was green on the first review: the attribution wrapped
    // in a class that display:nones it.
    for (const html of [
      `<span class="hidden">${NOTICE}</span>`,
      `<span class="md:hidden">${NOTICE}</span>`,
      `<span class="invisible">${NOTICE}</span>`,
      `<span style="visibility:hidden">${NOTICE}</span>`,
      `<span style="opacity:0">${NOTICE}</span>`,
      `<script>${NOTICE}</script>`,
    ]) {
      expect(creditProblems(page(html), CREDITS), html).toHaveLength(1);
    }
  });

  test('🔴 a panel file cannot lower the credit it owes', () => {
    // 🔴 Mutation: make requiredCredits return `panel.alsoCredits ?? []` —
    // the first three fail. On the first review `credits: []` in the panel
    // file, with the attribution deleted from the component, left all 27
    // tests green; `[/./]` was green too.
    const base: CemsPanel = {
      source: 'stand-in',
      notice: 'modified',
      dataMarker: /x/,
      scenarios: () => [],
    };
    const bare = page('<p>Nothing of the sort.</p>');
    for (const alsoCredits of [undefined, [], [/./], [/Figure/]]) {
      const owed = requiredCredits({ ...base, alsoCredits });
      expect(owed[0], 'the licence notice is not first').toBe(LICENCE_NOTICE_MODIFIED);
      expect(creditProblems(bare, owed), `alsoCredits=${String(alsoCredits)} let a bare page through`).not.toEqual([]);
    }
    // …and what a panel adds is added.
    expect(requiredCredits({ ...base, alsoCredits: [/CC BY/] })).toHaveLength(2);
    expect(requiredCredits({ ...base, notice: 'generated' })[0]).toBe(LICENCE_NOTICE_GENERATED);
    // A panel that does not say which notice it owes is an error, never
    // "nothing required".
    for (const notice of [undefined, null, '', 'none', 'Modified']) {
      expect(() => requiredCredits({ ...base, notice: notice as never }), String(notice)).toThrow(/must declare notice/);
    }
  });

  test('the two notices are not interchangeable', () => {
    // A panel showing modified data must not be satisfied by the other one.
    expect(creditProblems(page(`<p>${NOTICE}</p>`), [LICENCE_NOTICE_GENERATED])).toHaveLength(1);
    expect(
      creditProblems(page(`<p>${NOTICE.replace('Contains modified', 'Generated using')}</p>`), [
        LICENCE_NOTICE_MODIFIED,
      ]),
    ).toHaveLength(1);
  });

  test('reports each missing credit separately', () => {
    expect(creditProblems(page(`<p>${NOTICE}</p>`), [LICENCE_NOTICE_MODIFIED, /CC BY 4\.0/])).toHaveLength(1);
  });
});

test.describe('the words check is honest', () => {
  test('finds each of the four words, in any case and any inflection', () => {
    // 🔴 Mutation: delete one entry of FORBIDDEN_WORDS — that word fails.
    for (const said of [
      'A fire warning',
      'DANGER',
      'no Risk here',
      'an Alert',
      'weather warnings',
      'dangerous roads',
      'a risky drive',
      'alerts nearby',
    ]) {
      expect(wordProblems(`<p>${said}</p>`), said).toHaveLength(1);
    }
  });

  test('🔴 finds a word wherever a reader or a screen reader meets it', () => {
    // 🔴 Mutation: read `visibleText` instead of `everythingSaid` in
    // wordProblems — the first three go undetected.
    expect(wordProblems('<span class="sr-only">Fire risk</span>')).toHaveLength(1);
    expect(wordProblems('<p hidden="">danger</p>')).toHaveLength(1);
    expect(wordProblems('<button aria-label="alert me">x</button>')).toHaveLength(1);
    expect(wordProblems('<a title="Official warnings" href="/x">x</a>')).toHaveLength(1);
    expect(wordProblems('<img alt="danger sign"/>')).toHaveLength(1);
  });

  test('🔴 finds a word split across sibling elements, as a reader would read it', () => {
    // 🔴 Mutation: read only the spaced view in everythingSaid — the first
    // three fail. Measured on the first review: `Fire <span>Ris</span>
    // <span>k</span> level` read as "Fire Ris k level" and was not caught.
    for (const html of [
      '<p>Fire <span>Ris</span><span>k</span> level</p>',
      '<p>Dan<wbr>ger</p>',
      '<p><strong>Alert</strong>s</p>',
      '<p>War<!-- -->ning</p>',
      '<p><b>Fire</b><i>risk</i></p>',
      '<p>evacu<span>ation</span></p>',
    ]) {
      expect(wordProblems(html), html).not.toEqual([]);
    }
  });

  test('🔴 does not fire on markup that is not a sentence', () => {
    // A check that cried wolf on a Tailwind token would be switched off.
    expect(wordProblems('<div class="border-danger text-alert" data-risk="1"><a href="/x?warning=1">ok</a></div>')).toEqual([]);
    expect(wordProblems('<p>A brisk walk in Warwickshire</p>')).toEqual([]);
  });

  test('shows the sentence a word was found in', () => {
    const [problem] = wordProblems('<p>Burnt areas mapped, with the fire risk shown.</p>');
    expect(problem).toContain('risk');
    expect(problem).toContain('Burnt areas mapped');
  });
});
