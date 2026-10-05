#!/usr/bin/env node
//
// Turning a place name into coordinates, without paying and without
// asking twice.
//
//   node scripts/geocode/geocode.mjs --self-test
//
// 🔴 THE CACHE IS THE FEATURE, NOT THE PROVIDERS. A site about campsites
// geocodes the same few thousand names for ever. Once they are stored,
// live requests fall to almost nothing and the providers' daily limits
// stop being a constraint at all. Everything else here exists to serve
// that, which is why the cache is checked before any quota is consulted
// and why a cached answer is free even when every provider is exhausted.
//
// MEASURED AGAINST THE PROVIDERS' OWN PAGES, 2026-10-05 — the card
// carried these as assertions and two of them were incomplete:
//
//   Geoapify     3 000 credits/day, and their FAQ says "1 API request
//                costs 1 credit for simple requests like Geocoding API",
//                so that is 3 000 geocodes. Up to 5 requests/second.
//                "Can I use the Free plan in commercial projects? Yes…
//                including in production."
//
//   LocationIQ   5 000 requests/day, but ALSO 2 requests/second and 60
//                per minute — neither of which the card mentions, and
//                the per-minute one binds long before the daily one.
//                Its commercial permission is headed "Limited
//                Commercial Use": allowed "if you spread the love by
//                adding a prominent link back to us on your site". That
//                backlink is a CONDITION of the licence, so `attribution`
//                travels with every answer rather than living in a
//                comment somebody forgets.
//
// ❌ Public Nominatim is not an option and the card quotes the reason
// exactly; verified verbatim at operations.osmfoundation.org:
// "Applications and services whose primary function is related to
// geocoding must run their own service." Their page also caps use at one
// request per second and calls periodic app requests bulk geocoding.

/** What a provider must look like. Nothing here talks to a network. */
/**
 * What a provider must look like. Nothing here talks to a network.
 *
 * 🔴 THIS WAS A LIST OF NAMES CHECKED WITH `!== undefined`, and that let
 * three things through. `attribution: ''` passed, so an answer reached
 * the caller with an EMPTY licence line — and that line is a condition
 * of LocationIQ's free tier, not decoration. `lookup: 'yes'` passed too,
 * and died at call time with a TypeError instead of at construction.
 * And the one test guarding it used a fixture missing EVERY field, so
 * it only ever pinned whichever was checked first: dropping any of the
 * other three from the list survived.
 */
export const PROVIDER_SHAPE = {
  name: (v) => typeof v === 'string' && v.trim() !== '',
  dailyLimit: (v) => Number.isInteger(v) && v > 0,
  attribution: (v) => typeof v === 'string' && v.trim() !== '',
  lookup: (v) => typeof v === 'function',
};

/**
 * A key that two spellings of one place agree on.
 *
 * 🔴 WITHOUT THIS THE CACHE IS DECORATION. "Camping Bela Krajina",
 * "camping bela krajina" and " Camping  Bela   Krajina " are one place
 * and three live requests otherwise — and a campsite directory sends
 * exactly those, because the name arrives from a feed, a URL and a user
 * in three different shapes.
 */
export function cacheKey(query, country) {
  const text = foldCase(query);
  if (!text) throw new Error('an empty query has no answer to cache');
  const where = String(country ?? '').trim().toLowerCase();
  // 🔴 The separator is escaped on both sides, or `cacheKey('fr|Paris')`
  // and `cacheKey('Paris', 'fr')` are one key for two different asks.
  return `${where.replace(/\|/g, '%7C')}|${text.replace(/\|/g, '%7C')}`;
}

