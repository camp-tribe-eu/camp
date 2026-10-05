#!/usr/bin/env node
//
// Where the map's fonts and sprites actually come from.
//
//   node scripts/ci/check-map-assets.mjs [--self-test]
//
// 🔴 A STYLE FILE CAN PUT US IN BREACH OF SOMEONE ELSE'S TERMS WITHOUT A
// LINE OF OUR CODE CHANGING.
//
// Fonts and sprites are NOT inside a PMTiles archive. A style names them
// by URL, and the obvious ones point at hosts whose terms we do not
// meet. Measured 2026-10-05: the Protomaps basemap assets answer from
// `protomaps.github.io` with `Server: GitHub.com` — GitHub Pages, whose
// terms forbid use for "an online business, e-commerce site". That is
// us. Nothing in the app would break; we would simply be in breach, and
// the first anyone heard of it would be a takedown.
//
// We are NOT in that state today: all three styles we ship resolve their
// glyphs and sprites to `tiles.openfreemap.org`, the same host that
// serves the tiles. The trap arms itself the day we adopt a style of our
// own (CAMP-29), which is exactly the day nobody will be looking at
// this.
//
// So the check is here now, before the change that needs it.

const ALLOWED = [
  // The tile provider we use today; it serves its own fonts and sprites.
  'tiles.openfreemap.org',
];

/** Hosts we must never serve assets from, with the reason. */
const FORBIDDEN = {
  'protomaps.github.io': 'GitHub Pages terms forbid "an online business, e-commerce site"',
  'github.io': 'GitHub Pages terms forbid "an online business, e-commerce site"',
  'raw.githubusercontent.com': 'raw.githubusercontent.com is not a CDN and GitHub asks that it not be used as one',
};

/** The asset URLs a MapLibre style declares. */
export function assetUrlsOf(style) {
  const out = [];
  if (typeof style?.glyphs === 'string') out.push({ what: 'glyphs', url: style.glyphs });
  const sprite = style?.sprite;
  if (typeof sprite === 'string') out.push({ what: 'sprite', url: sprite });
  // A style may list several sprite sheets, each `{ id, url }`.
  else if (Array.isArray(sprite)) {
    for (const s of sprite) if (typeof s?.url === 'string') out.push({ what: 'sprite', url: s.url });
  }
  return out;
}

/** The host of an asset template, with MapLibre's placeholders removed. */
export function hostOf(template) {
  const cleaned = String(template).replace(/\{[^}]*\}/g, 'x');
  try {
    return new URL(cleaned).host;
  } catch {
    // A relative URL is served by us, which is the point of the card.
    return null;
  }
}

/**
 * Is `host` the same host as `base`, or a subdomain of it?
 *
 * 🔴 THIS WAS `host.endsWith('.' + base)` AND CODEQL WAS RIGHT TO FAIL
 * IT (`js/incomplete-url-substring-sanitization`, high). Comparing hosts
 * by substring is how allowlist bypasses get written: the leading dot
 * makes the naive form correct only by accident of spelling, and one
 * edit away from `endsWith(base)`, where `nottiles.openfreemap.org`
 * would sail through. In a function whose whole job is deciding what we
 * are allowed to load, "correct by accident" is not good enough.
 *
 * Labels are compared as labels. No substring operation is left.
 */
export function isHostOrSubdomain(host, base) {
  if (typeof host !== 'string' || typeof base !== 'string') return false;
  if (host === base) return true;
  const a = host.split('.');
  const b = base.split('.');
  // ⚠️ PROVABLY REDUNDANT, AND A MUTATION PROVED IT: deleting this line
  // keeps every assertion green. A join of `k` labels carries `k - 1`
  // dots, so a suffix shorter than `base` can never equal it, and
  // `slice` with a negative start simply takes from the end. It stays
  // because the next reader will change the slice, not re-derive the
  // dot-counting argument — and because the cost of the line is nothing
  // against an allowlist bypass.
  if (a.length <= b.length) return false;
  return a.slice(a.length - b.length).join('.') === base;
}

/** Why this asset is not acceptable, or null when it is. */
export function verdict(host, { allowed = ALLOWED, forbidden = FORBIDDEN } = {}) {
  if (host === null) return null;
  const hit = Object.keys(forbidden).find((h) => isHostOrSubdomain(host, h));
  if (hit) return forbidden[hit];
  if (allowed.some((h) => isHostOrSubdomain(host, h))) return null;
  // 🔴 Unknown is NOT acceptable. An allowlist that quietly passes what
  // it has not seen is a list of examples, not a rule — and the whole
  // failure this guards against is an asset host nobody looked at.
  return 'not on the list of hosts we have checked the terms of';
}

