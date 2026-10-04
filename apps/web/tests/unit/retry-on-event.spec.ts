import { expect, test } from '@playwright/test';
import { RETRY_EVENTS, retryOnEvent } from '@/lib/retry-on-event';

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

  test('…and runs on either event that can mean the style moved', () => {
    for (const event of RETRY_EVENTS) {
      const map = fakeMap();
      let ran = 0;
      retryOnEvent(map, () => {
        ran += 1;
      });
      map.fire(event);
      expect(ran, `"${event}" did not reach the attempt`).toBe(1);
    }
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
