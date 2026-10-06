import { expect, test } from '@playwright/test';
import { askStyleWait, RETRY_EVENTS, retryOnEvent } from '@/lib/retry-on-event';

// CAMP-175 — the scheduling of a deferred redraw, which froze the tab.
//
// 🔴 THIS TEST EXISTS BECAUSE THE E2E SUITE STRUCTURALLY CANNOT SEE IT.
//
// Every map spec stubs the style (`EMPTY_STYLE`, served from a route
// handler), so the first draw succeeds and the retry path is never
// entered. The freeze was reachable only against a real style — that
// is, on every reader's machine and on none of ours. 2 536 e2e tests
// stayed green over a tab that would hang on load.
//
// So the hazard is tested where it can be: as the scheduling decision
// itself, on a map double, in under a millisecond.

/** Enough of a MapLibre map to register and fire the two events. */
function fakeMap() {
  const listeners = new Map<string, (() => void)[]>();
  return {
    on(type: string, fn: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    off(type: string, fn: () => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

test.describe('a retry waits for the map to stir', () => {
  test('🔴 it does NOT run the attempt from the call that registers it', async () => {
    const map = fakeMap();
    let ran = 0;
    retryOnEvent(map, () => {
      ran += 1;
    });

    expect(ran, 'the attempt ran synchronously').toBe(0);
    // 🔴 And not on the microtask checkpoint either, which is the exact
    // line that froze the tab: `queueMicrotask(attempt)` re-entered
    // `refresh` 200 001 times without ever yielding to the event loop,
    // so the style — which can only finish loading from a TASK — never
    // arrived.
    await Promise.resolve();
    await Promise.resolve();
    expect(ran, 'the attempt ran on a microtask, so the style can never load').toBe(0);
    // A real task passes too, and still nothing has run.
    await new Promise((r) => setTimeout(r, 0));
    expect(ran, 'the attempt ran without any map event').toBe(0);
  });

  // 🔴 NAMED, NOT ITERATED. This read `for (const event of RETRY_EVENTS)`
  // — it used the list to pin the list, and review measured the result:
  // it survived BOTH mutations of RETRY_EVENTS, dropping either event.
  // A test whose fixture is its subject asserts nothing.
  test('…and runs on "idle"', () => {
    const map = fakeMap();
    let ran = 0;
    retryOnEvent(map, () => {
      ran += 1;
    });
    map.fire('idle');
    expect(ran, '"idle" did not reach the attempt').toBe(1);
  });

  test('…and on "styledata"', () => {
    const map = fakeMap();
    let ran = 0;
    retryOnEvent(map, () => {
      ran += 1;
    });
    map.fire('styledata');
    expect(ran, '"styledata" did not reach the attempt').toBe(1);
  });

  test('…and the two named here are the two it registers', () => {
    const map = fakeMap();
    retryOnEvent(map, () => {});
    // Both directions, so neither adding nor removing an event passes
    // unnoticed — the list is checked against names written out by hand.
    expect([...RETRY_EVENTS].sort()).toEqual(['idle', 'styledata']);
    expect(map.count('idle'), 'nothing listens for "idle"').toBe(1);
    expect(map.count('styledata'), 'nothing listens for "styledata"').toBe(1);
  });

  test('…and the caller can stop waiting', () => {
    const map = fakeMap();
    let ran = 0;
    const stop = retryOnEvent(map, () => {
      ran += 1;
    });
    for (const event of RETRY_EVENTS) expect(map.count(event)).toBe(1);

    stop();
    for (const event of RETRY_EVENTS) {
      expect(map.count(event), `"${event}" listener outlived stop()`).toBe(0);
      map.fire(event);
    }
    expect(ran).toBe(0);
  });

  test('…and it STAYS until stopped, unlike `once`', () => {
    // 🔴 The bug before the freeze: `once('idle')` waits for a
    // transition that has already happened, because the deferral is
    // registered at the end of a `moveend` — exactly when the map
    // settles. CI proved it by reaching the wide view with
    // `data-region-layer` reading "off" on chromium and on webkit.
    const map = fakeMap();
    let ran = 0;
    retryOnEvent(map, () => {
      ran += 1;
    });
    map.fire('idle');
    map.fire('idle');
    map.fire('styledata');
    expect(ran, 'the listener removed itself after one event').toBe(3);
  });
});

// CAMP-175 — who OWNS the outstanding wait.
//
// 🔴 The defect these cover was in the shipped version of this branch and
// was found by adversarial review, not by any test here: a second refresh
// that also had to wait registered nothing and rode on the first, whose
// own wake-up then died on the generation check. No listener, no pending
// refresh, and no event could rescue it — the exact symptom the card was
// opened about, reintroduced by the fix for it.
//
// e2e cannot see this. `stubStyles` serves EMPTY_STYLE synchronously from
// a route handler, so `style._loaded` is true before the first `moveend`
// and the whole retry branch is unreachable there.
test.describe('the outstanding wait belongs to the newest view', () => {
  /** A slot plus the bookkeeping these cases assert on. */
  function harness() {
    const map = fakeMap();
    const slot: { current: (() => void) | null } = { current: null };
    let generation = 0;
    const woke: number[] = [];
    return {
      map,
      slot,
      woke,
      get generation() {
        return generation;
      },
      /** One refresh that found the style not ready. */
      ask() {
        const mine = ++generation;
        askStyleWait(
          slot,
          (fire) => retryOnEvent(map, fire),
          mine,
          () => generation,
          () => {},
          () => woke.push(mine),
        );
        return mine;
      },
      listeners: () => map.count('idle') + map.count('styledata'),
    };
  }

  test('🔴 a second ask replaces the first instead of riding on it', () => {
    const h = harness();
    h.ask(); // generation 1, style not ready
    h.ask(); // generation 2, style still not ready

    expect(h.listeners(), 'both asks left listeners behind').toBe(2);

    h.map.fire('styledata');

    // The old code woke generation 1, which found 1 !== 2 and returned,
    // leaving nothing registered: a map that never draws its circles.
    expect(h.woke, 'the newest view was never woken').toEqual([2]);
    expect(h.slot.current, 'the slot still holds a spent wait').toBe(null);
    expect(h.listeners(), 'a listener outlived the wake-up').toBe(0);
  });

  test('…and three in a row leave exactly one, the last', () => {
    const h = harness();
    h.ask();
    h.ask();
    h.ask();
    expect(h.listeners()).toBe(2); // idle + styledata, one ask's worth
    h.map.fire('idle');
    expect(h.woke).toEqual([3]);
  });

  test('…and a single ask still wakes, which is the ordinary case', () => {
    const h = harness();
    h.ask();
    h.map.fire('idle');
    expect(h.woke).toEqual([1]);
    expect(h.listeners()).toBe(0);
  });

  test('…and a wait whose view is gone does not drag the map back', () => {
    // The reason the generation check exists: `refresh` can yield between
    // stamping its generation and reaching the registration, so an event
    // can still find a wait that belongs to nobody.
    const map = fakeMap();
    const slot: { current: (() => void) | null } = { current: null };
    let generation = 1;
    let woke = 0;
    askStyleWait(
      slot,
      (fire) => retryOnEvent(map, fire),
      1,
      () => generation,
      () => {},
      () => {
        woke += 1;
      },
    );
    generation = 2; // a newer refresh started and has not reached here yet
    map.fire('idle');
    expect(woke, 'a stale wait re-entered refresh').toBe(0);
    expect(slot.current, 'the stale wait stayed in the slot').toBe(null);
    expect(map.count('idle'), 'the stale listener was left behind').toBe(0);
  });

  test('…and the fire path reports itself before deciding', () => {
    // `say()` writes the DOM diagnostic and must run whether or not the
    // generation matches — otherwise `awaiting-style=yes` sticks on a
    // wait that has already been spent, which is how the ORIGINAL bug
    // in this file read in CI.
    const map = fakeMap();
    const slot: { current: (() => void) | null } = { current: null };
    const said: boolean[] = [];
    askStyleWait(
      slot,
      (fire) => retryOnEvent(map, fire),
      1,
      () => 99, // never matches
      () => said.push(slot.current !== null),
      () => {},
    );
    map.fire('idle');
    expect(said, 'the diagnostic did not run on a stale wake-up').toEqual([false]);
  });
});
