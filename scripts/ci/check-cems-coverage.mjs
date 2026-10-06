#!/usr/bin/env node
// 🔴 Anything that SHOWS CEMS data must be inside the language guard.
//
// CAMP-174, which is the boundary of CAMP-162 said out loud. The CEMS
// terms state that their data "does not constitute in any way an early
// warning", so the words warning / danger / risk / alert / evacuate may
// not be printed beside it. `cems-panels.spec.ts` enforces exactly that —
// on the panels it can find.
//
// It finds them through hand-written descriptors in
// tests/unit/cems-panels/*.panel.ts. Review showed what that misses by
// BUILDING it: a `drought-panel.tsx` and a `/drought` page reading
// Copernicus EDO and printing "severe drought risk… Danger levels",
// nothing else changed, 653 of 653 tests green. 33 components and 20
// route pages sit outside the guard the same way.
//
// So this does not ask whether somebody REGISTERED a panel. It asks
// where the file gets its data: any component or page that reaches
// `@/lib/cems` or `@/lib/wildfires` through its imports is showing CEMS
// data, whatever it is called and whoever forgot to write it down. If it
// is not covered by a descriptor, this fails and says which file.
//
// 🔴 What it is NOT. It does not read the words — that is
// `cems-panels.spec.ts`'s job and it does it on rendered HTML, which is
// the right place. This only closes the hole in FINDING the subjects.
// The two together are the guard; either alone is half of one.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'apps', 'web');

/** The modules that mean "this is CEMS data". */
export const CEMS_MODULES = ['@/lib/cems', '@/lib/wildfires', '@/data/wildfires.json'];

/**
 * 🔴 AND THE DATA URL, because the import graph alone does not see the
 * house pattern.
 *
 * `campsite-map.tsx:1291` reads CEMS through `void fetch(WILDFIRE_URL)`,
 * and `WILDFIRE_URL` is just the string '/data/wildfires.json'. A new
 * component that only fetches that URL imports neither CEMS module, so
 * the graph calls it innocent — review built exactly that and this guard
 * printed its ✓. A file that names the URL is showing the data as surely
 * as one that imports the reader.
 */
export const CEMS_DATA_MARKERS = [/\/data\/wildfires\.json/, /\bWILDFIRE_URL\b/];

/**
 * Files that reach CEMS data and are covered by the OTHER arm of the
 * guard — the map-layer registry, which `cems-panels.spec.ts` reads
 * through `LAYERS` and renders through `LayerChip`.
 *
 * 🔴 A LIST WITH REASONS, not a silence. Each line here is a file this
 * scan would otherwise name, together with why it is already watched.
 * An exception nobody can read is the same thing as a missing check —
 * which is the defect this whole file exists to repair — so adding to
 * this list is a decision somebody writes down, not a flag they pass.
 */
export const COVERED_ELSEWHERE = new Map([
  [
    'components/campsite-map.tsx',
    'draws the registered layers; their words are checked through LAYERS + LayerChip',
  ],
  ['components/map-embed.tsx', 'wraps campsite-map, renders no CEMS prose of its own'],
  ['app/map/page.tsx', 'mounts map-embed, renders no CEMS prose of its own'],
  [
    'app/data/wildfires.json/route.ts',
    'serves the feed as JSON and renders no text at all; its words are the source’s own, checked where they are displayed',
  ],
  // 🔴 CAMP-163. The campsite page reaches CEMS data only by mounting
  // <DroughtPanel>, and every word that panel can print is driven
  // through the real component by tests/unit/cems-panels/drought.panel.ts
  // — twelve states, including the ones where a hostile file tries to
  // put a reserved word on the page.
  //
  // The page's own prose beside it is not unchecked either: the setting
  // paragraph is generated, so tests/unit/setting.spec.ts drives every
  // shape it can produce through RESERVED_WORDS rather than trusting
  // that nobody will write one.
  //
  // ⚠️ This entry is the dangerous kind and the file says so two screens
  // up: an exemption is how coverage disappears quietly. It is honest
  // only while the page renders no CEMS text of its own. The moment it
  // prints a drought word outside the panel, this line becomes a lie and
  // nothing here will notice — so that is a thing to check when editing
  // the page, not a thing to assume.
  [
    'app/camping/[country]/[region]/[slug]/page.tsx',
    'mounts <DroughtPanel>, whose every state is checked by cems-panels/drought.panel.ts; its own generated prose is checked by setting.spec.ts',
  ],
]);

/** Every file under a directory, recursively. */
export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every specifier a file imports, however the import is written.
 *
 * 🔴 RELATIVE ONES TOO. The first version took only `@/…`, and the tree
 * holds 175 relative imports under components/ and app/ —
 * `campsite-map.tsx:40` is one of them. A panel written
 * `import { CEMS_NOTICE } from '../lib/cems'` was invisible, which is
 * the same hole the whole file exists to close, one level down.
 */