/**
 * One place, however it was typed — but only where the DIFFERENCE IS CASE.
 *
 * 🔴 WHERE THIS DRAWS THE LINE, AND WHY. Review found five pairs the
 * first version split: `Straße`/`STRASSE`, `İzmir`/`izmir`,
 * `Malmö`/`Malmo`, a trailing full stop, and Greek `ΟΔΟΣ`/`οδός`. Four
 * of those are CASE — German uppercase ß is SS, Turkish dotted İ
 * lowercases to `i` plus a combining dot, Greek final sigma is a
 * positional form of the same letter — and `toLowerCase` alone handles
 * none of them.
 *
 * ⚠️ `ΟΔΟΣ`/`οδός` STAYS SPLIT, and that is a decision. Greek
 * orthography drops the tonos in uppercase, so those two really are one
 * word — but stripping the tonos generally would merge `πότε` ("when")
 * with `ποτέ` ("never"), which are different words. One extra provider
 * call against a wrong answer is not a close contest.
 *
 * `Malmö`/`Malmo` is NOT case. It is a different spelling, one letter
 * short, and folding it would mean two genuinely different places could
 * share a cache row and the second would be served the first's
 * coordinates. A split costs one extra provider call; a collision
 * serves a wrong answer, and this cache exists under a geocoder whose
 * whole job is being right about where something is. So accents stay.
 */
export function foldCase(value) {
  return String(value ?? '')
    .normalize('NFKC')
    // German sharp s: its uppercase IS "SS", so the two spellings are
    // one word in two cases.
    .replace(/\u00df|\u1e9e/g, 'ss')
    // Greek final sigma is the same letter in a word-final position.
    .replace(/\u03c2/g, '\u03c3')
    .toLowerCase()
    // Turkish dotted capital İ lowercases to "i" + COMBINING DOT ABOVE.
    .replace(/i\u0307/g, 'i')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, ' ')
    // A trailing full stop or comma is punctuation, not a place.
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, '')
    .trim();
}

/** A day boundary in UTC, so a quota resets when the provider says. */
export const dayOf = (when) => new Date(when).toISOString().slice(0, 10);

/**
 * Counts what we have spent against each provider today.
 *
 * Kept separate from the providers themselves because a quota is OUR
 * bookkeeping: the provider tells us afterwards, by refusing.
 */
export function createLedger(initial = {}) {
  // Accepts either shape: the old `{key: n}` and the one `snapshot()`
  // now writes. A ledger restored from the old shape has no refusals to
  // restore, which is exactly the bug — so it is read, not refused.
  const spent = new Map(Object.entries(initial.spent ?? initial));
  const refused = new Map((initial.refused ?? []).map((k) => [k, true]));
  return {
    spentOn(name, day) {
      return spent.get(`${day}|${name}`) ?? 0;
    },
    charge(name, day) {
      const k = `${day}|${name}`;
      spent.set(k, (spent.get(k) ?? 0) + 1);
    },
    /** The provider said no. Believe it for the rest of the day. */
    refuse(name, day) {
      refused.set(`${day}|${name}`, true);
    },
    hasRefused(name, day) {
      return refused.get(`${day}|${name}`) === true;
    },
    /** Why this provider cannot be asked right now, or null. */
    blocked(provider, day) {
      if (this.hasRefused(provider.name, day)) return 'refused us earlier today';
      if (this.spentOn(provider.name, day) >= provider.dailyLimit) {
        return `we have spent its ${provider.dailyLimit} for today`;
      }
      return null;
    },
    /**
     * 🔴 THIS USED TO EMIT `spent` ALONE, so the only persistence path
     * silently forgot every refusal: a provider that told us to stop
     * was asked again the same UTC day after any restart. The refusal is
     * the MORE important half — it is the provider's own word, where the
     * count is only our bookkeeping.
     */
    snapshot() {
      return { spent: Object.fromEntries(spent), refused: [...refused.keys()] };
    },
  };
}

/** Thrown when every provider is spent and the answer is not cached. */
export class NoProviderLeft extends Error {
  constructor(reasons) {
    super(`no provider could be asked: ${reasons.join('; ')}`);
    this.name = 'NoProviderLeft';
    this.reasons = reasons;
  }
}

/**
 * A geocoder over a cache and an ordered list of providers.
 *
 * Nothing here knows about HTTP. The providers are injected, so the two
 * things the card asks to be proved — that a repeat does not reach a
 * provider, and that the second provider takes over when the first is
 * spent — are proved by counting calls, not by watching a network.
 */
