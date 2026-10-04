import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { DroughtPanel } from '@/components/drought-panel';
import { droughtState } from '@/lib/drought';
import { renderComponent } from '../render-component';
import type { CemsPanel, CemsScenario } from '../cems-panel';

// CAMP-163 — the EDO drought layer, declared as a CEMS panel.
//
// 🔴 A panel with no file here is a panel nothing checks. `cems-panel.ts`
// discovers `*.panel.ts` by reading this directory, so the absence of
// this file would not be an error anywhere — it would simply mean the
// drought panel's words were never held to the licence. That is the same
// "advertised and not served" shape this card found twice in Copernicus'
// own documentation, and it would be ours.
//
// 🔴 Every scenario goes RAW FILES → the reader the page uses
// (`droughtState`) → the real component → HTML. The page does exactly
// those three steps, so the gates that refuse a file sit INSIDE what is
// measured: delete the reserved-word check from `drought.ts` and the HTML
// changes, and the spec reads the HTML.
//
// 🔴 The corpus is the two files we SHIP, with only the clock moved. The
// dekad in them is real and so is the credit; the clock is the test's,
// because a reading goes "behind" once a ten-day publication has been
// missed, and a test that asserted "current" against the committed file
// would go red in November for no reason but the calendar.

const DATA = join(__dirname, '..', '..', '..', 'src', 'data');
const FILE = JSON.parse(readFileSync(join(DATA, 'drought.json'), 'utf8')) as {
  meta: Record<string, unknown> & { dekad: string; classes: { value: number }[] };
  cdi: string;
};
const DOMAIN = JSON.parse(readFileSync(join(DATA, 'drought-domain.json'), 'utf8')) as {
  domain: string;
};

const decode = (s: string): Uint8Array => new Uint8Array(gunzipSync(Buffer.from(s, 'base64')));

/** A day inside the budget for the dekad the committed file carries. */
const DAY = 86_400_000;
const soonAfter = (days: number) => new Date(Date.parse(`${FILE.meta.dekad}T12:00:00Z`) + days * DAY);

const panelFor = (
  raw: unknown,
  lat: number,
  lon: number,
  now: Date = soonAfter(12),
  domain: unknown = DOMAIN,
): string =>
  renderComponent(DroughtPanel, { state: droughtState(raw, domain, now, decode), lat, lon });

/**
 * Coordinates whose answers we know, measured against the committed
 * files rather than chosen for how they read.
 *
 * 🔴 `MALTA` is here on purpose and it is the card's own correction. The
 * card asked for Malta to print "no data"; the EDO factsheet says class 0
 * is "Normal conditions (No drought)" and Malta carries a class in three
 * of the dekads we sampled, so it is inside the study domain. Printing
 * "no data" there would have been a false statement about a real place.
 */
const BRUSSELS: [number, number] = [50.85, 4.35];
const MALTA: [number, number] = [35.9, 14.4];
const ATLANTIC: [number, number] = [45, -15];

/**
 * A file whose meta says a reserved word in one string. `droughtState`
 * must refuse it, so the reader is shown "No drought reading" and never
 * the word. Everything else is left valid, so it is the word alone that
 * gets the file refused.
 */
const hostile = (field: string, value: string): CemsScenario => ({
  name: `a file whose ${field} says a reserved word`,
  html: panelFor({ ...FILE, meta: { ...FILE.meta, [field]: value } }, ...BRUSSELS),
  showsData: false,
});

const panel: CemsPanel = {
  source: 'EDO drought',

  // 🔴 What every data-bearing state has in common and no gap does: the
  // indicator naming itself beside the ten-day period it describes. The
  // headline cannot serve — "No drought here" and "No drought reading
  // here" differ by one word, and one of them is a gap.
  dataMarker: /Combined Drought Indicator \(CDI\)/,

  // We cut the grid to the EU-27 and sample it ourselves, so this is
  // modified data under the CEMS terms.
  notice: 'modified',

  scenarios: () => [
    {
      name: 'the files would not load or are not the shape we write',
      html: panelFor({ not: 'a drought file' }, ...BRUSSELS),
      showsData: false,
    },
    {
      name: 'the domain file is missing, so no reading can be trusted',
      html: panelFor(FILE, ...BRUSSELS, soonAfter(12), { not: 'a domain' }),
      showsData: false,
    },
    {
      name: 'the credit the CEMS terms require has been removed',
      html: panelFor({ ...FILE, meta: { ...FILE.meta, attribution: 'Copernicus' } }, ...BRUSSELS),
      showsData: false,
    },
    {
      name: 'two ten-day publications have been missed',
      html: panelFor(FILE, ...BRUSSELS, soonAfter(45)),
      showsData: false,
    },
    {
      name: 'a dekad dated in the future, which is not freshness',
      html: panelFor(FILE, ...BRUSSELS, new Date(Date.parse(`${FILE.meta.dekad}T12:00:00Z`) - 5 * DAY)),
      showsData: false,
    },
    {
      name: 'current, and the campsite is in a dry spell',
      html: panelFor(FILE, ...BRUSSELS),
      showsData: true,
    },
    {
      // 🔴 The good news, which is also a measurement. See MALTA above.
      name: 'current, and the indicator measured no drought at this campsite',
      html: panelFor(FILE, ...MALTA),
      showsData: true,
    },
    {
      name: 'current, but this location is outside the area the indicator covers',
      html: panelFor(FILE, ...ATLANTIC),
      showsData: true,
    },
    {
      name: 'a class value the file does not describe',
      html: panelFor({ ...FILE, meta: { ...FILE.meta, classes: [{ value: 99, label: 'x', detail: 'y' }] } }, ...BRUSSELS),
      showsData: true,
    },
    hostile('cadenceNote', 'A reading this old is a risk to plan around.'),
    hostile('indicator', 'Combined Drought Indicator (CDI) v4.1.1 — drought warning layer'),
    hostile('source', 'Copernicus EMS, European Drought Alert Observatory'),
  ],
};

export default panel;
