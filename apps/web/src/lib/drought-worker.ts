// CAMP-530 — the drought picture's painter, run off the main thread.
//
// 🔴 The picture is 2560 × 2662 pixels and the vote, the lone-cell filter and
// the blur take 0.4-0.7 s on a laptop: on a phone that would freeze the page
// for seconds, once, the moment the layer is switched on. The work is the
// SAME pure function the unit tests hold (`paintSmoothOverlay`); this file only
// carries the state in and the finished picture out, as a transferable
// buffer (no 27 MB copy).
import { paintSmoothOverlay, type DroughtMeta } from './drought';

interface Job {
  meta: DroughtMeta;
  cdi: Uint8Array;
  domain: Uint8Array;
}

const scope = self as unknown as {
  onmessage: ((e: { data: Job }) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

// 🔴 Said as soon as this file has loaded and run, before any job: the page
// uses it to tell "the worker did not start" (give up after a timeout) from
// "the worker is busy" (wait for it; a live worker is never killed for being slow).
scope.postMessage({ started: true });

scope.onmessage = (e) => {
  try {
    const { meta, cdi, domain } = e.data;
    const o = paintSmoothOverlay({ kind: 'current', meta, daysOld: 0, cdi, domain });
    scope.postMessage(
      { ok: true, width: o.width, height: o.height, coordinates: o.coordinates, buffer: o.data.buffer },
      [o.data.buffer],
    );
  } catch {
    scope.postMessage({ ok: false });
  }
};