export function createGeocoder({ providers, cache, ledger = createLedger(), now = () => Date.now() }) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('a geocoder with no provider can only ever answer from cache');
  }
  for (const p of providers) {
    for (const [field, valid] of Object.entries(PROVIDER_SHAPE)) {
      if (!valid(p?.[field])) {
        throw new Error(`provider ${typeof p?.name === 'string' ? p.name : '?'} has no usable ${field}`);
      }
    }
  }

  // 🔴 ONE FLIGHT PER KEY. Without this both of the card's criteria fail
  // the moment anything runs in parallel, and the first caller is a
  // batch over 87 505 campsites. Measured before the fix:
  // `Promise.all` of 8 identical queries asked the provider EIGHT times,
  // and a daily limit of 2 let TEN parallel queries through — because
  // the cache read and the quota check both happen before an `await`,
  // so every caller passes them before any caller has finished.
  const inFlight = new Map();

  return {
    ledger,
    geocode(query, { country } = {}) {
      const key = cacheKey(query, country);
      const running = inFlight.get(key);
      if (running) return running;
      const flight = this.lookUp(key, query, country).finally(() => inFlight.delete(key));
      inFlight.set(key, flight);
      return flight;
    },
    async lookUp(key, query, country) {

      // 🔴 CACHE FIRST, ALWAYS — before the quota, before the clock. A
      // stored answer costs nothing and must keep working on a day when
      // every provider has refused us.
      const hit = await cache.get(key);
      if (hit) {
        // 🔴 A row stored before `attribution` existed would hand one
        // back as `undefined`, which is the same empty licence line by
        // another route. An answer we cannot attribute is not an answer.
        if (typeof hit.attribution !== 'string' || hit.attribution.trim() === '') {
          throw new Error(`cached answer for "${key}" carries no attribution — refusing to serve it`);
        }
        return { ...hit, from: 'cache' };
      }

      const day = dayOf(now());
      const reasons = [];
      for (const provider of providers) {
        const why = ledger.blocked(provider, day);
        if (why) {
          reasons.push(`${provider.name}: ${why}`);
          continue;
        }
        // 🔴 CHARGED BEFORE THE CALL, NOT AFTER. Charging afterwards
        // meant ten parallel queries all read the same spent count and
        // all passed a limit of two. It is also the truer accounting:
        // the request leaves us whether or not an answer comes back,
        // and the provider counts it either way.
        ledger.charge(provider.name, day);
        let answer;
        try {
          answer = await provider.lookup(query, { country });
        } catch (err) {
          // A refusal is about the quota; anything else is about this
          // one query and must not condemn the provider for the day.
          if (err?.quotaExhausted) {
            ledger.refuse(provider.name, day);
            reasons.push(`${provider.name}: refused us (${String(err.message).slice(0, 40)})`);
            continue;
          }
          throw err;
        }
        if (!answer) {
          reasons.push(`${provider.name}: knows no such place`);
          continue;
        }
        const stored = {
          lat: answer.lat,
          lon: answer.lon,
          name: answer.name ?? null,
          provider: provider.name,
          // The licence condition travels with the answer.
          attribution: provider.attribution,
          at: new Date(now()).toISOString(),
        };
        await cache.set(key, stored);
        return { ...stored, from: provider.name };
      }
      throw new NoProviderLeft(reasons);
    },
  };
}

/** A cache in memory. The file- and table-backed ones share its shape. */
export function memoryCache(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    size: () => map.size,
  };
}

// --------------------------------------------------------------- self-test

