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
  // 🔴 `//host/path` IS NOT OURS, and treating it as ours was fail-open:
  // `hostOf('//protomaps.github.io/…')` threw, came back null, and the
  // asset was booked as locally served. A protocol-relative URL resolves
  // to that host on whatever scheme the page is using.
  const absolute = cleaned.startsWith('//') ? `https:${cleaned}` : cleaned;
  try {
    return new URL(absolute).host;
  } catch {
    // A path-relative URL really is served by us, which is the point.
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
  // 🔴 THE LINE THAT USED TO STAND HERE IS GONE, AND IT IS WHY THIS
  // FUNCTION'S TESTS PROVED NOTHING. `if (a.length <= b.length) return
  // false` was provably redundant — I verified the dot-counting argument
  // and kept it "for the next reader". Review then restored the old
  // `host.endsWith(base)` and the whole suite stayed green: all three
  // bypass fixtures had FEWER labels than the base, so the redundant
  // line answered them before the real comparison ever ran. A redundant
  // guard is not free; it shadows the thing it sits in front of.
  //
  // The breaking input nothing reached:
  // `isHostOrSubdomain('x.nottiles.openfreemap.org',
  // 'tiles.openfreemap.org')` is false here and TRUE under `endsWith` —
  // an allowlist bypass. It is now a fixture.
  return a.slice(a.length - b.length).join('.') === base;
}

/**
 * A run that inspected nothing is a failure, not a pass.
 *
 * 🔴 BOTH OF THESE LIVED INSIDE `main`, WHICH NOTHING CALLS. Review
 * deleted each throw in turn and the suite stayed green — so the rule
 * "a check that proved nothing has failed", added as a correction, was
 * itself unprotected.
 */
