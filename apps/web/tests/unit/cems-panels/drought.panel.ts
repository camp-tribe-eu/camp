import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DroughtPanel } from '@/components/drought-panel';
import { FRESH_FOR_DAYS, droughtState, type DroughtPick } from '@/lib/drought';
import { renderComponent } from '../render-component';
import type { CemsPanel, CemsScenario } from '../cems-panel';

// CAMP-163 — the EDO drought layer, declared as a CEMS panel.
//
// Copied from `wildfire.panel.ts` as the spec's header says, with the
// component and the state function swapped. Every scenario goes RAW FEED →
// the reader the browser uses (`droughtState`) → the real component → HTML,
// so a mutation that removes a gate changes the HTML and the spec sees it.
//
// 🔴 THE CORPUS IS THE FILE WE SHIP, with only the clock and `fetchedAt`
// moved — the wildfire panel's rule. `drought.json` carries a dekad, and the
// page stops calling it fresh 40 days after it began, so a test that
// asserted "fresh" against the file as committed would go red on the 41st
// day for no reason but the calendar. The content — credit, authority
// note, links, the real 1 824 × 1 200 grid — is the shipped file's; the
// clock is the test's.
//
// 🔴 EXCEPT WHERE A BRANCH NEEDS A CELL TO HOLD A PARTICULAR VALUE. The
// class a campsite is given depends on where it is and on which dekad is
// committed, so the sentences for "class 2 of 3", "a recovery class", "no
// class", "outside the grid" and "a row we could not read" cannot be
// reached by pointing at the real grid — next dekad the same campsite would
// land in another one, and the word check would quietly stop examining
// that sentence. Those use a 48 × 48 grid built by construction (below),
// with the shipped `meta` and nothing else changed.

const FEED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'src', 'data', 'drought.json'), 'utf8'),
) as { meta: Record<string, string>; grid: Record<string, unknown> };

const DAY = 86_400_000;
const START = Date.parse(`${FEED.meta.dekad}T00:00:00Z`);

/** The test's clock: `daysOld` whole days after the first day of the shipped dekad, at midday. */
const clock = (daysOld: number) => new Date(START + daysOld * DAY + 12 * 3_600_000);

const feed = (
  daysOld: number,
  meta: Record<string, unknown> = {},
  grid: unknown = FEED.grid,
) => ({
  meta: {
    ...FEED.meta,
    // Read six hours before "now", never before the period began.
    fetchedAt: new Date(clock(daysOld).getTime() - 6 * 3_600_000).toISOString(),
    ...meta,
  },
  grid,
});

/** The panel as the page renders it, for a raw feed body. */
const panelFor = (
  raw: unknown,
  now: Date,
  picked: DroughtPick | null = null,
  on = true,
): string => renderComponent(DroughtPanel, { state: droughtState(raw, now), on, picked });

// ── a grid built by construction ─────────────────────────────────────────
//
// 48 × 48 cells at 24 per degree: a 2° × 2° box with its north-west corner
// at 14°E, 36°N (Malta is in it). Columns 0–7 hold class 1, 8–15 class 2,
// 16–23 class 3, 24–31 a recovery class, 32–47 hold 0. The last row is
// corrupted on purpose. The runs are written out by hand here, and not
// built with the fetch script's encoder, so the reader is measured against
// a string it did not help write.

const W = 14;
const N = 36;
const ROW = '1:8,2:8,3:8,4:8,0:16';
const BUILT = {
  west: W,
  north: N,
  cellsPerDegree: 24,
  width: 48,
  height: 48,
  rows: [...Array.from({ length: 47 }, () => ROW), 'this row is not runs'],
};

/** The middle of cell (col, row) of BUILT, as a campsite would be placed there. */
const at = (col: number, row: number, name: string | null = 'Camping Sole'): DroughtPick => ({
  name,
  lat: N - (row + 0.5) / 24,
  lon: W + (col + 0.5) / 24,
});

/**
 * A feed that says a reserved word in ONE of the four strings the panel
 * prints. `readFeed` must refuse it, so the reader is shown "no fresh data"
 * and not the word. The credit stays valid in every variant but the one
 * being corrupted, so it is the word alone that gets it refused.
 */
const hostile = (field: string, value: string): CemsScenario => ({
  name: `a feed whose ${field} says a reserved word`,
  html: panelFor(feed(27, { [field]: value }), clock(27)),
  showsData: false,
});

/** A campsite whose OpenStreetMap name says one of the words. */
const hostileName = (word: string): CemsScenario => ({
  name: `a campsite whose name says "${word}"`,
  html: panelFor(feed(27, {}, BUILT), clock(27), at(3, 5, `Camping ${word} Bay`)),
  showsData: true,
});