async function selfTest() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      bad += 1;
      console.log(`x    ${name}${detail ? `  ${detail}` : ''}`);
    }
  };
  const run = (fns) => Promise.all(fns);

  // One place, three spellings.
  ok('a key folds case', cacheKey('Camping Bela Krajina') === cacheKey('camping bela krajina'));
  ok('…and collapses runs of spaces', cacheKey(' Camping  Bela   Krajina ') === cacheKey('Camping Bela Krajina'));
  ok('…and a curly apostrophe is the same place as a straight one',
    cacheKey("Camping d’Or") === cacheKey("Camping d'Or"));
  ok('…but two countries are two keys',
    cacheKey('Main Street', 'si') !== cacheKey('Main Street', 'hr'));
  ok('…and a country is part of the key, not decoration',
    cacheKey('Main Street', 'SI') === cacheKey('main street', 'si'));
  {
    let threw = false;
    try { cacheKey('   '); } catch { threw = true; }
    ok('an empty query is refused rather than cached as nothing', threw);
  }

  // 🔴 Case folding is not `toLowerCase`.
  ok('German sharp s folds with its uppercase SS', cacheKey('Straße', 'de') === cacheKey('STRASSE', 'de'));
  ok('…Turkish dotted İ folds to i', cacheKey('İzmir', 'tr') === cacheKey('izmir', 'tr'));
  ok('…and a trailing full stop is punctuation, not a place',
    cacheKey('Camping X.', 'si') === cacheKey('Camping X', 'si'));
  ok('…a leading comma too', cacheKey(', Camping X', 'si') === cacheKey('Camping X', 'si'));
  // The deliberate splits: spelling is not case.
  ok('an accent is a spelling difference, so it stays a different key',
    cacheKey('Malmö', 'se') !== cacheKey('Malmo', 'se'));
  ok('…and Greek tonos stays too, because stripping it merges real words',
    cacheKey('ΟΔΟΣ', 'gr') !== cacheKey('οδός', 'gr'));
  // 🔴 The separator must not be forgeable from either side.
  ok('a pipe in the query cannot forge a country',
    cacheKey('fr|Paris') !== cacheKey('Paris', 'fr'));
  ok('…nor one in the country', cacheKey('x', 'a|b') !== cacheKey('b|x', 'a'));
  ok('NFKC is load-bearing: two spellings of one accent are one key',
    cacheKey('N\u00eemes', 'fr') === cacheKey('Ni\u0302mes', 'fr'));

    ok('a day is a UTC date', dayOf(Date.UTC(2026, 9, 5, 23, 59)) === '2026-10-05');
  ok('…and the next hour is the next day', dayOf(Date.UTC(2026, 9, 6, 0, 1)) === '2026-10-06');

  // A provider that counts how often it was actually asked.
  const fake = (name, answer, opts = {}) => {
    const p = {
      name,
      dailyLimit: opts.dailyLimit ?? 10,
      perSecond: 5,
      attribution: `© ${name}`,
      asked: 0,
      async lookup(q) {
        p.asked += 1;
        if (opts.throws) throw opts.throws;
        return typeof answer === 'function' ? answer(q) : answer;
      },
    };
    return p;
  };
  const quotaError = () => Object.assign(new Error('429 daily quota'), { quotaExhausted: true });

  // 🔴 THE CARD'S FIRST CRITERION: "a repeat of the same address does
  // not go to the provider".
  {
    const a = fake('alpha', { lat: 46.1, lon: 15.2, name: 'Bela Krajina' });
    const cache = memoryCache();
    const g = createGeocoder({ providers: [a], cache, now: () => Date.UTC(2026, 9, 5) });

    const first = await g.geocode('Camping Bela Krajina', { country: 'si' });
    ok('the first lookup reaches the provider', a.asked === 1 && first.from === 'alpha');
    ok('…and the answer carries its coordinates', first.lat === 46.1 && first.lon === 15.2);

    const again = await g.geocode('Camping Bela Krajina', { country: 'si' });
    ok('🔴 a repeat does NOT reach the provider', a.asked === 1, `asked ${a.asked} times`);
    ok('…and says it came from the cache', again.from === 'cache');
    ok('…with the same coordinates', again.lat === 46.1 && again.lon === 15.2);

    // The three spellings that made the cache worth having.
    await g.geocode('camping bela krajina', { country: 'si' });
    await g.geocode('  Camping   Bela Krajina  ', { country: 'SI' });
    ok('…and so do three other spellings of the same place', a.asked === 1, `asked ${a.asked} times`);
    ok('…which is one cache row, not four', cache.size() === 1, String(cache.size()));
  }

  // 🔴 THE CARD'S SECOND CRITERION: "when one provider's quota runs out
  // the other works".
  {
    const a = fake('alpha', null, { throws: quotaError() });
    const b = fake('beta', { lat: 1, lon: 2 });
    const g = createGeocoder({ providers: [a, b], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });

    const r = await g.geocode('Somewhere');
    ok('🔴 a refused provider hands over to the next', r.from === 'beta' && r.lat === 1);
    ok('…and both were asked exactly once', a.asked === 1 && b.asked === 1);

    await g.geocode('Somewhere else');
    ok('…and the refused one is not asked again today', a.asked === 1, `asked ${a.asked} times`);
    ok('…while the working one is', b.asked === 2);
  }

  // Spending the daily allowance is the same story told by our own books.
  {
    const a = fake('alpha', { lat: 1, lon: 1 }, { dailyLimit: 2 });
    const b = fake('beta', { lat: 2, lon: 2 });
    const g = createGeocoder({ providers: [a, b], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });
    await g.geocode('one');
    await g.geocode('two');
    const third = await g.geocode('three');
    ok('a provider is dropped once its daily limit is spent', third.from === 'beta', third.from);
    ok('…after exactly its allowance, not one fewer', a.asked === 2, String(a.asked));
  }

  // 🔴 BOTH CRITERIA FAILED UNDER PARALLEL USE, and the first caller is
  // a batch over 87 505 campsites.
  {
    const slow = (name, answer, dailyLimit = 10) => {
      const p = {
        name, dailyLimit, perSecond: 5, attribution: `© ${name}`, asked: 0,
        async lookup() {
          p.asked += 1;
          await new Promise((r) => setTimeout(r, 5));
          return answer;
        },
      };
      return p;
    };
    const a = slow('alpha', { lat: 1, lon: 2 });
    const g = createGeocoder({ providers: [a], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });
    const eight = await Promise.all(Array.from({ length: 8 }, () => g.geocode('Camping Bela Krajina', { country: 'si' })));
    ok('🔴 eight identical queries at once ask the provider ONCE', a.asked === 1, `asked ${a.asked}`);
    ok('…and every caller gets the same answer', eight.every((r) => r.lat === 1));

    const b = slow('beta', { lat: 3, lon: 4 }, 2);
    const c = slow('gamma', { lat: 5, lon: 6 });
    const g2 = createGeocoder({ providers: [b, c], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });
    await Promise.all(Array.from({ length: 10 }, (_, i) => g2.geocode(`place ${i}`)));
    ok('🔴 a daily limit of two is not overrun by ten parallel queries', b.asked === 2, `asked ${b.asked}`);
    ok('…and the rest went to the next provider', c.asked === 8, `asked ${c.asked}`);
  }

  // 🔴 The ledger's only persistence path dropped every refusal.
  {
    const l = createLedger();
    l.refuse('alpha', '2026-10-05');
    l.charge('beta', '2026-10-05');
    const back = createLedger(l.snapshot());
    ok('a refusal survives a snapshot and a restart', back.hasRefused('alpha', '2026-10-05'));
    ok('…and so does the count', back.spentOn('beta', '2026-10-05') === 1);
    ok('…so the refused provider is still blocked after the restart',
      back.blocked({ name: 'alpha', dailyLimit: 10 }, '2026-10-05') !== null);
    // 🔴 The suite proved refusals are REMEMBERED; this proves they are
    // also FORGOTTEN, which keying by name alone would break.
    ok('…but not on the next day', back.hasRefused('alpha', '2026-10-06') === false);
  }

  // 🔴 The shape check used one fixture missing every field, so it only
  // ever pinned whichever was tested first.
  {
    const whole = { name: 'p', dailyLimit: 5, perSecond: 1, attribution: '© p', lookup: () => null };
    const refused = (over) => {
      try {
        createGeocoder({ providers: [{ ...whole, ...over }], cache: memoryCache() });
        return false;
      } catch { return true; }
    };
    ok('a provider with no name is refused', refused({ name: '' }));
    ok('…with no daily limit is refused', refused({ dailyLimit: 0 }));
    ok('…with an EMPTY attribution is refused, because that is a licence line',
      refused({ attribution: '  ' }));
    ok('…with a lookup that is not a function is refused at construction',
      refused({ lookup: 'yes' }));
    ok('…while a complete one is accepted', !refused({}));
  }

  // 🔴 A cache row written before attribution existed must not pass one
  // through as undefined.
  {
    const a = { name: 'alpha', dailyLimit: 5, perSecond: 1, attribution: '© a', lookup: async () => ({ lat: 1, lon: 1 }) };
    const stale = memoryCache({ 'si|old place': { lat: 1, lon: 2, provider: 'alpha' } });
    const g = createGeocoder({ providers: [a], cache: stale, now: () => Date.UTC(2026, 9, 5) });
    let threw = null;
    try { await g.geocode('Old place', { country: 'si' }); } catch (e) { threw = e; }
    ok('an unattributed cache row is refused, not served', /attribution/.test(threw?.message ?? ''), String(threw));
  }

  // 🔴 A cached answer must survive a day when nobody will talk to us.
  {
    const a = fake('alpha', null, { throws: quotaError() });
    const cache = memoryCache({ 'si|camping x': { lat: 9, lon: 9, provider: 'alpha', attribution: '© alpha' } });
    const g = createGeocoder({ providers: [a], cache, now: () => Date.UTC(2026, 9, 5) });
    const r = await g.geocode('Camping X', { country: 'si' });
    ok('a cached place answers even when every provider is spent', r.lat === 9 && r.from === 'cache');
    ok('…without asking anyone', a.asked === 0);

    let failed = null;
    try { await g.geocode('Somewhere new', { country: 'si' }); } catch (e) { failed = e; }
    ok('…while an uncached one fails loudly rather than returning nothing',
      failed instanceof NoProviderLeft, String(failed));
    ok('…and names why each provider could not be asked',
      /alpha/.test(failed?.message ?? ''), failed?.message ?? '');
  }

  // A broken query must not cost the provider its whole day.
  {
    const a = fake('alpha', null, { throws: new Error('malformed query') });
    const g = createGeocoder({ providers: [a], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });
    let threw = null;
    try { await g.geocode('???'); } catch (e) { threw = e; }
    ok('an ordinary error is passed up, not swallowed', threw?.message === 'malformed query');
    ok('…and does NOT mark the provider refused for the day',
      !g.ledger.hasRefused('alpha', '2026-10-05'));
  }

  // The licence condition has to reach whatever renders the result.
  {
    const a = fake('alpha', { lat: 1, lon: 2 });
    const g = createGeocoder({ providers: [a], cache: memoryCache(), now: () => Date.UTC(2026, 9, 5) });
    const r = await g.geocode('Anywhere');
    ok('the attribution travels with the answer, not in a comment', r.attribution === '© alpha');
    ok('…and is stored, so a cached answer still carries it',
      (await g.geocode('Anywhere')).attribution === '© alpha');
  }

  // A geocoder with nothing to ask is a mistake, not a configuration.
  {
    let threw = false;
    try { createGeocoder({ providers: [], cache: memoryCache() }); } catch { threw = true; }
    ok('a geocoder with no provider is refused', threw);
    let shapeThrew = false;
    try {
      createGeocoder({ providers: [{ name: 'half' }], cache: memoryCache() });
    } catch { shapeThrew = true; }
    ok('…and so is a provider missing part of its shape', shapeThrew);
  }

  // Quotas reset when the provider's day does, not when ours does.
  {
    const a = fake('alpha', { lat: 1, lon: 1 }, { dailyLimit: 1 });
    const b = fake('beta', { lat: 2, lon: 2 });
    let clock = Date.UTC(2026, 9, 5, 23, 0);
    const g = createGeocoder({ providers: [a, b], cache: memoryCache(), now: () => clock });
    await g.geocode('one');
    const spent = await g.geocode('two');
    ok('alpha is spent late on the fifth', spent.from === 'beta');
    clock = Date.UTC(2026, 9, 6, 1, 0);
    const tomorrow = await g.geocode('three');
    ok('…and has its allowance back after midnight UTC', tomorrow.from === 'alpha', tomorrow.from);
  }

  console.log(bad ? `\nx ${bad} self-test failure(s)` : '\nself-test passed');
  return bad > 0;
}

const RUN_DIRECTLY =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (RUN_DIRECTLY) {
  if (process.argv.some((a) => a === '--self-test' || a.startsWith('--self-test='))) {
    process.exit((await selfTest()) ? 1 : 0);
  }
}