export const provedNothing = ({ declared, stylesChecked }) => {
  if (declared === 0) return 'no URL was found in the style list — this check has stopped looking';
  if (stylesChecked === 0) return 'not one style was inspected — this check proved nothing';
  return null;
};

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
  // 🔴 `//host/path` resolves to THAT host; reading it as ours was
  // fail-open and the whole asset went unchecked.
  ok('a protocol-relative url names its host, not ours',
    hostOf('//protomaps.github.io/basemaps-assets/fonts/{a}/{b}.pbf') === 'protomaps.github.io');
  ok('…so it is caught like any other',
    problemsIn({ glyphs: '//protomaps.github.io/fonts/{a}/{b}.pbf' }, 't').length === 1);

  ok('a host is itself', isHostOrSubdomain('a.example', 'a.example'));
  ok('…a subdomain belongs to it', isHostOrSubdomain('x.a.example', 'a.example'));
  ok('…a deep subdomain too', isHostOrSubdomain('x.y.a.example', 'a.example'));
  // 🔴 THE BYPASS NOTHING REACHED. Every earlier fixture had FEWER
  // labels than the base, so the redundant length check answered them
  // first and `endsWith(base)` survived untouched. These have MORE.
  ok('a host whose label merely ends with the name is not a subdomain',
    !isHostOrSubdomain('x.nottiles.openfreemap.org', 'tiles.openfreemap.org'));
  ok('…and the same one level deeper', !isHostOrSubdomain('a.b.notgithub.io', 'github.io'));
  ok('…while a genuine subdomain of the same depth still matches',
    isHostOrSubdomain('x.eu.tiles.openfreemap.org', 'tiles.openfreemap.org'));
  ok('🔴 and the verdict on it is "unknown", not "allowed"',
    verdict('x.nottiles.openfreemap.org') !== null);

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

  // 🔴 The rule "a check that proved nothing has failed" lived inside
  // `main`, which nothing calls — deleting either throw stayed green.
  {
    ok('a run that found no URL at all has failed',
      /stopped looking/.test(provedNothing({ declared: 0, stylesChecked: 0 }) ?? ''));
    ok('…a run that found URLs but inspected no style has failed too',
      /proved nothing/.test(provedNothing({ declared: 3, stylesChecked: 0 }) ?? ''));
    ok('…and a run that inspected one is fine',
      provedNothing({ declared: 3, stylesChecked: 1 }) === null);
  }

  // 🔴 A style can arrive by environment, and that is how the own-style
  // is meant to arrive.
  {
    const src = "const OFM = process.env.NEXT_PUBLIC_TILES_URL ?? 'https://x.example';\n"
      + "if (process.env.NEXT_PUBLIC_SELF_TILES_URL) { style: process.env.NEXT_PUBLIC_SELF_TILES_URL }";
    const names = envNamesIn(src);
    ok('the environment variables a style can come from are found',
      names.join(',') === 'NEXT_PUBLIC_TILES_URL,NEXT_PUBLIC_SELF_TILES_URL', names.join(','));
    ok('…each named once, however often it is read', envNamesIn(src + src).length === 2);
    ok('…and a file reading none of them returns none', envNamesIn('const a = 1;').length === 0);
  }

  {
    const tpl = "const OFM = 'https://tiles.openfreemap.org';\n  style: `${OFM}/styles/liberty`,";
    const built = urlsIn(tpl);
    // 🔴 `has`, not `built.includes(...)`. CodeQL reads `.includes` with
    // a URL literal as a URL substring check — `js/incomplete-url-
    // substring-sanitization`, high — even when the receiver is an array
    // of strings. It is a false positive HERE, and the pattern it warns
    // about is real everywhere else, so the assertion is written as the
    // exact-element match it always meant.
    const has = (list, url) => list.some((u) => u === url);
    ok('a template style url is reassembled from its base',
      has(built, 'https://tiles.openfreemap.org/styles/liberty'), JSON.stringify(built));
    ok('…and the base itself is still listed',
      has(built, 'https://tiles.openfreemap.org'));
  }

  {
    const src = "const OFM = 'https://tiles.openfreemap.org';\n  style: `${OFM}/styles/liberty`,\n  other: \"https://x.github.io/a\"";
    const found = urlsIn(src);
    const has = (list, url) => list.some((u) => u === url);
    ok('urls are read out of the source text',
      has(found, 'https://tiles.openfreemap.org') && has(found, 'https://x.github.io/a'),
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
/**
 * The environment variables the style list reads a URL out of.
 *
 * 🔴 THE GUARD WAS BLIND TO THE ONE PATH IT EXISTS FOR. `urlsIn` reads
 * URL LITERALS, and `map-sources.ts` ships a fourth style from
 * `NEXT_PUBLIC_SELF_TILES_URL` and relocates the other three through
 * `NEXT_PUBLIC_TILES_URL` — neither leaves a literal behind. Review
 * measured it: with `NEXT_PUBLIC_SELF_TILES_URL` pointing at
 * `protomaps.github.io`, this check printed "every font and sprite comes
 * from a host whose terms we have read" and exited 0.
 *
 * And that variable is not a hypothetical. `map-sources.ts` says in its
 * own comment that the CAMP-29 own-style arrives by setting it "with no
 * other change" — so the deploy that springs the trap is the deploy that
 * this check was written for.
 */
export function envNamesIn(source) {
  return [...new Set(String(source).match(/process\.env\.([A-Z0-9_]+)/g) ?? [])]
    .map((m) => m.slice('process.env.'.length));
}

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
  const problems = [];
  let stylesChecked = 0;

  console.log('hosts named in map-sources.ts:');
  for (const url of declared) {
    const host = hostOf(url);
    const why = verdict(host);
    console.log(`  ${(host ?? '(ours)').padEnd(28)} ${url}`);
    if (why) problems.push(`map-sources.ts names ${host} — ${why}`);
  }

  // A style can also arrive by environment, and that is the path the
  // own-style will take. Whatever is set HERE is checked; whatever is
  // not set is named, so the blind spot is on the page rather than in
  // somebody's memory.
  const envNames = envNamesIn(source);
  console.log('\nstyle URLs that can arrive by environment:');
  for (const name of envNames) {
    const value = process.env[name];
    if (!value) {
      console.log(`  ${name.padEnd(28)} (not set here — NOT CHECKED)`);
      continue;
    }
    const host = hostOf(value);
    const why = verdict(host);
    console.log(`  ${name.padEnd(28)} ${host ?? '(ours)'}  ${value}`);
    if (why) problems.push(`${name} points at ${host} — ${why}`);
    declared.push(value);
  }
  if (envNames.length === 0) {
    problems.push('map-sources.ts no longer reads any environment variable — has this check lost sight of a path?');
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

  const nothing = provedNothing({ declared: declared.length, stylesChecked });
  if (nothing) throw new Error(nothing);

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
