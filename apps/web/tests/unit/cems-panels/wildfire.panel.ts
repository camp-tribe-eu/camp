import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WildfirePanel } from '@/components/wildfire-panel';
import { wildfireState } from '@/lib/wildfires';
import { renderComponent } from '../render-component';
import { LICENCE_NOTICE_MODIFIED, type CemsPanel, type CemsScenario } from '../cems-panel';

// CAMP-162 — the EFFIS wildfire layer (CAMP-153), declared as a CEMS panel.
//
// THIS FILE IS THE TEMPLATE for the next one. `cems-panels.spec.ts` says
// how to add a source; the short version is that a new source copies this
// file, swaps the component and the state function, and changes nothing
// else.
//
// 🔴 Every scenario goes RAW FEED → the reader the browser uses
// (`wildfireState`) → the real component → HTML. The page does the same
// three steps (fetch, `wildfireState(body, new Date())`, render), so the
// gate that refuses a feed sits inside what is measured: a mutation that
// removes it changes the HTML, and the spec sees the HTML.
//
// 🔴 The corpus is the file we SHIP, with only `fetchedAt` moved — the
// same rule `wildfire-layer.spec.ts` follows. The content is the real
// EFFIS credit, licence line and authority note; the clock is the test's,
// because the page stops drawing a feed 72 hours after it was read and a
// test that asserted "fresh" against the file as committed would go red
// on Thursday for no reason but the calendar.

const FEED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'src', 'data', 'wildfires.json'), 'utf8'),
) as { meta: Record<string, string>; features: unknown[] };

const NOW = new Date('2026-09-28T18:00:00Z');
const HOUR = 3_600_000;
const readAt = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

const feed = (hoursAgo: number, meta: Record<string, string> = {}, features = FEED.features) => ({
  ...FEED,
  meta: { ...FEED.meta, fetchedAt: readAt(hoursAgo), ...meta },
  features,
});

/** The panel as the page renders it, for a raw feed body. */
const panelFor = (raw: unknown, inView: number | null = null, on = true): string =>
  renderComponent(WildfirePanel, { state: wildfireState(raw, NOW), on, inView });

/**
 * A feed that says a reserved word in ONE of the four strings the panel
 * prints. `readFeed` must refuse it, so the reader is shown "no fresh
 * data" and not the word. The credit is kept valid in every variant but
 * the one being corrupted, so it is the word alone that gets it refused.
 */
const hostile = (field: string, value: string): CemsScenario => ({
  name: `a feed whose ${field} says a reserved word`,
  html: panelFor(feed(1, { [field]: value })),
  showsData: false,
});

const panel: CemsPanel = {
  source: 'EFFIS wildfire',
  layer: 'wildfire',

  // What the three data-bearing headlines have in common: "Copernicus
  // EFFIS recorded N burnt areas across the EU-27 …", "None of the N burnt
  // areas Copernicus EFFIS recorded across the EU-27 …" and "Copernicus
  // EFFIS recorded no burnt areas across the EU-27 …".
  dataMarker: /Copernicus EFFIS recorded[^.]*EU-27|areas Copernicus EFFIS recorded across the EU-27/,

  credits: [LICENCE_NOTICE_MODIFIED, /CC BY 4\.0/],

  scenarios: () => [
    {
      name: 'loading',
      html: renderComponent(WildfirePanel, { state: { kind: 'loading' }, on: true, inView: null }),
      showsData: false,
    },
    {
      name: 'switched off by the reader',
      html: panelFor(feed(1), null, false),
      showsData: false,
    },
    {
      name: 'the file would not load or is not the shape we wrote',
      html: panelFor({ not: 'a feed' }),
      showsData: false,
    },
    {
      name: 'last read four days ago, past the 72-hour budget',
      html: panelFor(feed(96)),
      showsData: false,
    },
    {
      name: 'fresh, the map has not said what is in view yet',
      html: panelFor(feed(1), null),
      showsData: true,
    },
    {
      name: 'fresh, three burnt areas in view',
      html: panelFor(feed(1), 3),
      showsData: true,
    },
    {
      name: 'fresh, none in view',
      html: panelFor(feed(1), 0),
      showsData: true,
    },
    {
      name: 'fresh, and the file records no burnt areas at all',
      html: panelFor(feed(1, {}, []), 0),
      showsData: true,
    },
    // The four strings the panel prints out of the feed. Each carries a
    // different word, so one regex alternative going missing shows up as
    // one scenario, not four.
    hostile('source', 'Copernicus fire danger service'),
    hostile('licence', 'CC BY 4.0, alert terms apply'),
    hostile('attribution', `${FEED.meta.attribution} — extreme fire risk`),
    hostile('authorityNote', 'Official fire warning issued by the regional service'),
  ],
};

export default panel;
