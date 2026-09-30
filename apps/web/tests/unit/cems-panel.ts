import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { everythingSaid, visibleText } from './rendered-text';

// CAMP-162 — the vocabulary `cems-panels.spec.ts` and every
// `cems-panels/*.panel.ts` file share. What is in HERE is the licence;
// what is in the panel files is one source's way of showing it.

/**
 * The two notices the CEMS terms dictate, written out from the licence.
 *
 * `https://drought.emergency.copernicus.eu/terms&conditions`, read
 * 28.09.2026: "Where the data of the CEMS early warning and monitoring
 * systems has been adapted or modified, the user shall provide the
 * following or similar notice: 'Contains modified Copernicus Emergency
 * Management Service information [Year]'" — and, for data passed on as it
 * came, 'Generated using Copernicus Emergency Management Service
 * information [Year]' (docs/emergency-sources.md §3).
 *
 * 🔴 DELIBERATELY NOT IMPORTED FROM `src/lib/cems.ts`. That constant is
 * what the feed GATE uses; these are what the RENDERED PAGE is measured
 * against. Were they one binding, weakening the gate (say to `/Contains/`)
 * would weaken the check in the same edit and both would go on agreeing.
 * The spec asserts the two are equal instead, so they can only be changed
 * together, on purpose, in view.
 */
export const LICENCE_NOTICE_MODIFIED =
  /Contains modified Copernicus Emergency Management Service information \d{4}\b/;
export const LICENCE_NOTICE_GENERATED =
  /Generated using Copernicus Emergency Management Service information \d{4}\b/;

/**
 * Which notice a panel owes, by whether the data on it has been changed.
 * Every layer we have filtered to the EU-27, cut to a window, rounded or
 * re-coloured is `modified`; `generated` is for data shown exactly as
 * published, and a panel that claims it should be able to say why.
 */
export const NOTICES = {
  modified: LICENCE_NOTICE_MODIFIED,
  generated: LICENCE_NOTICE_GENERATED,
} as const;

/**
 * The words the CEMS terms leave to national and regional institutions:
 * "the data does not constitute in any way an early warning for which
 * only national/regional institutions are authorized within their region
 * of responsibility".
 *
 * 🔴 THIS IS THE CHECK'S OWN COPY of a list of which `RESERVED_WORDS` in
 * `src/lib/cems.ts` is the canonical one and `FORBIDDEN_WORDS` in
 * `scripts/effis/fetch-wildfires.mjs` the third. Written out here rather
 * than imported for the reason above, and the spec asserts all three have
 * the same `source` — so it is one list in three places that can only move
 * together, and it is driven word by word through the gate and through
 * this check.
 *
 * Before CAMP-162 they were not one list: the gate and the script refused
 * "evacuate" and "evacuation", this check did not, and a component could
 * have said either and shipped. Whole words with the inflections written
 * out — "brisk", "Warwickshire" and "Alerta" (a commune) are not the words.
 * A form that is not written out (say "warned") is not caught anywhere;
 * adding one means adding it to all three, and the spec says which two you
 * forgot.
 */
export const FORBIDDEN_WORDS =
  /\b(warning(?:s)?|danger(?:s|ous|ously)?|risk(?:s|y|ier|iest|ed|ing)?|alert(?:s|ed|ing)?|evacuat(?:e|es|ed|ing|ion|ions))\b/i;

/** The four words the card names. The list above is these plus their forms and "evacuate". */
export const CARD_WORDS = ['warning', 'danger', 'risk', 'alert'] as const;

/** One state a panel can be in, rendered the way the page renders it. */
export interface CemsScenario {
  /** What is true of the world, for a failure message: "fresh, 3 in view". */
  name: string;
  /**
   * The HTML the page serves for it.
   *
   * 🔴 From `renderComponent` (or `renderAsyncComponent`) applied to the
   * REAL component, and — where the state comes from a feed — from the
   * RAW feed through the same reader the browser uses. Never a string typed
   * into a test: a check that reads its own fixture agrees with itself.
   */
  html: string;
  /**
   * True when CEMS-derived data is on screen in this state, so the
   * licence's credit is owed beside it. A loading sentence, a "no fresh
   * data" sentence and a switched-off layer show none.
   */
  showsData: boolean;
}

