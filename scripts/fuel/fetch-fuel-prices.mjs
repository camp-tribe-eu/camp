#!/usr/bin/env node
// CAMP-55: this week's road-fuel prices for all 27 EU countries.
//
//   node scripts/fuel/fetch-fuel-prices.mjs            # fetch and write
//   node scripts/fuel/fetch-fuel-prices.mjs --dry-run  # fetch, print, write nothing
//   node scripts/fuel/fetch-fuel-prices.mjs --self-test
//
// 🔴 WHY THIS EXISTS AT ALL.
//
// The budget calculator answers "what does a camper trip cost". Almost
// every page on the internet answering that question invents its numbers.
// We measured the alternative and it is better: the European Commission
// publishes consumer fuel prices for every EU country every Thursday, and
// that is the single largest, most volatile line in a camper budget.
//
// So the calculator's fuel figure is a fact with a date and a source, and
// the campsite figure — which we do NOT have — is asked of the reader
// instead of guessed. That asymmetry is the product.
//
// 🔴 THE LICENCE IS CHECKED, NOT REMEMBERED.
//
// European Commission content is CC BY 4.0 under Commission Decision
// 2011/833/EU, which permits commercial reuse with attribution. That is a
// fact about today. This script re-reads the Commission's own legal
// notice on every run and refuses to write anything if the words are not
// there — same rule as scripts/datatourisme/fetch-regions.mjs, for the
// same reason: a licence we merely remember is a licence we will one day
// be wrong about.
//
// 🔴 THE OUTPUT IS COMMITTED, AND THAT IS DELIBERATE.
//
// The build does not scrape the Commission. If it did, a change to their
// page would produce a site with no fuel prices and an exit code of 0 —
// precisely the silent-partial-build failure CAMP-69 was created to stop.
// Instead this script runs by hand (later: on a schedule), writes a JSON
// file, and a human sees the diff. The file carries the bulletin's own
// date, and every page that shows a price shows that date, so stale data
// reads as "prices from 21 September" rather than as a claim about today.

import { writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'apps', 'web', 'src', 'data', 'fuel-prices.json');

const BULLETIN_PAGE =
  'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en';
const LEGAL_NOTICE = 'https://commission.europa.eu/legal-notice_en';

/**
 * The words that must appear in the Commission's legal notice.
 *
 * Checked 24.09.2026 and on every run. Two strings, not one: the licence
 * itself, and the Decision that implements the reuse policy. A page that
 * still mentions one but has dropped the other has changed in a way
 * somebody should read before we publish anything derived from it.
 */
export const LICENCE_MARKERS = [
  'Creative Commons Attribution 4.0 International (CC BY 4.0)',
  'reuse of Commission documents',
];

/** How the attribution must read wherever a price is shown. */
export const ATTRIBUTION =
  'European Commission, Weekly Oil Bulletin — © European Union, licensed CC BY 4.0';

/**
 * The bulletin's country names, in its own spelling, to ISO 3166-1
 * alpha-2.
 *
 * 🔴 Written out rather than derived. The spreadsheet's first column is
 * free text maintained by somebody else; "Czechia" was "Czech Republic"
 * within living memory. An explicit table turns a rename into a loud
 * failure ("unknown country") instead of a country silently vanishing
 * from the calculator.
 */
export const COUNTRY_CODES = {
  Austria: 'AT',
  Belgium: 'BE',
  Bulgaria: 'BG',
  Croatia: 'HR',
  Cyprus: 'CY',
  Czechia: 'CZ',
  Denmark: 'DK',
  Estonia: 'EE',
  Finland: 'FI',
  France: 'FR',
  Germany: 'DE',
  Greece: 'GR',
  Hungary: 'HU',
  Ireland: 'IE',
  Italy: 'IT',
  Latvia: 'LV',
  Lithuania: 'LT',
  Luxembourg: 'LU',
  Malta: 'MT',
  Netherlands: 'NL',
  Poland: 'PL',
  Portugal: 'PT',
  Romania: 'RO',
  Slovakia: 'SK',
  Slovenia: 'SI',
  Spain: 'ES',
  Sweden: 'SE',
};

/** Every one of the 27 must be present, or the file is not written. */
export const EXPECTED_COUNTRIES = Object.keys(COUNTRY_CODES).length;

// ---------------------------------------------------------------------
// A very small xlsx reader.
//
// 🔴 Sixty lines instead of a dependency, on purpose. apps/web has four
// production dependencies and this script needs exactly two entries out
// of one zip. An xlsx is a zip of XML; node:zlib inflates the deflate
// streams, and the two files we want are plain enough to read with a
// regex. Adding a spreadsheet library to the tree — with its own
// transitive dependencies and its own supply-chain surface — to avoid
// this would be the worse trade for a public repository.
// ---------------------------------------------------------------------