export function importsOf(source) {
  const out = new Set();
  const re = /(?:from|import)\s*\(?\s*['"]((?:@\/|\.{1,2}\/)[^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

/**
 * Does `start` reach any of `targets` through `@/…` imports?
 *
 * 🔴 TRANSITIVELY, and that is the point. A panel that imports a helper
 * that imports `@/lib/cems` is showing CEMS data just as surely as one
 * that imports it directly, and a one-hop check would wave it through.
 */
export function reaches(start, targets, resolveSpec, read, seen = new Set()) {
  if (seen.has(start)) return false;
  seen.add(start);
  const src = read(start);
  if (src === null) return false;
  // 🔴 A file that merely NAMES the data URL is showing CEMS data, even
  // with no import at all. See CEMS_DATA_MARKERS.
  if (CEMS_DATA_MARKERS.some((re) => re.test(src))) return true;
  for (const spec of importsOf(src)) {
    // `from` matters: '../lib/cems' means something different in each
    // directory, and resolving it without the importer is guesswork.
    const next = resolveSpec(spec, start);
    // 🔴 Compare the RESOLVED path, not the specifier. Matching the raw
    // text meant `'@/lib/cems'` counted and `'../lib/cems'` did not —
    // the same file, named two ways, and only one of them watched.
    if (targets.includes(spec) || (next && targets.includes(next))) return true;
    if (next && reaches(next, targets, resolveSpec, read, seen)) return true;
  }
  return false;
}

/** Components named by a `.panel.ts` descriptor — the covered set. */
export function coveredComponents(descriptorSources) {
  const out = new Set();
  for (const src of descriptorSources) {
    for (const spec of importsOf(src)) {
      if (spec.startsWith('@/components/')) out.add(spec);
    }
  }
  return out;
}

export function realRun(web = WEB, log = console, exempt = COVERED_ELSEWHERE) {
  const src = join(web, 'src');
  const read = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  const resolveSpec = (spec, from) => {
    const base = spec.startsWith('@/')
      ? join(src, spec.slice(2))
      : resolve(dirname(from), spec);
    for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        /* not this one */
      }
    }
    return null;
  };

  const descDir = join(web, 'tests', 'unit', 'cems-panels');
  const covered = coveredComponents(
    readdirSync(descDir)
      .filter((f) => f.endsWith('.panel.ts'))
      .map((f) => readFileSync(join(descDir, f), 'utf8')),
  );

  // The CEMS modules as absolute paths, so a relative import of the same
  // file is the same target.
  const targets = [
    ...CEMS_MODULES,
    ...CEMS_MODULES.map((m) => resolveSpec(m, join(src, 'x.ts'))).filter(Boolean),
  ];

  const offenders = [];
  for (const file of walk(src)) {
    const rel = relative(src, file);
    // Only what a reader can see: components and route pages. The lib
    // files themselves are the data, not a rendering of it.
    if (!/^components\//.test(rel) && !/^app\//.test(rel)) continue;
    if (!reaches(file, targets, resolveSpec, read)) continue;
    const spec = `@/${rel.replace(/\.tsx?$/, '')}`;
    if (covered.has(spec) || exempt.has(rel)) continue;
    offenders.push(rel);
  }

  if (offenders.length > 0) {
    log.error('✗ These show CEMS data and nothing checks the words on them:\n');
    for (const f of offenders) log.error(`  apps/web/src/${f}`);
    log.error(
      '\n  The CEMS terms say their data "does not constitute in any way an\n' +
        '  early warning", so warning / danger / risk / alert / evacuate may\n' +
        '  not appear beside it. That rule is enforced by\n' +
        '  apps/web/tests/unit/cems-panels.spec.ts, which finds its subjects\n' +
        '  through descriptors in tests/unit/cems-panels/*.panel.ts.\n' +
        '  wildfire.panel.ts is the template; a new one swaps the component\n' +
        '  and the state function and changes nothing else.',
    );
    return 1;
  }

  log.log(
    `✓ every component and page reaching ${CEMS_MODULES.join(' or ')} has a CEMS descriptor`,
  );
  return 0;
}

// Prove the check can fail. Nothing here reads the real tree.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };

  // A tiny in-memory tree, shaped like the real one.
  const files = {
    '/src/lib/cems.ts': 'export const CEMS_NOTICE = "…";',
    '/src/lib/drought-data.ts': "import { CEMS_NOTICE } from '@/lib/cems';",
    // Review's experiment, exactly: a panel and a page, reaching CEMS
    // through a helper, registered nowhere.
    '/src/components/drought-panel.tsx':
      "import { x } from '@/lib/drought-data';\nexport const DroughtPanel = () => null;",
    '/src/app/drought/page.tsx':
      "import { DroughtPanel } from '@/components/drought-panel';\nexport default () => null;",
    // And an innocent neighbour that must NOT be flagged.
    '/src/components/footer.tsx': "import { z } from '@/lib/sources';\n",
    '/src/lib/sources.ts': 'export const z = 1;',
  };
  const read = (p) => files[p] ?? null;
  const resolveSpec = (spec) => {
    for (const c of [`/src/${spec.slice(2)}.ts`, `/src/${spec.slice(2)}.tsx`]) {
      if (files[c] !== undefined) return c;
    }
    return null;
  };

  const reach = (p) => reaches(p, CEMS_MODULES, resolveSpec, read);

  if (!reach('/src/components/drought-panel.tsx')) {
    bad('a panel reaching CEMS through a helper was not seen');
  }
  if (!reach('/src/app/drought/page.tsx')) {
    bad('a page reaching CEMS two hops away was not seen');
  }
  if (reach('/src/components/footer.tsx')) {
    bad('an unrelated component was reported as showing CEMS data');
  }

  // 🔴 A cycle must not hang the walk. Two files importing each other is
  // ordinary in a component tree, and a walker without `seen` spins.
  const cyc = {
    '/a.ts': "import '@/b';",
    '/b.ts': "import '@/a';",
  };
  const cycRead = (p) => cyc[p] ?? null;
  const cycResolve = (s) => (cyc[`/${s.slice(2)}.ts`] !== undefined ? `/${s.slice(2)}.ts` : null);
  if (reaches('/a.ts', CEMS_MODULES, cycResolve, cycRead)) {
    bad('a cycle reported a reach that is not there');
  }

  // The covered set is read from what the descriptor imports.
  const cov = coveredComponents([
    "import { WildfirePanel } from '@/components/wildfire-panel';\n" +
      "import { wildfireState } from '@/lib/wildfires';",
  ]);
  if (!cov.has('@/components/wildfire-panel')) bad('the descriptor’s component was not read');
  if (cov.has('@/lib/wildfires')) bad('a lib was mistaken for a covered component');

  // Import styles the regex must all see.
  const seen = importsOf(
    `import a from '@/one';\nconst b = await import("@/two");\nexport * from '@/three';`,
  );
  for (const want of ['@/one', '@/two', '@/three']) {
    if (!seen.includes(want)) bad(`the import form giving ${want} was missed`);
  }

  // 🔴 AND THE WHOLE THING, on a tree we build. Everything above tests
  // helpers; review showed what that leaves loose — deleting the scope
  // filter, or the `app/` half of it, left BOTH the rehearsal and the
  // real run green, so the page arm of this guard could be removed
  // entirely and CI would not notice. A rehearsal that stops at the
  // helpers is a rehearsal of the parts nobody ships.
  {
    const root = mkdtempSync(join(tmpdir(), 'cems-cov-'));
    const put = (rel, body) => {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };
    put('src/lib/cems.ts', 'export const CEMS_NOTICE = "…";');
    put('src/components/wildfire-panel.tsx', "import '@/lib/cems';\nexport const P = () => null;");
    put(
      'tests/unit/cems-panels/wildfire.panel.ts',
      "import { P } from '@/components/wildfire-panel';\nexport default {};",
    );
    const quiet = { log: () => {}, error: () => {} };

    // A helper OUTSIDE components/ and app/ that reaches CEMS. It is
    // not a rendering, so it must not be reported — and without the
    // scope filter it would be.
    put('src/lib/drought-helper.ts', "import '@/lib/cems';\nexport const h = 1;");
    // One file named in the exemption list, so removing that branch shows.
    put('src/components/exempt-panel.tsx', "import '@/lib/cems';\nexport const E = () => null;");
    const exempt = new Map([['components/exempt-panel.tsx', 'covered by the layer registry']]);

    if (realRun(root, quiet, exempt) !== 0) {
      bad('a fully described tree was reported as an offender');
    }

    // 🔴 The two shapes the import graph alone cannot see, each in the
    // tree so the rule that catches it has something to catch.
    put('src/components/fetch-only.tsx', "export const F = () => fetch('/data/wildfires.json');");
    if (realRun(root, quiet, exempt) !== 1) bad('a fetch-only component was not reported');
    rmSync(join(root, 'src/components/fetch-only.tsx'), { force: true });

    put('src/components/rel-import.tsx', "import '../lib/cems';\nexport const R = () => null;");
    if (realRun(root, quiet, exempt) !== 1) bad('a relative import was not reported');
    rmSync(join(root, 'src/components/rel-import.tsx'), { force: true });

    // A page, registered nowhere.
    put('src/app/drought/page.tsx', "import '@/lib/cems';\nexport default () => null;");
    if (realRun(root, quiet, exempt) !== 1) bad('an undescribed PAGE was not reported');

    // And a component, so neither arm can be deleted unnoticed.
    rmSync(join(root, 'src/app/drought'), { recursive: true, force: true });
    put('src/components/drought-panel.tsx', "import '@/lib/cems';\nexport const D = () => null;");
    if (realRun(root, quiet, exempt) !== 1) bad('an undescribed COMPONENT was not reported');

    rmSync(root, { recursive: true, force: true });
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: a panel and a page reaching CEMS through a helper are\n' +
        '  both found, an unrelated component is not, a cycle does not hang,\n' +
        '  and the covered set is read from the descriptor.',
    );
  }
  return rc;
}

// 🔴 `realpathSync`, because `import.meta.url` is already resolved and
// `process.argv[1]` is not. Run through a symlink the two never match,
// the script decides it was imported, and exits 0 having printed nothing
// and checked nothing — a guard that passes by not running.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  process.exit(realRun());
}

export { resolve };
