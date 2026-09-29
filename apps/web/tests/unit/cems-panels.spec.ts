import { expect, test } from '@playwright/test';
import { LayerChip } from '@/components/layer-chip';
import { CEMS_NOTICE, RESERVED_WORDS } from '@/lib/cems';
import { LAYERS } from '@/lib/map-layers';
import * as wildfires from '@/lib/wildfires';
import {
  FORBIDDEN_WORDS,
  LICENCE_NOTICE_MODIFIED,
  creditProblems,
  discoverPanels,
  wordProblems,
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
// ⚠️ WHAT THIS DOES NOT COVER. The card a reader gets by clicking a burnt
// area is built with `document.createElement` inside MapLibre's popup,
// which needs a browser; `wildfire-layer.spec.ts` ("the card on a burnt
// area carries the credit and no reserved word") reads it there. And the
// site is English. A second language would need its own words here.
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
  // Mutation: put `throw new Error('x')` at the top of a *.panel.ts — only
  // this test, for that file, fails.
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
      // `<span className="sr-only">` — fails too, because a credit only a
      // screen reader is given is not on the page.
      for (const s of panel.scenarios().filter((x) => x.showsData)) {
        expect.soft(
          creditProblems(s.html, panel.credits),
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

// ── the licence's words, in the gate and in the check ────────────────────

test.describe('the gate and the check agree on what the licence says', () => {
  test('🔴 the feed gate demands the same notice this check does', () => {
    // 🔴 Mutation: loosen CEMS_NOTICE in src/lib/cems.ts to
    // /Contains modified/ — fails. The rendered-page check uses its own
    // strict copy and would otherwise sit beside a gate that had been
    // weakened, each looking fine to the other.
    expect(CEMS_NOTICE.source).toBe(LICENCE_NOTICE_MODIFIED.source);
    expect(CEMS_NOTICE.flags).toBe(LICENCE_NOTICE_MODIFIED.flags);
  });

  test('🔴 the feed gate refuses each of the four words', () => {
    // 🔴 Mutation: delete `risk|` from RESERVED_WORDS — fails on "risk".
    //
    // The gate is whole-word and this check is anchored at the start of
    // the word, so the check is the stricter of the two: "dangers" is not
    // on the gate's list and would be caught by the check on a rendered
    // page. That is the direction to be wrong in, and it is written down
    // here rather than "fixed" because widening the gate also widens what
    // `readFire` blanks out of a place name.
    for (const { word } of FORBIDDEN_WORDS) {
      expect(RESERVED_WORDS.test(word), `the gate would let "${word}" through`).toBe(true);
      expect(RESERVED_WORDS.test(word.toUpperCase()), `the gate would let "${word.toUpperCase()}" through`).toBe(
        true,
      );
    }
    expect(FORBIDDEN_WORDS.map((f) => f.word)).toEqual(['warning', 'danger', 'risk', 'alert']);
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
