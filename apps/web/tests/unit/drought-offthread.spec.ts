import { expect, test } from "@playwright/test";
import { PaintAborted, paintOffThread, type WorkerLike } from "@/lib/drought-offthread";
import type { DroughtOverlay, DroughtState } from "@/lib/drought";

// CAMP-530 — the drought picture painted in a worker. The painter itself is
// held by drought-overlay.spec.ts; what is held HERE is the hand-over: the
// buffer is used as it arrives, and every way the worker can fail ends in the
// same picture drawn on this thread, never in no picture.

const STATE = {
  kind: "current",
  meta: {},
  daysOld: 0,
  cdi: new Uint8Array(1),
  domain: new Uint8Array(1),
} as unknown as Extract<DroughtState, { kind: "current" }>;

const COORDS: DroughtOverlay["coordinates"] = [[0, 1], [1, 1], [1, 0], [0, 0]];
const SYNC_PICTURE: DroughtOverlay = {
  width: 1,
  height: 1,
  coordinates: COORDS,
  data: new Uint8ClampedArray([9, 9, 9, 9]),
};

function fake() {
  const w = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: 0,
    posted: [] as unknown[],
    postMessage(m: unknown) {
      w.posted.push(m);
    },
    terminate() {
      w.terminated++;
    },
  } as WorkerLike & { terminated: number; posted: unknown[] };
  return w;
}

function counted() {
  let calls = 0;
  return {
    fn: () => {
      calls++;
      return SYNC_PICTURE;
    },
    calls: () => calls,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const picture = (w: WorkerLike) =>
  w.onmessage!({
    data: { ok: true, width: 2, height: 1, coordinates: COORDS, buffer: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer },
  });

function abortable() {
  const fns: Array<() => void> = [];
  const signal = {
    aborted: false,
    addEventListener: (_t: "abort", fn: () => void) => {
      fns.push(fn);
    },
  };
  return {
    signal,
    abort: () => {
      signal.aborted = true;
      fns.forEach((f) => f());
    },
  };
}

test.describe("paintOffThread", () => {
  test("the worker's buffer is used as it arrives, with no copy and no work on this thread", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn });
    w.onmessage!({ data: { started: true } });
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    w.onmessage!({ data: { ok: true, width: 2, height: 1, coordinates: COORDS, buffer } });
    const { overlay: o, painter } = await p;
    expect(painter).toBe("worker");
    expect(o.width).toBe(2);
    expect(Array.from(o.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(o.data.buffer, "the same ArrayBuffer, not a copy").toBe(buffer);
    expect(sync.calls()).toBe(0);
    expect(w.terminated).toBe(1);
    expect(Object.keys(w.posted[0] as object).sort()).toEqual(["cdi", "domain", "meta"]);
  });

  test("🔴 no Worker at all (the constructor throws): painted here, and said so", async () => {
    // Mutation: drop the `catch` around `makeWorker()` — this rejects and fails.
    const sync = counted();
    const r = await paintOffThread(STATE, () => { throw new Error("no Worker"); }, { sync: sync.fn });
    expect(r.overlay).toBe(SYNC_PICTURE);
    expect(r.painter).toBe("main");
    expect(sync.calls()).toBe(1);
  });

  test("🔴 the worker file fails to load (error event): painted here, once", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn });
    w.onerror!({});
    w.onerror!({});
    expect((await p).painter).toBe("main");
    expect(sync.calls()).toBe(1);
    expect(w.terminated).toBe(1);
  });

  test("🔴 a message the page cannot deserialise (messageerror): painted here", async () => {
    // Mutation: drop `worker.onmessageerror = …` — nothing answers and this times out.
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn, startTimeoutMs: 5000 });
    expect(w.onmessageerror, "the handler is installed").toBeTruthy();
    w.onmessageerror!({});
    const r = await Promise.race([p, sleep(500).then(() => "hung" as const)]);
    expect(r).not.toBe("hung");
    expect((r as { painter: string }).painter).toBe("main");
    expect(sync.calls()).toBe(1);
  });

  test("🔴 an answer that is not a picture of the size it claims is not drawn", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn });
    w.onmessage!({ data: { ok: true, width: 2, height: 2, coordinates: COORDS, buffer: new ArrayBuffer(8) } });
    expect((await p).overlay).toBe(SYNC_PICTURE);
    const w2 = fake();
    const p2 = paintOffThread(STATE, () => w2, { sync: sync.fn });
    w2.onmessage!({ data: { ok: false } });
    expect((await p2).overlay).toBe(SYNC_PICTURE);
  });

  test("🔴 a worker that never STARTS is given up on after the timeout: painted here, painter 'timeout'", async () => {
    // Mutation: drop the start timeout — this never resolves and the test times out.
    const w = fake();
    const sync = counted();
    const r = await paintOffThread(STATE, () => w, { sync: sync.fn, startTimeoutMs: 30 });
    expect(r.painter).toBe("timeout");
    expect(r.overlay).toBe(SYNC_PICTURE);
    expect(w.terminated).toBe(1);
    picture(w); // a late answer changes nothing
    expect(sync.calls()).toBe(1);
  });

  test("🔴 a worker that HAS started is never killed for being slow: it is waited for", async () => {
    // Mutation: keep the timer running after `started` — the worker is
    // terminated at 30 ms, the sync painter runs, and this fails.
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn, startTimeoutMs: 30 });
    w.onmessage!({ data: { started: true } });
    await sleep(120);
    expect(w.terminated, "a live worker is not terminated").toBe(0);
    expect(sync.calls(), "and nothing is painted on this thread meanwhile").toBe(0);
    picture(w);
    const r = await p;
    expect(r.painter).toBe("worker");
    expect(sync.calls()).toBe(0);
  });

  test("a worker that started and then errors is still painted here", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn, startTimeoutMs: 30 });
    w.onmessage!({ data: { started: true } });
    w.onerror!({});
    expect((await p).painter).toBe("main");
  });

  test("🔴 the page goes away while the worker works: the worker is terminated and nothing is painted anywhere", async () => {
    // Mutation: ignore the signal — the worker lives on, and a later answer
    // or fallback paints for a page that is gone.
    const w = fake();
    const sync = counted();
    const a = abortable();
    const p = paintOffThread(STATE, () => w, { sync: sync.fn, signal: a.signal, startTimeoutMs: 30 });
    w.onmessage!({ data: { started: true } });
    a.abort();
    await expect(p).rejects.toBeInstanceOf(PaintAborted);
    expect(w.terminated).toBe(1);
    await sleep(60);
    expect(sync.calls(), "no synchronous build on another page").toBe(0);
  });

  test("a page that is already gone does not even start a worker", async () => {
    const a = abortable();
    a.abort();
    let made = 0;
    await expect(
      paintOffThread(STATE, () => { made++; return fake(); }, { signal: a.signal }),
    ).rejects.toBeInstanceOf(PaintAborted);
    expect(made).toBe(0);
  });
});
