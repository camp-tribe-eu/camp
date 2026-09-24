#!/usr/bin/env node
// CAMP-107: fetch the DATAtourisme regional files.
//
//   node scripts/datatourisme/fetch-regions.mjs --list
//   node scripts/datatourisme/fetch-regions.mjs ara bfc --out ~/camptribe-data
//   node scripts/datatourisme/fetch-regions.mjs --metropolitan --out ~/camptribe-data
//   node scripts/datatourisme/fetch-regions.mjs --self-test
//
// 🔴 The URLs are resolved from the data.gouv.fr API on every run, never
// hard-coded. DATAtourisme rebuilds these files daily and the download
// URL carries the build, so a URL written down here would rot within a
// day and the failure would look like "the region has no campsites"
// rather than "the link is stale".
//
// 🔴 The licence is CHECKED, not assumed.
//
// Everything we publish from this data rests on Licence Ouverte 2.0
// permitting commercial reuse. That is a fact about the dataset TODAY,
// and a publisher may change it. If the API ever reports a different
// licence this script refuses to download rather than quietly carrying
// on — the whole point of the "licence + quote + date" rule is that it
// is re-checked, not remembered.
//
// Files are written OUTSIDE the repository by default. They are tens of
// megabytes each and they are somebody else's data: they are an input,
// not source code.

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const API =
  'https://www.data.gouv.fr/api/1/datasets/?q=datatourisme&page_size=5';

/** The title that identifies the national dataset among the search hits. */
const DATASET_MARKER = 'plateforme nationale';

/**
 * The licence this whole pipeline depends on.
 *
 * data.gouv.fr's identifier for Licence Ouverte / Open Licence. Checked
 * against the API on 24.09.2026 and again on every run.
 */
export const REQUIRED_LICENCE = 'fr-lo';

/**
 * 🔴 Which regions we take, and — the part that matters — which we do
 * not, with the reason written down.
 *
 * A region missing from a list reads as forgetfulness six months later.
 * A region listed as deliberately skipped reads as a decision, and can
 * be reversed by someone who disagrees with the reason.
 *
 * The five skipped ones are France's outermost regions. They ARE in the
 * European Union — outermost regions (RUP) under TFEU Art. 349, not
 * overseas countries and territories — so "we serve the EU only" does
 * not exclude them on its own. They are excluded because this is a
 * platform for driving a camper around Europe, and no route is planned
 * from Antwerp to Réunion.
 */
export const METROPOLITAN = [
  'ara', // Auvergne-Rhône-Alpes
  'bfc', // Bourgogne-Franche-Comté
  'bre', // Bretagne
  'cor', // Corse
  'cvl', // Centre-Val de Loire
  'gde', // Grand Est
  'hdf', // Hauts-de-France
  'idf', // Île-de-France
  'naq', // Nouvelle-Aquitaine
  'nor', // Normandie
  'occ', // Occitanie
  'pac', // Provence-Alpes-Côte d'Azur
  'pdl', // Pays de la Loire
];

export const OVERSEAS = {
  glp: 'Guadeloupe — Caribbean',
  guf: 'Guyane — South America',
  mtq: 'Martinique — Caribbean',
  myt: 'Mayotte — Indian Ocean',
  reu: 'La Réunion — Indian Ocean',
};

/**
 * Pull the regional CSV resources out of a data.gouv.fr dataset payload.
 *
 * Pure, so the self-test can drive it without the network — including
 * the shapes that would otherwise only be discovered in production: a
 * resource with no title, a non-CSV export, a renamed dataset.
 */
export function regionsFrom(payload) {
  const dataset = (payload?.data ?? []).find((d) =>
    (d.title ?? '').includes(DATASET_MARKER),
  );
  if (!dataset) return { dataset: null, licence: null, regions: {} };

  const regions = {};
  for (const r of dataset.resources ?? []) {
    const m = /reg-([a-z]+)\.csv$/i.exec(r.title ?? '');
    if (!m) continue;
    regions[m[1].toLowerCase()] = {
      url: r.url,
      title: r.title,
      bytes: r.filesize ?? null,
    };
  }
  return { dataset: dataset.title, licence: dataset.license ?? null, regions };
}

async function fetchCatalogue() {
  const res = await fetch(API, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`data.gouv.fr answered ${res.status}`);
  return regionsFrom(await res.json());
}

function human(bytes) {
  return bytes == null ? '  ?' : `${(bytes / 1e6).toFixed(1)} MB`;
}

