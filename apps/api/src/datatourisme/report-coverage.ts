// CAMP-101: what a DATAtourisme regional file actually contains.
//
//   npx ts-node src/datatourisme/report-coverage.ts <file.csv> [more.csv]
//   npx ts-node src/datatourisme/report-coverage.ts --fetch pac occ
//
// 🔴 Why this exists rather than a number in a card.
//
// The card records 496 campsites in PACA with 91% star coverage,
// measured on 21.09.2026. Two days later the real numbers were 478 and
// 91.0% — the file is rebuilt every night, so any figure written down
// is already slightly wrong. What has to be reproducible is the
// MEASUREMENT, not the number, and the card's own acceptance says so.
//
// It also refuses to report on a file it could not really parse, which
// is the failure this would otherwise have: a column rename upstream
// turns every row into a rejection, and a coverage report of "0
// campsites, 100% of fields present" is technically true and useless.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseRow, isCampsite, type DatatourismeRow } from './parse';

/** data.gouv.fr rebuilds these nightly, so the URL carries a timestamp. */
const DATASET_QUERY =
  'https://www.data.gouv.fr/api/1/datasets/?q=datatourisme&page_size=20';

/**
 * 🔴 There are TWO datasets matching "datatourisme" and only one has the
 * regional files. Picking the wrong one returns four national resources
 * and no campsites at all — which is exactly what happened on the first
 * attempt, and looked from the outside like the source having been
 * withdrawn.
 */
const DATASET_TITLE = 'plateforme nationale';

export async function resolveRegionUrls(
  regions: string[],
  fetchJson: (url: string) => Promise<unknown> = async (u) =>
    (await fetch(u)).json(),
): Promise<{ region: string; url: string; licence: string }[]> {
  const body = (await fetchJson(DATASET_QUERY)) as {
    data: {
      title: string;
      license: string;
      resources: { title: string; url: string }[];
    }[];
  };
  const dataset = body.data.find((d) =>
    d.title.toLowerCase().includes(DATASET_TITLE),
  );
  if (!dataset) throw new Error('the DATAtourisme regional dataset is gone');

  // 🔴 The licence is checked on every fetch, not trusted from a note.
  // `fr-lo` is Licence Ouverte; if data.gouv ever relabels this dataset
  // we must stop, not carry on reusing it commercially.
  if (dataset.license !== 'fr-lo') {
    throw new Error(
      `licence is "${dataset.license}", not "fr-lo" (Licence Ouverte) — stopping`,
    );
  }

  const out: { region: string; url: string; licence: string }[] = [];
  for (const region of regions) {
    const file = `datatourisme-reg-${region}.csv`;
    const resource = dataset.resources.find((r) => r.title === file);
    if (!resource) throw new Error(`no such regional file: ${file}`);
    out.push({ region, url: resource.url, licence: dataset.license });
  }
  return out;
}

/** A minimal CSV reader — the files are 40 MB and quoted multi-line. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

export type Coverage = {
  file: string;
  rows: number;
  campsiteRows: number;
  parsed: number;
  rejected: number;
  withStars: number;
  withDescription: number;
  withWebsite: number;
  oldestUpdate: string;
  newestUpdate: string;
};

export function summarise(file: string, spots: ReturnType<typeof parseRow>[], rows: number, campsiteRows: number): Coverage {
  const kept = spots.filter((s): s is NonNullable<typeof s> => s !== null);
  const dates = kept.map((s) => s.updatedAt).sort();
  return {
    file,
    rows,
    campsiteRows,
    parsed: kept.length,
    rejected: campsiteRows - kept.length,
    withStars: kept.filter((s) => s.stars !== null).length,
    withDescription: kept.filter((s) => s.description).length,
    withWebsite: kept.filter((s) => s.website).length,
    oldestUpdate: dates[0] ?? '—',
    newestUpdate: dates[dates.length - 1] ?? '—',
  };
}

/**
 * Is this report worth believing?
 *
 * 🔴 The failure it guards is a silent one: a renamed column upstream
 * makes every row unparseable, and the report then says "0 campsites"
 * with every percentage undefined. That reads like an empty region
 * rather than like a broken parser, so it is refused outright.
 */
