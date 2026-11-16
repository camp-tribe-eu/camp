import { paintSmoothOverlay, type DroughtOverlay, type DroughtState } from './drought';

/** A worker that never answers must not leave the layer blank for ever. */
export const WORKER_TIMEOUT_MS = 20_000;

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

/**
 * CAMP-530: the smoothed picture, painted in a worker, with the plain
 * synchronous painter as the way out.
 *
 * 🔴 EVERY WAY THE WORKER CAN FAIL ENDS IN THE SAME PICTURE, drawn on this
 * thread: the constructor throwing (no Worker, a CSP that refuses the file),
 * an `error` event (the chunk 404s, the module does not parse), an answer that
 * is not a picture, and silence for `WORKER_TIMEOUT_MS`. A slower layer is
 * better than no layer, and a missing one reads as an all-clear.
 */
export function paintOffThread(
  state: Extract<DroughtState, { kind: 'current' }>,
  makeWorker: () => WorkerLike,
  timeoutMs: number = WORKER_TIMEOUT_MS,
  sync: typeof paintSmoothOverlay = paintSmoothOverlay,
): Promise<DroughtOverlay> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: WorkerLike | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      worker?.terminate();
    };
    const fallBack = () => {
      if (settled) return;
      finish();
      try {
        resolve(sync(state));
      } catch (e) {
        reject(e);
      }
    };
    try {
      worker = makeWorker();
      worker.onerror = fallBack;
      worker.onmessageerror = fallBack;
      worker.onmessage = (e) => {
        if (settled) return;
        const d = e.data as {
          ok?: boolean;
          width?: number;
          height?: number;
          coordinates?: DroughtOverlay['coordinates'];
          buffer?: ArrayBuffer;
        };
        if (
          !d?.ok ||
          !d.buffer ||
          !d.coordinates ||
          !d.width ||
          !d.height ||
          d.buffer.byteLength !== d.width * d.height * 4
        ) {
          fallBack();
          return;
        }
        finish();
        resolve({
          width: d.width,
          height: d.height,
          coordinates: d.coordinates,
          data: new Uint8ClampedArray(d.buffer),
        });
      };
      timer = setTimeout(fallBack, timeoutMs);
      worker.postMessage({ meta: state.meta, cdi: state.cdi, domain: state.domain });
    } catch {
      fallBack();
    }
  });
}