/**
 * Entries of a zip archive, by name.
 *
 * Reads the END OF CENTRAL DIRECTORY record and walks the central
 * directory, rather than scanning for local headers: a local header may
 * declare sizes of zero and defer them to a data descriptor, which is
 * exactly what several writers do and which makes header-scanning
 * silently truncate.
 */
export function unzip(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`central directory entry ${i} has a bad signature`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    // The local header repeats the name and extra fields, and its extra
    // length often DIFFERS from the central one — reading the central
    // value here would land mid-stream.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);

    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Text of every <si> in sharedStrings.xml, in order. */
export function sharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
    out.push(decodeXml(s));
  }
  return out;
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/**
 * Cells of a worksheet as { 'A1': value }, strings already resolved.
 *
 * 🔴 The `\/>` alternative is not defensive padding — it is a bug this
 * function already had.
 *
 * A styled-but-empty cell is written `<c r="E3" s="3"/>`, and the first
 * version of this matched only `<c ...>...</c>`. On a self-closing cell
 * the opening pattern still matched, and the lazy body then ran forward
 * to the NEXT cell's closing tag and ate it. Austria's row ends with
 * three empty cells, so it swallowed Belgium's country name; the same
 * happened after Cyprus, Denmark, Finland, Greece, Ireland and Malta.
 *
 * Seven of twenty-seven countries vanished, and every price that
 * survived was correct — the shape of failure that gets shipped. It was
 * caught only because collect() refuses to write a file when any member
 * state is missing, which is the argument for that check existing.
 */
export function cells(xml, strings) {
  const out = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /r="([A-Z]+\d+)"/.exec(m[1])?.[1];
    if (!ref) continue;
    const body = m[2];
    if (body === undefined) continue; // self-closing: no value
    const type = /t="([^"]+)"/.exec(m[1])?.[1];
    if (type === 'inlineStr') {
      let s = '';
      for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
      out.set(ref, decodeXml(s));
      continue;
    }
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    if (v === undefined) continue;
    out.set(ref, type === 's' ? strings[Number(v)] : decodeXml(v));
  }
  return out;
}

/**
 * Excel's serial day number to an ISO date.
 *
 * 🔴 Epoch 1899-12-30, not 1900-01-01. Excel believes 1900 was a leap
 * year — a bug kept for compatibility with Lotus 1-2-3 — so serials from
 * 1 March 1900 onwards are one day ahead of the naive arithmetic. Using
 * 30 December 1899 as day zero cancels it exactly.
 */
export function excelDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) {
    throw new Error(`implausible Excel date serial: ${serial}`);
  }
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** EUR per 1000 litres (how the bulletin prints it) to EUR per litre. */
export function perLitre(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const litre = n / 1000;
  // Sanity floor and ceiling. Road fuel in the EU has not been below
  // €0.50 or above €4.00 a litre in the bulletin's recorded history; a
  // value outside that means the column moved, not that fuel got cheap.
  if (litre < 0.5 || litre > 4) {
    throw new Error(`fuel price out of plausible range: ${litre} EUR/l`);
  }
  return Math.round(litre * 1000) / 1000;
}

async function text(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/**
 * The newest "weekly prices with taxes" spreadsheet linked from the page.
 *
 * 🔴 Resolved every run, never hard-coded: the link carries a document
 * id AND the week in its filename, and both change. A URL written down
 * here would keep working for a week and then quietly return last
 * month's prices, which is worse than failing.
 */
export function findBulletinLink(html) {
  const found = [];
  for (const m of html.matchAll(/href="([^"]*\.xlsx[^"]*)"/gi)) {
    const href = decodeXml(m[1]);
    const name = decodeURIComponent(href);
    if (!/weekly\s+prices\s+with\s+taxes/i.test(name)) continue;
    const date = /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1];
    if (date) found.push({ href, date });
  }
  if (found.length === 0) {
    throw new Error(
      'no "weekly prices with taxes" spreadsheet found on the bulletin page — the page layout changed',
    );
  }
  found.sort((a, b) => b.date.localeCompare(a.date));
  return found[0];
}

