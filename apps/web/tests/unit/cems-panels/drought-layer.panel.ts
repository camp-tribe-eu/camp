import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { DroughtLayerPanel } from '@/components/drought-layer-panel';
import { droughtState, type DroughtLayerState } from '@/lib/drought';
import { renderComponent } from '../render-component';
import type { CemsPanel, CemsScenario } from '../cems-panel';

// CAMP-200 — the drought LAYER's panel under the map, declared as a CEMS
// panel.
//
// 🔴 This is the file `cems-panels.spec.ts` needs to see the `drought` layer
// at all: its entry in `LAYERS` carries `terms: 'cems'`, and a tagged live
// layer with no panel file fails "every live CEMS layer has a panel file".
// `drought.panel.ts` next to it is the campsite PAGE's panel — a different
// component with different words, and it names no layer.
//
// 🔴 Every scenario goes the way the browser goes: the payload the route
// serves (`{ meta, cdi, domain }`, built here the way the route builds it)
// → `droughtState` → the real component → HTML. `readDroughtPayload`, which
// the map calls, is `droughtState` plus a gunzip that only a browser needs,
// so the gates that refuse a payload sit INSIDE what is measured.
//
// 🔴 The corpus is the two files we SHIP, with only the clock moved — see
// `drought.panel.ts` for why the clock and not the dekad.

const DATA = join(__dirname, '..', '..', '..', 'src', 'data');
const FILE = JSON.parse(readFileSync(join(DATA, 'drought.json'), 'utf8')) as {
  meta: Record<string, unknown> & { dekad: string; classes: { value: number }[] };
  cdi: string;
};
const DOMAIN = JSON.parse(readFileSync(join(DATA, 'drought-domain.json'), 'utf8')) as {
  domain: string;
};

const decode = (s: string): Uint8Array => new Uint8Array(gunzipSync(Buffer.from(s, 'base64')));

const DAY = 86_400_000;
const soonAfter = (days: number) => new Date(Date.parse(`${FILE.meta.dekad}T12:00:00Z`) + days * DAY);

/** What `app/data/drought.json/route.ts` serves: the grid file with the mask beside it. */
const SERVED = { ...FILE, domain: DOMAIN.domain };

const html = (state: DroughtLayerState): string => renderComponent(DroughtLayerPanel, { state });

const panelFor = (payload: unknown, now: Date = soonAfter(12)): string =>
  html(droughtState(payload, payload, now, decode));

/**
 * A payload whose meta says a reserved word in one string. `droughtState`
 * must refuse it, so the reader is shown "No drought reading" and never the
 * word. Everything else is left valid, so it is the word alone that gets it
 * refused.
 */
const hostile = (field: string, value: string): CemsScenario => ({
  name: `a file whose ${field} says a reserved word`,
  html: panelFor({ ...SERVED, meta: { ...SERVED.meta, [field]: value } }),
  showsData: false,
});

const panel: CemsPanel = {
  source: 'EDO drought layer',
  layer: 'drought',

  // 🔴 What every data-bearing state has in common and no gap does: the
  // indicator naming itself beside the ten-day period it describes.
  dataMarker: /Combined Drought Indicator \(CDI\)/,

  // We cut the grid to the EU-27 and resample it ourselves: modified data.
  notice: 'modified',

  scenarios: () => [
    {
      name: 'still loading',
      html: html({ kind: 'loading' }),
      showsData: false,
    },
    {
      name: 'the payload is not the shape we write',
      html: panelFor({ not: 'a drought file' }),
      showsData: false,
    },
    {
      name: 'the mask is missing from the payload, so no reading can be trusted',
      html: panelFor({ meta: SERVED.meta, cdi: SERVED.cdi }),
      showsData: false,
    },
    {
      name: 'the credit the CEMS terms require has been removed',
      html: panelFor({ ...SERVED, meta: { ...SERVED.meta, attribution: 'Copernicus' } }),
      showsData: false,
    },
    {
      name: 'two ten-day publications have been missed',
      html: panelFor(SERVED, soonAfter(45)),
      showsData: false,
    },
    {
      name: 'a dekad dated in the future, which is not freshness',
      html: panelFor(SERVED, new Date(Date.parse(`${FILE.meta.dekad}T12:00:00Z`) - 5 * DAY)),
      showsData: false,
    },
    {
      name: 'current: the legend, the period and the credit',
      html: panelFor(SERVED),
      showsData: true,
    },
    {
      name: 'current, on the last day inside the budget',
      html: panelFor(SERVED, soonAfter(40)),
      showsData: true,
    },
    hostile('cadenceNote', 'A reading this old is a risk to plan around.'),
    hostile('indicator', 'Combined Drought Indicator (CDI) v4.1.1 — drought warning layer'),
    hostile('source', 'Copernicus EMS, European Drought Alert Observatory'),
    // 🔴 The legend prints the class names out of the file, so a class whose
    // name carries a reserved word is the string most likely to reach a
    // reader through this panel and not through the page's one.
    {
      name: 'a file whose class label says a reserved word',
      html: panelFor({
        ...SERVED,
        meta: {
          ...SERVED.meta,
          classes: (SERVED.meta.classes as { value: number; label: string; detail: string }[]).map(
            (c) => (c.value === 3 ? { ...c, label: 'vegetation at risk' } : c),
          ),
        },
      }),
      showsData: false,
    },
  ],
};

export default panel;
