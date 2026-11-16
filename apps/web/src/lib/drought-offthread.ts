import { paintSmoothOverlay, type DroughtOverlay, type DroughtState } from './drought';

/** How long a worker has to START (load and run its file). Not how long it may paint. */
export const WORKER_START_TIMEOUT_MS = 20_000;

/** Which path painted the picture; the map prints it as `data-drought-painter`. */
export type Painter = 'worker' | 'main' | 'timeout';

export interface WorkerLike {
  // Parameter types are `any`-shaped on purpose: the real `Worker` and a test's fake both fit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessage: ((e: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((e: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessageerror?: ((e: any) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
}

export interface OffThreadOptions {
  startTimeoutMs?: number;
  sync?: typeof paintSmoothOverlay;
  /** Aborted when the page that asked is gone: the worker is terminated, nothing is painted anywhere. */
  signal?: { aborted: boolean; addEventListener: (type: 'abort', fn: () => void) => void };
}

export class PaintAborted extends Error {
  constructor() {
    super('the drought picture was abandoned');
  }
}

/**
 * CAMP-530: the smoothed picture, painted in a worker, with the plain
 * synchronous painter as the way out.
 *
 * 🔴 EVERY WAY THE WORKER CAN FAIL ENDS IN THE SAME PICTURE, drawn on this
 * thread: the constructor throwing (no Worker, a CSP that refuses the file),
 * an `error` or `messageerror` event, an answer that is not a picture, and a
 * worker that has not STARTED within `startTimeoutMs`. A slower layer is
 * better than no layer, and a missing one reads as an all-clear.
 *
 * 🔴 A WORKER THAT HAS STARTED IS NOT KILLED FOR BEING SLOW. It says `started`
 * the moment its file has run; from then the page waits for the picture or an
 * error, however long a slow phone takes, because killing a live worker would
 * start the same work again on the main thread — the freeze the worker is for.
 *
 * 🔴 `signal` is the page going away. Then nothing is painted anywhere: no
 * synchronous fallback on a page the reader has left.
 */
export function paintOffThread(
  state: Extract<DroughtState, { kind: 'current' }>,
  makeWorker: () => WorkerLike,
  opts: OffThreadOptions = {},
): Promise<{ overlay: DroughtOverlay; painter: Painter }> {
  const { startTimeoutMs = WORKER_START_TIMEOUT_MS, sync = paintSmoothOverlay, signal } = opts;
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: WorkerLike | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      worker?.terminate();
    };
    const fallBack = (painter: Painter) => {
      if (settled) return;
      finish();
      try {
        resolve({ overlay: sync(state), painter });
      } catch (e) {
        reject(e);
      }
    };
    if (signal?.aborted) {
      settled = true;
      reject(new PaintAborted());
      return;
    }
    signal?.addEventListener('abort', () => {
      if (settled) return;
      finish();
      reject(new PaintAborted());
    });
    try {
      worker = makeWorker();
      worker.onerror = () => fallBack('main');
      worker.onmessageerror = () => fallBack('main');
      worker.onmessage = (e) => {
        if (settled) return;
        const d = e.data as {
          started?: boolean;
          ok?: boolean;
          width?: number;
          height?: number;
          coordinates?: DroughtOverlay['coordinates'];
          buffer?: ArrayBuffer;
        };
        if (d?.started) {
          // Alive: from here the timeout no longer applies.
          if (timer) clearTimeout(timer);
          timer = undefined;
          return;
        }
        if (
          !d?.ok ||
          !d.buffer ||
          !d.coordinates ||
          !d.width ||
          !d.height ||
          d.buffer.byteLength !== d.width * d.height * 4
        ) {
          fallBack('main');
          return;
        }
        finish();
        resolve({
          overlay: {
            width: d.width,
            height: d.height,
            coordinates: d.coordinates,
            data: new Uint8ClampedArray(d.buffer),
          },
          painter: 'worker',
        });
      };
      timer = setTimeout(() => fallBack('timeout'), startTimeoutMs);
      worker.postMessage({ meta: state.meta, cdi: state.cdi, domain: state.domain });
    } catch {
      fallBack('main');
    }
  });
}
