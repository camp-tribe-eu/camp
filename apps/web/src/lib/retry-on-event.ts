// CAMP-175 — where a deferred redraw is allowed to be scheduled.
//
// 🔴 ITS OWN FILE BECAUSE THE WRONG ANSWER FREEZES THE TAB, AND NO TEST
// WE HAD COULD SEE IT.
//
// The map must try to draw its region circles, and try again if the
// style has not finished loading. Two things make that harder than it
// sounds, and I got both wrong in one evening:
//
//   `once('idle')`  waits for a transition that has already happened —
//                   the deferral is registered at the end of a
//                   `moveend`, which is exactly when the map settles.
//                   The circles then never arrive.
//
//   `queueMicrotask` is worse. The retry re-enters `refresh`, which
//                   calls back here, which queues another microtask.
//                   Microtasks queued from inside a microtask drain in
//                   the SAME checkpoint, so the main thread never
//                   returns to the event loop — and a style can only
//                   finish loading from a task. Measured: 200 001
//                   re-entries without yielding, and the style's own
//                   callback never ran. The tab is gone.
//
// 🔴 AND CI WAS GREEN THROUGHOUT. The map specs stub the style
// (`EMPTY_STYLE`, fulfilled from a route handler), so by the time they
// assert anything the style is loaded, the first draw succeeds and this
// path is never taken. The freeze was reachable only on a real page
// load against a real style — which is to say, on every reader's
// machine and on none of ours.
//
// So the rule is one sentence: a retry waits for an EVENT, and is never
// run from the call that registers it.

/** The slice of a MapLibre map this needs. Kept tiny so a test can pass a double. */
export interface RetryTarget {
  on(type: string, listener: () => void): unknown;
  off(type: string, listener: () => void): unknown;
}

/**
 * Both events that can mean "the style moved".
 *
 * `styledata` fires as the style and its pieces arrive; `idle` fires
 * when the map has nothing left in flight. Either may be the one that
 * comes, so both are listened for and whichever arrives first wins.
 */
export const RETRY_EVENTS = ['idle', 'styledata'] as const;

/**
 * Run `attempt` the next time the map stirs, and not before.
 *
 * Returns a function that unregisters, so the caller can stop waiting
 * when the work is no longer wanted.
 *
 * 🔴 It deliberately does NOT call `attempt` itself. The "what if the
 * style became ready between the check and the registration" race that
 * tempted me into `queueMicrotask` does not exist here: the caller has
 * already TRIED the draw and been told to wait, so there is nothing to
 * catch up on, and `styledata` will fire when the style arrives.
 */
export function retryOnEvent(map: RetryTarget, attempt: () => void): () => void {
  const off = () => {
    for (const event of RETRY_EVENTS) map.off(event, attempt);
  };
  for (const event of RETRY_EVENTS) map.on(event, attempt);
  return off;
}