/** A CEMS-sourced panel, as one `cems-panels/<source>.panel.ts` declares it. */
export interface CemsPanel {
  /** The product, for test titles: "EFFIS wildfire". */
  source: string;
  /**
   * The `id` of the `LAYERS` entry it belongs to, when it is a map layer.
   * That entry must carry `terms: 'cems'`, and the spec fails if a layer
   * does and has no panel here, or if a panel names one that does not.
   */
  layer?: string;
  /**
   * Text that the data-bearing states show and the gaps do not. It is how
   * the spec knows a `showsData` scenario really IS one: without it, a
   * feed that quietly stopped parsing would render the gap sentence, the
   * "no forbidden word" check would pass over it, and nothing would say
   * the state it was meant to examine never appeared.
   */
  dataMarker: RegExp;
  /**
   * Which of the licence's two notices this panel owes. The spec supplies
   * the notice itself, from `NOTICES`; the panel only says which.
   *
   * 🔴 It is deliberately NOT a list of patterns the panel picks. A panel
   * file that supplied its own `credits` could switch the check off with
   * `credits: []`, or `[/./]`, in the very file that supplies the evidence —
   * measured on the first review of this card, with the attribution deleted
   * from the component and all 27 tests green. Now the check the panel is
   * held to is the licence's, and the panel can only ADD to it.
   */
  notice: keyof typeof NOTICES;
  /** Anything else that must be readable beside the data, on top of the notice: the CC BY line. */
  alsoCredits?: readonly RegExp[];
  /** Every state, gaps included — the gaps are where a stray word hides. */
  scenarios(): CemsScenario[];
}

/** A stretch of text around a match, so a failure shows the sentence. */
const around = (text: string, at: number): string =>
  `…${text.slice(Math.max(0, at - 40), at + 60).trim()}…`;

/**
 * The reserved words a page's HTML says, each with its sentence. Empty
 * means none. Reads what a reader OR a screen reader is told — see
 * `everythingSaid` for why that is the wider of the two views.
 */
export function wordProblems(html: string): string[] {
  const found: string[] = [];
  const every = new RegExp(FORBIDDEN_WORDS.source, 'gi');
  for (const said of everythingSaid(html)) {
    for (const hit of said.matchAll(every)) {
      found.push(`"${hit[0]}" in ${around(said, hit.index ?? 0)}`);
    }
  }
  // `everythingSaid` gives two readings of the same text; a word on which
  // they agree is one finding, not two.
  return [...new Set(found)];
}

/**
 * The credits that are NOT visible in a page's HTML. Empty means all are.
 *
 * 🔴 Read from the visible text, whitespace collapsed. Not from the raw
 * bytes: served HTML wraps lines, and a long quotation matched against
 * markup goes red on a correct page. Measured 29.09.2026 on the CEMS terms
 * page itself (curl, HTTP 200, 18 978 bytes): it is the DISCLAIMER that
 * wraps — "…national/regional institutions" ends line 203 and "are
 * authorized within…" starts line 204 — while the "Contains modified …
 * [Year]" notice sits whole on line 198. CAMP-153 shortened the disclaimer
 * marker for exactly this. Either can wrap tomorrow, so neither is matched
 * as bytes here.
 */
export function creditProblems(html: string, credits: readonly RegExp[]): string[] {
  const seen = visibleText(html);
  return credits
    .filter((credit) => !credit.test(seen))
    .map((credit) => `no visible text matches ${credit}`);
}

/**
 * What a panel must show beside its data: the licence's notice, chosen by
 * `panel.notice`, and whatever the panel asks for on top.
 *
 * 🔴 The notice comes from THIS file. A panel with no valid `notice` is an
 * error, not a panel with nothing required.
 */
export function requiredCredits(panel: CemsPanel): RegExp[] {
  const notice = NOTICES[panel.notice as keyof typeof NOTICES] as RegExp | undefined;
  if (!(notice instanceof RegExp)) {
    throw new Error(
      `"${panel.source}" must declare notice: 'modified' | 'generated', got ${JSON.stringify(panel.notice)}`,
    );
  }
  return [notice, ...(panel.alsoCredits ?? [])];
}

/**
 * Every `cems-panels/*.panel.ts`, each exporting a `CemsPanel` as default.
 *
 * 🔴 Found, not listed. Adding a source is adding one file: nothing else
 * has to be edited, so two cards adding one each cannot collide on a shared
 * array, and a new file cannot be forgotten in a list that lives elsewhere.
 * The spec fails if the directory yields nothing, or a file yields no
 * panel, so "found nothing" is never a pass.
 *
 * 🔴 ONE BAD FILE COSTS ONE FILE. A panel that throws while loading is
 * returned as an `error` rather than thrown, so the spec can fail that one
 * file by name and go on reading the others; thrown here, it would take
 * the whole spec down at collection and every other source would go
 * unchecked for as long as it took somebody to find the typo.
 */
export type FoundPanel = { file: string; panel: CemsPanel } | { file: string; error: string };

export function discoverPanels(): FoundPanel[] {
  const dir = join(__dirname, 'cems-panels');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.panel.ts'))
    .sort()
    .map((file): FoundPanel => {
      try {
        // A dynamic require, and on purpose: it is what makes "add a file"
        // the whole procedure. Playwright compiles the `.ts` on the way in.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(join(dir, file)) as { default?: CemsPanel };
        if (!mod.default) throw new Error(`${file} must export a CemsPanel as its default`);
        return { file, panel: mod.default };
      } catch (e) {
        return { file, error: e instanceof Error ? e.message : String(e) };
      }
    });
}