export function problemsIn(style, label) {
  return assetUrlsOf(style)
    .map((a) => ({ ...a, host: hostOf(a.url), why: verdict(hostOf(a.url)) }))
    .filter((a) => a.why)
    .map((a) => `${label}: ${a.what} load from ${a.host} — ${a.why}`);
}

// --------------------------------------------------------------- self-test

function selfTest() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      bad += 1;
      console.log(`x    ${name}${detail ? `  ${detail}` : ''}`);
    }
  };

  ok('a glyphs template gives up its host',
    hostOf('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf') === 'tiles.openfreemap.org');
  ok('…placeholders do not break the parse',
    hostOf('https://x.example/{a}/{b}/{c}.pbf') === 'x.example');
  ok('…and a relative url is ours, so it has no host', hostOf('/fonts/{range}.pbf') === null);

  ok('a host is itself', isHostOrSubdomain('a.example', 'a.example'));
  ok('…a subdomain belongs to it', isHostOrSubdomain('x.a.example', 'a.example'));
  ok('…a deep subdomain too', isHostOrSubdomain('x.y.a.example', 'a.example'));
  // 🔴 The bypass a substring check invites.
  ok('…but a host that merely ENDS with the name does not',
    !isHostOrSubdomain('nota.example', 'a.example'));
  ok('…nor one that only contains it', !isHostOrSubdomain('a.example.evil.test', 'a.example'));
  ok('…nor a shorter host', !isHostOrSubdomain('example', 'a.example'));
  // 🔴 A mutation removed the type guard and stayed green: nothing fed
  // this anything but a string, so the guard guarded nothing provable.
  ok('…a missing host is not a match', !isHostOrSubdomain(null, 'a.example'));
  ok('…a missing base is not a match', !isHostOrSubdomain('a.example', null));
  ok('…and neither is an object pretending to be a host',
    !isHostOrSubdomain({ toString: () => 'a.example' }, 'a.example'));

  ok('the host we use today passes', verdict('tiles.openfreemap.org') === null);
  ok('…a subdomain of it passes too', verdict('eu.tiles.openfreemap.org') === null);
  ok('GitHub Pages is refused, with the reason',
    /online business/.test(verdict('protomaps.github.io') ?? ''));
  // 🔴 Not merely refused — refused for the RIGHT reason. An unknown
  // host is also refused, so `!== null` cannot tell the two apart, and a
  // mutation that dropped subdomain matching survived on exactly that.
  ok('…any other github.io is refused for the terms, not as an unknown',
    /online business/.test(verdict('someone.github.io') ?? ''), verdict('someone.github.io') ?? 'null');
  ok('…and a deep subdomain too',
    /online business/.test(verdict('a.b.github.io') ?? ''));
  ok('…raw.githubusercontent is refused', verdict('raw.githubusercontent.com') !== null);
  ok('a host nobody has checked is refused, not waved through',
    /not on the list/.test(verdict('cdn.unknown.example') ?? ''));
  ok('…and our own relative assets are fine', verdict(null) === null);

  {
    const good = {
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    };
    ok('a style on an allowed host has no problems', problemsIn(good, 'ok').length === 0);
    const trap = {
      glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    };
    const found = problemsIn(trap, 'protomaps');
    ok('…the Protomaps default trips on BOTH fonts and sprites', found.length === 2, JSON.stringify(found));
    ok('…and says which is which', found.some((p) => /glyphs/.test(p)) && found.some((p) => /sprite/.test(p)));
    ok('a style listing several sprite sheets is checked on every one',
      problemsIn({ sprite: [{ id: 'a', url: 'https://x.github.io/a' }, { id: 'b', url: 'https://y.github.io/b' }] }, 's').length === 2);
    ok('a style with no assets at all has no problems', problemsIn({}, 'empty').length === 0);
  }

  {
    const tpl = "const OFM = 'https://tiles.openfreemap.org';\n  style: `${OFM}/styles/liberty`,";
    const built = urlsIn(tpl);
    ok('a template style url is reassembled from its base',
      built.includes('https://tiles.openfreemap.org/styles/liberty'), JSON.stringify(built));
    ok('…and the base itself is still listed',
      built.includes('https://tiles.openfreemap.org'));
  }

  {
    const src = "const OFM = 'https://tiles.openfreemap.org';\n  style: `${OFM}/styles/liberty`,\n  other: \"https://x.github.io/a\"";
    const found = urlsIn(src);
    ok('urls are read out of the source text',
      found.includes('https://tiles.openfreemap.org') && found.includes('https://x.github.io/a'),
      JSON.stringify(found));
    ok('…a quote does not come along for the ride', found.every((u) => !/['"`]/.test(u)), JSON.stringify(found));
    ok('…and a file with no url at all is a failure, not a pass', urlsIn('nothing here').length === 0);
  }

  console.log(bad ? `\nx ${bad} self-test failure(s)` : '\nself-test passed');
  return bad > 0;
}

// ------------------------------------------------------------------- entry

/**
 * Every absolute URL the app's style list names.
 *
 * 🔴 READ FROM THE REAL FILE, NOT COPIED. The first version of this
 * carried its own list of three style URLs as a fallback, which is a
 * guard that stops seeing the thing it guards the moment someone adds a
 * fourth source. The file is TypeScript and cannot be imported here, so
 * its URL literals are read out of the text — crude, and tied to the
 * one place that decides what we ship.
 */
export function urlsIn(source) {
  const text = String(source);
  const bases = [...new Set(text.match(/https?:\/\/[^'"`\s)]+/g) ?? [])];
  // 🔴 THE STYLE URLS ARE TEMPLATE LITERALS. The first version matched
  // only absolute URLs, found the one `OFM` constant, fetched no style
  // at all, and announced that every font and sprite was fine. It had
  // checked nothing. `${OFM}/styles/liberty` has to be reassembled.
  const suffixes = [...new Set(text.match(/\$\{[A-Za-z_][A-Za-z0-9_]*\}(\/[^'"`\s)]*)/g) ?? [])]
    .map((m) => m.slice(m.indexOf('}') + 1));
  // Every base crossed with every suffix, which over-produces: a
  // combination that was never written will simply fail to fetch and be
  // skipped, while its HOST was already checked above. Over-producing is
  // the safe direction — under-producing is how the first version came
  // to check nothing.
  const joined = bases.flatMap((b) => suffixes.map((sx) => b.replace(/\/+$/, '') + sx));
  return [...new Set([...bases, ...joined])];
}

async function main() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, '..', '..', 'apps', 'web', 'src', 'lib', 'map-sources.ts');
  const source = readFileSync(file, 'utf8');

  const declared = urlsIn(source);
  if (declared.length === 0) {
    throw new Error(`no URL found in ${file} — this check has stopped looking at anything`);
  }

  const problems = [];
  let stylesChecked = 0;
  console.log('hosts named in map-sources.ts:');
  for (const url of declared) {
    const host = hostOf(url);
    const why = verdict(host);
    console.log(`  ${(host ?? '(ours)').padEnd(28)} ${url}`);
    if (why) problems.push(`map-sources.ts names ${host} — ${why}`);
  }

  console.log('\nassets each style declares:');
  for (const url of declared) {
    let style;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      style = await res.json();
    } catch {
      continue; // Not a style document; the host was checked above.
    }
    const assets = assetUrlsOf(style);
    if (assets.length === 0) continue;
    stylesChecked += 1;
    for (const a of assets) {
      console.log(`  ${(hostOf(a.url) ?? '(ours)').padEnd(28)} ${a.what}  (from ${url})`);
    }
    problems.push(...problemsIn(style, url));
  }

  // 🔴 A run that inspected no style is a FAILURE, not a pass. That is
  // exactly what the first version of this file did, in silence.
  if (stylesChecked === 0) {
    throw new Error('not one style was inspected — this check proved nothing');
  }

  if (problems.length) {
    console.log('');
    for (const p of problems) console.log(`  ${p}`);
    throw new Error(`${problems.length} map asset(s) load from a host we may not use`);
  }
  console.log('\nevery font and sprite comes from a host whose terms we have read');
}

const RUN_DIRECTLY =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (RUN_DIRECTLY) {
  if (process.argv.some((a) => a === '--self-test' || a.startsWith('--self-test='))) {
    process.exit(selfTest() ? 1 : 0);
  }
  await main();
}
