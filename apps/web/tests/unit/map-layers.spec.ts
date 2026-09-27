import { expect, test } from '@playwright/test';
import {
  DEFAULT_LAYERS,
  LAYERS,
  LAYER_ID,
  allLayers,
  emptyLayerNotice,
  isLive,
  layersFromParam,
  layersToParam,
  liveLayers,
  noLayers,
  toggleLayer,
} from '../../src/lib/map-layers';

// CAMP-122. The rules this file holds are the ones that decide whether a
// reader can tell an empty area from a broken map — and both of those
// look identical on screen unless the code says which it is.

test('a planned layer is never offered to a reader', () => {
  // 🔴 A switch for a dataset that does not exist is a promise, and a
  // greyed one is a promise with an excuse. Four layers are declared so
  // that adding them later is one word; none of them may leak out.
  const planned = LAYERS.filter((l) => l.status === 'planned');
  expect(planned.length).toBeGreaterThan(0);
  for (const l of planned) {
    expect(liveLayers(), `${l.id} escaped the registry`).not.toContain(l.id);
    expect(isLive(l.id)).toBe(false);
    // And each one names the card that will bring it, so the registry
    // cannot quietly become a wish list.
    expect(l.card, `${l.id} has no card behind it`).toMatch(/^CAMP-\d+$/);
  }
});

test('every declared layer is unique and describes itself', () => {
  const ids = LAYERS.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const l of LAYERS) {
    expect(l.label.length).toBeGreaterThan(2);
    expect(l.description.length, `${l.id} has no description`).toBeGreaterThan(10);
  }
});

test('a first-time reader gets every live layer', () => {
  // Hiding one by default means nobody discovers it.
  expect(DEFAULT_LAYERS()).toEqual(liveLayers());
  expect(DEFAULT_LAYERS().length).toBeGreaterThan(0);
});

test('toggling is reversible and keeps the registry order', () => {
  const start = allLayers();
  const off = toggleLayer(start, 'campsites');
  expect(off).not.toContain('campsites');
  expect(toggleLayer(off, 'campsites')).toEqual(start);
});

test('an unknown layer id changes nothing', () => {
  const start = allLayers();
  expect(toggleLayer(start, 'unicorns')).toEqual(start);
  // …including one that exists in the registry but is not live yet.
  expect(toggleLayer(start, 'charging')).toEqual(start);
});

// ── the URL, so a map somebody sends opens the way they saw it ─────────

test('the default is absent from the URL, not spelled out', () => {
  // 🔴 A link that carries the default would freeze it: a reader who
  // shared /map today would still be showing today's layers a year from
  // now, after we added three more.
  expect(layersToParam(allLayers())).toBeNull();
});

test('and an absent parameter means the default, not an empty map', () => {
  expect(layersFromParam(null)).toEqual(DEFAULT_LAYERS());
  expect(layersFromParam(undefined)).toEqual(DEFAULT_LAYERS());
});

test('an empty parameter means an empty map, on purpose', () => {
  // `?layers=` is how a reader asks for nothing. It is a different thing
  // from not asking at all, and the two must not collapse into one.
  expect(layersFromParam('')).toEqual([]);
  expect(layersToParam(noLayers())).toBe('');
});

test('a link survives a layer being renamed or removed', () => {
  expect(layersFromParam('campsites,gone-layer')).toEqual(['campsites']);
  expect(layersFromParam('nothing-we-know')).toEqual([]);
});

test('whitespace in a hand-edited link is forgiven', () => {
  expect(layersFromParam(' campsites , charging ')).toEqual(['campsites']);
});

test('a round trip through the URL is lossless', () => {
  for (const state of [allLayers(), noLayers()]) {
    const param = layersToParam(state);
    expect(layersFromParam(param)).toEqual(state);
  }
});

// ── the sentence that stops an empty map reading as "all clear" ────────

