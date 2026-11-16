import { expect, test } from "@playwright/test";
import { paintOffThread, type WorkerLike } from "@/lib/drought-offthread";
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

test.describe("paintOffThread", () => {
  test("the worker's buffer is used as it arrives, with no copy and no work on this thread", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, 1000, sync.fn);
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    w.onmessage!({ data: { ok: true, width: 2, height: 1, coordinates: COORDS, buffer } });
    const o = await p;
    expect(o.width).toBe(2);
    expect(Array.from(o.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(o.data.buffer, "the same ArrayBuffer, not a copy").toBe(buffer);
    expect(sync.calls()).toBe(0);
    expect(w.terminated).toBe(1);
    expect(w.posted).toHaveLength(1);
  });

  test("🔴 no Worker at all (the constructor throws): the picture is painted here", async () => {
    // Mutation: drop the `catch` around `makeWorker()` — this rejects and fails.
    const sync = counted();
    const o = await paintOffThread(STATE, () => { throw new Error("no Worker"); }, 1000, sync.fn);
    expect(o).toBe(SYNC_PICTURE);
    expect(sync.calls()).toBe(1);
  });

  test("🔴 the worker file fails to load (error event): the picture is painted here, once", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, 1000, sync.fn);
    w.onerror!({});
    w.onerror!({});
    expect(await p).toBe(SYNC_PICTURE);
    expect(sync.calls()).toBe(1);
    expect(w.terminated).toBe(1);
  });

  test("🔴 an answer that is not a picture of the size it claims is not drawn", async () => {
    const w = fake();
    const sync = counted();
    const p = paintOffThread(STATE, () => w, 1000, sync.fn);
    w.onmessage!({ data: { ok: true, width: 2, height: 2, coordinates: COORDS, buffer: new ArrayBuffer(8) } });
    expect(await p).toBe(SYNC_PICTURE);
    const w2 = fake();
    const p2 = paintOffThread(STATE, () => w2, 1000, sync.fn);
    w2.onmessage!({ data: { ok: false } });
    expect(await p2).toBe(SYNC_PICTURE);
  });

  test("🔴 a worker that never answers does not leave the layer blank", async () => {
    // Mutation: drop the timeout — this never resolves and the test times out.
    const w = fake();
    const sync = counted();
    const o = await paintOffThread(STATE, () => w, 30, sync.fn);
    expect(o).toBe(SYNC_PICTURE);
    expect(w.terminated).toBe(1);
    // A late answer after the fallback changes nothing.
    w.onmessage!({ data: { ok: true, width: 1, height: 1, coordinates: COORDS, buffer: new ArrayBuffer(4) } });
    expect(sync.calls()).toBe(1);
  });

  test("the state goes to the worker as plain buffers: meta, cdi, domain", async () => {
    const w = fake();
    const p = paintOffThread(STATE, () => w, 20, counted().fn);
    await p;
    expect(Object.keys(w.posted[0] as object).sort()).toEqual(["cdi", "domain", "meta"]);
  });
});
