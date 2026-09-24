import { expect, test } from '@playwright/test';
import {
  DEFAULT_LAYERS,
  LAYERS,
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