export async function collect() {
  const notice = await text(LEGAL_NOTICE);
  for (const marker of LICENCE_MARKERS) {
    if (!notice.includes(marker)) {
      throw new Error(
        `REFUSING TO CONTINUE: the Commission legal notice no longer contains ${JSON.stringify(marker)}. ` +
          'Read it before publishing anything derived from this data.',
      );
    }
  }

  const page = await text(BULLETIN_PAGE);
  const link = findBulletinLink(page);
  const url = new URL(link.href, BULLETIN_PAGE).toString();

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const book = unzip(Buffer.from(await res.arrayBuffer()));

  const strings = sharedStrings(book.get('xl/sharedStrings.xml').toString('utf8'));
  const sheetName =
    [...book.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n)) ??
    [...book.keys()].find((n) => n.startsWith('xl/worksheets/sheet'));
  const grid = cells(book.get(sheetName).toString('utf8'), strings);

  // 🔴 Two independent dates, required to agree. The filename says one
  // week and cell A2 says another only if we have grabbed a file that
  // does not match its own link — the exact way a caching layer serves
  // last week's numbers under this week's name.
  const inSheet = excelDate(grid.get('A2'));
  if (inSheet !== link.date) {
    throw new Error(
      `the spreadsheet's own date (${inSheet}) disagrees with its filename (${link.date})`,
    );
  }

  const countries = {};
  let euAverage = null;

  for (let row = 3; row <= 60; row++) {
    const label = grid.get(`A${row}`);
    if (!label) continue;
    const petrol = perLitre(grid.get(`B${row}`));
    const diesel = perLitre(grid.get(`C${row}`));
    if (petrol === null && diesel === null) continue;

    if (/EUR27/.test(label)) {
      euAverage = { petrol, diesel };
      continue;
    }
    const code = COUNTRY_CODES[label.trim()];
    if (code) countries[code] = { name: label.trim(), petrol, diesel };
  }

  const missing = Object.entries(COUNTRY_CODES)
    .filter(([, code]) => !countries[code])
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`missing from the bulletin: ${missing.join(', ')}`);
  }
  if (!euAverage) throw new Error('no EU27 weighted average row found');

  return {
    bulletinDate: link.date,
    fetchedAt: new Date().toISOString().slice(0, 10),
    unit: 'EUR per litre, including taxes',
    source: BULLETIN_PAGE,
    sourceFile: url,
    licence: 'CC BY 4.0',
    attribution: ATTRIBUTION,
    euAverage,
    countries,
  };
}

// ---------------------------------------------------------------------
// Self-test: the parsing, on fixtures, with no network.
// ---------------------------------------------------------------------

function selfTest() {
  const checks = [];
  const ok = (name, cond, detail = '') =>
    checks.push({ name, pass: Boolean(cond), detail });

  ok('excelDate handles the 1900 leap bug', excelDate(46286) === '2026-09-21', excelDate(46286));
  ok('excelDate rejects nonsense', (() => {
    try {
      excelDate(3);
      return false;
    } catch {
      return true;
    }
  })());

  ok('perLitre converts per-1000l', perLitre('2457') === 2.457, String(perLitre('2457')));
  ok('perLitre rejects a moved column', (() => {
    try {
      perLitre('2457000');
      return false;
    } catch {
      return true;
    }
  })());
  ok('perLitre treats a blank as unknown, not zero', perLitre('') === null);

  const html = `
    <a href="/d/x_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202026-09-14.xlsx">old</a>
    <a href="/d/y_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202026-09-21.xlsx">new</a>
    <a href="/d/z_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20without%20taxes%20-%202026-09-21.xlsx">wrong series</a>`;
  const link = findBulletinLink(html);
  ok('findBulletinLink takes the newest week', link.date === '2026-09-21', link.date);
  ok('findBulletinLink ignores the without-taxes series', link.href.includes('/d/y_en'), link.href);
  ok('findBulletinLink fails loudly on a redesign', (() => {
    try {
      findBulletinLink('<a href="/nothing.pdf">x</a>');
      return false;
    } catch {
      return true;
    }
  })());

  ok('all 27 EU member states are mapped', EXPECTED_COUNTRIES === 27, String(EXPECTED_COUNTRIES));
  ok('no duplicate ISO codes', new Set(Object.values(COUNTRY_CODES)).size === 27);

  const strings = sharedStrings(
    '<sst><si><t>Austria</t></si><si><t>Czech&amp;ia</t></si></sst>',
  );
  ok('sharedStrings decodes entities', strings[1] === 'Czech&ia', strings[1]);

  const grid = cells(
    '<row><c r="A3" t="s"><v>0</v></c><c r="B3"><v>1925</v></c></row>',
    strings,
  );
  ok('cells resolve shared strings', grid.get('A3') === 'Austria', grid.get('A3'));
  ok('cells keep numbers as text', grid.get('B3') === '1925', grid.get('B3'));

  // 🔴 The regression that cost seven countries. Austria's real row ends
  // with three self-closing cells and Belgium's name is the very next
  // thing in the file; the first version of cells() ate it.
  const spanning = cells(
    '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="E3" s="3"/><c r="F3" s="3"/><c r="G3" s="3"/></row>' +
      '<row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4"><v>1987.62</v></c></row>',
    ['Austria', 'Belgium'],
  );
  ok('a self-closing cell does not swallow the next one', spanning.get('A4') === 'Belgium', String(spanning.get('A4')));
  ok('the row after empty cells keeps its values', spanning.get('B4') === '1987.62', String(spanning.get('B4')));
  ok('an empty cell is absent, not blank', spanning.get('E3') === undefined);

  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  const data = await collect();
  const names = Object.keys(data.countries).length;
  console.log(
    `bulletin ${data.bulletinDate}: ${names} countries, ` +
      `EU average petrol €${data.euAverage.petrol}/l, diesel €${data.euAverage.diesel}/l`,
  );
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    await writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`wrote ${OUT}`);
  }
}