export function verdict(c: Coverage): string[] {
  const problems: string[] = [];
  if (c.rows === 0) problems.push(`${c.file}: no rows at all — is this a CSV?`);
  if (c.campsiteRows === 0) {
    problems.push(
      `${c.file}: not one row matched the campsite categories — the source's columns have probably changed`,
    );
  } else if (c.parsed / c.campsiteRows < 0.9) {
    problems.push(
      `${c.file}: only ${c.parsed} of ${c.campsiteRows} campsite rows parsed — something in the format moved`,
    );
  }
  return problems;
}

async function readCsv(path: string): Promise<{ rows: DatatourismeRow[]; total: number }> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  let pending = '';
  const rows: DatatourismeRow[] = [];
  let total = 0;

  for await (const line of rl) {
    // A description can contain a newline inside quotes, so a line with
    // an odd number of quotes is only half a record.
    pending = pending ? `${pending}\n${line}` : line;
    const quotes = (pending.match(/"/g) ?? []).length;
    if (quotes % 2 !== 0) continue;

    const fields = splitCsvLine(pending);
    pending = '';
    if (!header) {
      header = fields.map((f) => f.trim());
      continue;
    }
    total++;
    const row: DatatourismeRow = {};
    header.forEach((h, i) => (row[h] = fields[i]));
    if (isCampsite(row)) rows.push(row);
  }
  return { rows, total };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') {
    let failures = 0;
    const check = (name: string, got: unknown, want: unknown) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) {
        console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
        failures++;
      } else console.log(`  ✓ ${name}`);
    };

    check('a plain line splits', splitCsvLine('a,b,c'), ['a', 'b', 'c']);
    check('a quoted comma stays inside its field', splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
    check('a doubled quote is one quote', splitCsvLine('a,"say ""hi""",b'), ['a', 'say "hi"', 'b']);
    check('an empty field survives', splitCsvLine('a,,b'), ['a', '', 'b']);

    const base: Coverage = {
      file: 'x', rows: 100, campsiteRows: 10, parsed: 10, rejected: 0,
      withStars: 9, withDescription: 10, withWebsite: 9,
      oldestUpdate: '2022-01-04', newestUpdate: '2026-09-23',
    };
    check('a healthy file passes', verdict(base), []);
    // 🔴 The silent failure this guard exists for.
    check(
      'a file where nothing matched is refused, not reported as empty',
      verdict({ ...base, campsiteRows: 0, parsed: 0 }).length,
      1,
    );
    check(
      'a file where most rows were rejected is refused',
      verdict({ ...base, parsed: 5 }).length,
      1,
    );
    check('an empty file is refused', verdict({ ...base, rows: 0, campsiteRows: 0, parsed: 0 }).length, 2);

    console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
    process.exit(failures ? 1 : 0);
  }

  if (args.length === 0) {
    console.error('usage: report-coverage.ts <file.csv> [more.csv…]');
    process.exit(1);
  }

  const problems: string[] = [];
  for (const path of args) {
    const { rows, total } = await readCsv(path);
    const spots = rows.map(parseRow);
    const c = summarise(path.split('/').pop() ?? path, spots, total, rows.length);
    const pct = (n: number) => (c.parsed ? `${((100 * n) / c.parsed).toFixed(1)}%` : '—');

    console.log(`\n${c.file}`);
    console.log(`  POI in file          ${c.rows}`);
    console.log(`  campsite rows        ${c.campsiteRows}`);
    console.log(`  parsed               ${c.parsed}   (rejected ${c.rejected})`);
    console.log(`  official stars       ${pct(c.withStars)}`);
    console.log(`  description          ${pct(c.withDescription)}`);
    console.log(`  website              ${pct(c.withWebsite)}`);
    console.log(`  last updated between ${c.oldestUpdate} and ${c.newestUpdate}`);
    problems.push(...verdict(c));
  }

  if (problems.length > 0) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log('\n✓ every file parsed');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