async function download(entry, dir) {
  const target = join(dir, `${entry.key}.csv`);
  // Re-downloading 280 MB because a later region failed is a waste of
  // somebody else's bandwidth as much as of our time.
  try {
    const existing = await stat(target);
    if (entry.bytes && existing.size === entry.bytes) {
      console.log(`  ${entry.key}  already here (${human(existing.size)})`);
      return target;
    }
  } catch {
    /* not downloaded yet */
  }

  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`${entry.key}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  const got = await stat(target);
  console.log(`  ${entry.key}  ${human(got.size)}`);
  return target;
}

function selfTest() {
  let bad = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) {
      console.log(`      expected ${JSON.stringify(want)}`);
      console.log(`      got      ${JSON.stringify(got)}`);
      bad++;
    }
  };

  const payload = {
    data: [
      { title: 'Something else entirely', resources: [] },
      {
        title: 'DATAtourisme : la plateforme nationale des données',
        license: 'fr-lo',
        resources: [
          { title: 'datatourisme-reg-ara.csv', url: 'u/ara', filesize: 44 },
          { title: 'datatourisme-reg-pac.csv', url: 'u/pac', filesize: 29 },
          // The shapes that must NOT be picked up:
          { title: 'datatourisme-reg-ara.json', url: 'u/json' },
          { title: 'documentation.pdf', url: 'u/doc' },
          { url: 'u/untitled' },
        ],
      },
    ],
  };

  const { licence, regions } = regionsFrom(payload);
  check('the national dataset is the one picked', licence, 'fr-lo');
  check('only CSV regional files are taken', Object.keys(regions).sort(), [
    'ara',
    'pac',
  ]);
  check('a resource with no title does not crash it', regions.ara.url, 'u/ara');

  // 🔴 The case that matters most: the dataset was renamed or the search
  // stopped returning it. Silently reporting "no regions" would look
  // exactly like "nothing to import".
  const renamed = regionsFrom({ data: [{ title: 'gone', resources: [] }] });
  check('a missing dataset is reported as missing', renamed.dataset, null);

  check('every metropolitan region is listed once', METROPOLITAN.length, 13);
  check(
    'metropolitan and overseas do not overlap',
    METROPOLITAN.filter((r) => r in OVERSEAS),
    [],
  );

  console.log(bad ? `\n✗ ${bad} self-test failure(s)` : '\n✓ self-test passed');
  process.exit(bad ? 1 : 0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const outAt = argv.indexOf('--out');
  const dir =
    outAt >= 0 ? argv[outAt + 1] : join(homedir(), 'camptribe-datatourisme');
  const wanted = argv.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (outAt >= 0 && i === outAt + 1) return false;
    return true;
  });

  const { dataset, licence, regions } = await fetchCatalogue();
  if (!dataset) {
    console.error(
      '✗ the national DATAtourisme dataset was not in the search results.\n' +
        '  It was renamed, moved, or the API changed. Do not guess a URL —\n' +
        '  find the dataset and update DATASET_MARKER.',
    );
    process.exit(1);
  }

  console.log(`dataset: ${dataset}`);
  console.log(`licence: ${licence}`);

  // 🔴 The refusal that gives the licence rule teeth.
  if (licence !== REQUIRED_LICENCE) {
    console.error(
      `\n✗ licence is "${licence}", expected "${REQUIRED_LICENCE}".\n` +
        '  Everything we publish from this data rests on Licence Ouverte\n' +
        '  permitting commercial reuse. Nothing is downloaded until a\n' +
        '  human has read the new licence and written down what it allows.',
    );
    process.exit(1);
  }

  if (argv.includes('--list')) {
    console.log(`\n${Object.keys(regions).length} regional files:\n`);
    for (const key of Object.keys(regions).sort()) {
      const tag = key in OVERSEAS ? `skipped — ${OVERSEAS[key]}` : '';
      console.log(`  ${key.padEnd(5)} ${human(regions[key].bytes)}  ${tag}`);
    }
    return;
  }

  const keys = argv.includes('--metropolitan') ? METROPOLITAN : wanted;
  if (keys.length === 0) {
    console.error('Nothing asked for. Pass region keys, --metropolitan or --list.');
    process.exit(1);
  }

  const unknown = keys.filter((k) => !(k in regions));
  if (unknown.length) {
    console.error(`✗ not published as a regional file: ${unknown.join(', ')}`);
    process.exit(1);
  }
  const skipped = keys.filter((k) => k in OVERSEAS);
  if (skipped.length) {
    console.error(
      `✗ ${skipped.join(', ')} are deliberately out of scope — see OVERSEAS.\n` +
        '  If that decision has changed, change it there rather than here.',
    );
    process.exit(1);
  }

  await mkdir(dir, { recursive: true });
  console.log(`\ninto ${dir}\n`);
  for (const key of keys) {
    await download({ key, ...regions[key] }, dir);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