const panel: CemsPanel = {
  source: 'EDO drought',
  layer: 'drought',

  // What every data-bearing headline has in common — with no campsite
  // picked, or with one, whichever class it lands in, "no class", or
  // outside the grid: "Copernicus EDO's Combined Drought Indicator for
  // 11–20 September 2026 …". No gap states says "…Indicator for".
  dataMarker: /Combined Drought Indicator for [^.]*\d{4}/,

  // The licence's notice for data we have decoded, recoloured and sampled.
  notice: 'modified',
  // On top of it: the source named as the licence asks, the terms link, and
  // the period — the honest caption on a slow indicator.
  alsoCredits: [
    /Copernicus European Drought Observatory \(EDO\)/,
    /CEMS terms/,
    /Combined Drought Indicator \(CDI\) v4\.1, \d+–\d+ \w+ \d{4}, read from Copernicus on/,
  ],

  scenarios: () => [
    {
      name: 'loading',
      html: renderComponent(DroughtPanel, { state: { kind: 'loading' }, on: true, picked: null }),
      showsData: false,
    },
    {
      name: 'switched off by the reader',
      html: panelFor(feed(27), clock(27), null, false),
      showsData: false,
    },
    {
      name: 'the file would not load or is not the shape we wrote',
      html: panelFor({ not: 'a feed' }, clock(27)),
      showsData: false,
    },
    {
      name: `the newest period began ${FRESH_FOR_DAYS + 1} days ago, past the budget`,
      html: panelFor(feed(FRESH_FOR_DAYS + 1), clock(FRESH_FOR_DAYS + 1)),
      showsData: false,
    },
    {
      name: 'the newest period is dated in the future',
      html: panelFor(feed(-3, { fetchedAt: new Date(START + DAY).toISOString() }), clock(-3)),
      showsData: false,
    },
    {
      // The two layers this service advertises as current and stops in
      // 2024. A file that says it came from either is refused whatever its
      // date, so the page shows the gap and not a 2024 grid.
      name: 'a file that says it came from smand',
      html: panelFor(feed(27, { coverage: 'smand' }), clock(27)),
      showsData: false,
    },
    {
      name: 'a file that says it came from cdinx',
      html: panelFor(feed(27, { coverage: 'cdinx' }), clock(27)),
      showsData: false,
    },
    {
      // 🔴 The card's own case: 27 days is what a healthy service looks like.
      name: 'fresh at 27 days, nothing picked yet',
      html: panelFor(feed(27), clock(27)),
      showsData: true,
    },
    {
      name: `fresh at ${FRESH_FOR_DAYS} days, the last day inside the budget`,
      html: panelFor(feed(FRESH_FOR_DAYS), clock(FRESH_FOR_DAYS)),
      showsData: true,
    },
    {
      name: 'fresh, a campsite picked on the shipped grid',
      html: panelFor(feed(27), clock(27), { name: 'Camping Sole', lat: 45.8, lon: 15.95 }),
      showsData: true,
    },
    {
      name: 'fresh, a campsite in Malta on the shipped grid',
      html: panelFor(feed(27), clock(27), { name: 'Camping Valletta', lat: 35.8989, lon: 14.5146 }),
      showsData: true,
    },
    // ── every sentence the sample can lead to ────────────────────────────
    { name: 'a campsite in drought class 1', html: panelFor(feed(27, {}, BUILT), clock(27), at(3, 5)), showsData: true },
    { name: 'a campsite in drought class 2', html: panelFor(feed(27, {}, BUILT), clock(27), at(11, 5)), showsData: true },
    { name: 'a campsite in drought class 3', html: panelFor(feed(27, {}, BUILT), clock(27), at(19, 5)), showsData: true },
    { name: 'a campsite in a recovery class', html: panelFor(feed(27, {}, BUILT), clock(27), at(27, 5)), showsData: true },
    { name: 'a campsite where the raster holds no class', html: panelFor(feed(27, {}, BUILT), clock(27), at(40, 5)), showsData: true },
    { name: 'a campsite outside the grid', html: panelFor(feed(27, {}, BUILT), clock(27), { name: 'Camping Azul', lat: 38.7, lon: -27.2 }), showsData: true },
    { name: 'a campsite in a row of the file we could not read', html: panelFor(feed(27, {}, BUILT), clock(27), at(3, 47)), showsData: true },
    { name: 'a campsite with no usable coordinates', html: panelFor(feed(27, {}, BUILT), clock(27), { name: 'Camping X', lat: Number.NaN, lon: 14.5 }), showsData: true },
    { name: 'a campsite with no name', html: panelFor(feed(27, {}, BUILT), clock(27), at(3, 5, null)), showsData: true },
    // The four strings the panel prints out of the feed. Each carries a
    // different word, so one regex alternative going missing shows up as
    // one scenario, not four.
    hostile('source', 'Copernicus drought danger service'),
    hostile('attribution', `${FEED.meta.attribution} — severe drought risk`),
    hostile('authorityNote', 'Official drought warning issued by the regional service'),
    hostile('product', 'Combined Drought Alert Indicator'),
    // The one string that arrives from a third party: a campsite's name.
    hostileName('Warning'),
    hostileName('Danger'),
    hostileName('Risk'),
    hostileName('Alert'),
  ],
};

export default panel;
