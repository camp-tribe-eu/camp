import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { everythingSaid, visibleText } from './rendered-text';

// CAMP-162 — the vocabulary `cems-panels.spec.ts` and every
// `cems-panels/*.panel.ts` file share. What is in HERE is the licence;
// what is in the panel files is one source's way of showing it.

/**
 * The credit the CEMS terms dictate for data that has been ADAPTED OR
 * MODIFIED, written out from the licence.
 *
 * `https://drought.emergency.copernicus.eu/terms&conditions`, read
 * 28.09.2026: "Where the data of the CEMS early warning and monitoring
 * systems has been adapted or modified, the user shall provide the
 * following or similar notice: 'Contains modified Copernicus Emergency
 * Management Service information [Year]'".
 *
 * 🔴 DELIBERATELY NOT IMPORTED FROM `src/lib/cems.ts`. That constant is
 * what the feed GATE uses; this one is what the RENDERED PAGE is measured
 * against. Were they one binding, weakening the gate (say to `/Contains/`)
 * would weaken the check in the same edit and both would go on agreeing.
 * The spec asserts the two are equal instead, so they can only be changed
 * together, on purpose, in view.
 *
 * Data passed on untouched takes "Generated using …" instead
 * (docs/emergency-sources.md §3). A panel showing data of that kind says
 * so in its own `credits`.
 */
export const LICENCE_NOTICE_MODIFIED =
  /Contains modified Copernicus Emergency Management Service information \d{4}\b/;

/**
 * The words the CEMS terms leave to national and regional institutions:
 * "the data does not constitute in any way an early warning for which
 * only national/regional institutions are authorized within their region
 * of responsibility".
 *
 * 🔴 Written out from the card, not imported from `RESERVED_WORDS`, for
 * the reason above. And anchored at the START of the word only, so
 * "warnings", "dangerous", "risky" and "alerts" are all caught while
 * "brisk" and "Warwickshire" are not.
 */
export const FORBIDDEN_WORDS: readonly { word: string; pattern: RegExp }[] = [
  { word: 'warning', pattern: /\bwarning/i },
  { word: 'danger', pattern: /\bdanger/i },
  { word: 'risk', pattern: /\brisk/i },
  { word: 'alert', pattern: /\balert/i },
];

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
  /** What must be readable beside the data. Usually the notice, plus the CC BY line. */
  credits: readonly RegExp[];
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
  for (const said of everythingSaid(html)) {
    for (const { word, pattern } of FORBIDDEN_WORDS) {
      const hit = pattern.exec(said);
      if (hit) found.push(`"${word}" in ${around(said, hit.index)}`);
    }
  }
  return found;
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