test('a layer that is on and drew nothing says so by name', () => {
  const notice = emptyLayerNotice(['campsites'], { campsites: 0 });
  expect(notice).toContain('Campsites');
  // 🔴 The distinction the whole card turns on.
  expect(notice).toContain('nothing in view');
  expect(notice).not.toMatch(/all clear|none here|nothing nearby/i);
});

test('a layer that drew something says nothing', () => {
  expect(emptyLayerNotice(['campsites'], { campsites: 61521 })).toBeNull();
});

test('a layer that is switched off is not reported as empty', () => {
  // It drew nothing because nobody asked it to. Saying so would train
  // readers to ignore the message that matters.
  expect(emptyLayerNotice([], { campsites: 0 })).toBeNull();
});

test('several silent layers are listed, not summarised', () => {
  const notice = emptyLayerNotice(
    ['campsites', 'hazards', 'charging'] as never,
    {},
  );
  expect(notice).toContain('Campsites');
  expect(notice).toContain('Hazards');
  expect(notice).toContain('Charging');
  expect(notice).toContain(' and ');
});

test('a missing count is treated as zero, not as "fine"', () => {
  // 🔴 An absent measurement is the case this project keeps getting
  // wrong: `undefined` must read as "we drew nothing", never as "we did
  // not check, so assume it is fine".
  expect(emptyLayerNotice(['campsites'], {})).not.toBeNull();
});

// ── the cases review found unasserted ──────────────────────────────────

test('every id survives a comma-joined URL', () => {
  // 🔴 A layer called "fire, flood" would split in half on the way back
  // and vanish from a shared link — and being absent from `active`, it
  // would not even be reported as empty.
  for (const l of LAYERS) {
    expect(l.id, `${l.id} is not a safe URL token`).toMatch(LAYER_ID);
    expect(l.id).not.toContain(',');
  }
});

test('an unknown id is refused on its own, without the order rule', () => {
  // Both guards in toggleLayer were deletable one at a time with nothing
  // noticing, because only one layer is live. This drives each.
  expect(toggleLayer(['campsites'], 'not-a-layer')).toEqual(['campsites']);
  expect(toggleLayer([], 'not-a-layer')).toEqual([]);
  expect(toggleLayer([], 'hazards')).toEqual([]);
});

test('an unknown id already in the state is dropped, not carried', () => {
  // The order rule is also the safety net: whatever comes in, what comes
  // out is live layers in registry order.
  expect(toggleLayer(['hazards', 'campsites', 'nonsense'], 'campsites')).toEqual([]);
  expect(toggleLayer(['hazards', 'nonsense'], 'campsites')).toEqual(['campsites']);
});

test('the round trip is lossless for EVERY subset, not just the ends', () => {
  const live = allLayers();
  const total = 2 ** live.length;
  for (let mask = 0; mask < total; mask++) {
    const subset = live.filter((_, i) => (mask >> i) & 1);
    expect(layersFromParam(layersToParam(subset))).toEqual(subset);
  }
});

test('a count we cannot read is a count of nothing', () => {
  // 🔴 NaN is what Number(missingAttribute) gives, and it used to read
  // as "we drew something".
  // 🔴 Each of these kills a different guard. Review mutation-tested the
  // first version: removing `typeof n === 'number'` or `Number.isFinite`
  // left every test green, because the list had no numeric string and no
  // Infinity — `'3' > 0` and `Infinity > 0` both read as drawn.
  for (const bad of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0,
    '3',
    'lots',
    true,
    [3],
    { valueOf: () => 3 },
    undefined,
    null,
  ]) {
    const notice = emptyLayerNotice(['campsites'], {
      campsites: bad as unknown as number,
    });
    expect(notice, `a count of ${String(bad)} was taken as drawn`).not.toBeNull();
  }
});

test('a layer named after a prototype member is not assumed drawn', () => {
  // Passes because `toString` is a function and the type check rejects
  // it — not because anything special is done about the prototype.
  for (const id of ['toString', 'constructor', 'valueOf', '__proto__']) {
    expect(emptyLayerNotice([id] as never, {}), id).not.toBeNull();
  }
});
