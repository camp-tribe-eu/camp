// CAMP-190 — fresh webcam frame addresses, asked of Windy on demand and
// kept for LESS than they live.
//
// 🔴 WHY THIS EXISTS, in the order it was learned.
//
// 1. Windy's Webcams API terms: «Use images only with URLs provided by
//    the API.» The agreement lists «image URL usage other than provided
//    by the API» among the misuses that end the service. The page used to
//    BUILD the address from the camera id, which is that.
//
// 2. So the address has to be the one the API returned. But the pages are
//    static and read for days, and Windy answered us in writing
//    (Markéta Pešková, Community Support, 02.11.2026):
//
//      «image URLs in the Free plan are valid for only 15 minutes, so
//       they need to be refreshed accordingly»
//
//    An address stored in the page, or in our database, is therefore a
//    broken picture within the quarter hour — or it is an address that
//    keeps working only because Windy has not yet enforced what they
//    wrote. We MEASURED the latter (02.11.2026: 20 of 20 addresses
//    answered 200 at once, 40 of 40 after 11.2 minutes, 40 of 40 after
//    36.2 minutes, no 401, no token in the address). That is behaviour,
//    not a promise, and it can change on any day without notice. A rule
//    stated by the provider outranks a behaviour we observed, and a
//    permission we hold in writing is not one to build on by relying on a
//    different clause of the same text being unenforced.
//
// 3. So: the browser asks us when the reader reaches the panel, we ask
//    Windy with our key, and the answer is cached for less than 15 min.
//
// 🔴 TWO MORE FACTS FROM THE SAME LETTER, KEPT HERE BECAUSE THEY BIND THE
// PRODUCT AND NOT ONLY THIS FILE.
//
//   · Donations are allowed «provided that access to the webcams remains
//     freely available to all visitors». The webcams may therefore never
//     go behind a payment or a registration. That is a constraint on what
//     we may build, not on how.
//
//   · The statement of January 2021 that the API was «for testing only»
//     is outdated: «The statement from January 2021 is outdated in the
//     context of our current Webcams API offering».
//
// 🔴 AND THE LIMIT THAT STAYS: Windy's «restrictions against excessive
// automated requests». The numbers below exist for that. See the bound in
// `WINDY_CALLS_PER_PAGE_HOUR` and the ceiling in `MAX_WINDY_CALLS_PER_MINUTE`.

/**
 * How long Windy says an image address is good for on the Free plan.
 * Their letter, 02.11.2026: «valid for only 15 minutes».
 */
export const WINDY_URL_VALID_MS = 15 * 60_000;

/**
 * 🔴 HOW LONG WE KEEP A FRAME ADDRESS — TEN MINUTES, NOT FIFTEEN.
 *
 * The address a reader receives is up to this old, and the browser then
 * needs time to fetch the picture. Ten leaves five minutes of margin for
 * that and for clock skew; fifteen would hand out an address that is
 * already dead. `frames.spec.ts` fails if this reaches
 * `WINDY_URL_VALID_MS`, and proves it by running the cache against a
 * clock rather than by comparing two constants.
 */
export const FRAME_CACHE_MS = 10 * 60_000;

/**
 * How long a failed answer from Windy is remembered, so that a refusal
 * or an outage is not retried by every reader. Measured need, not taste:
 * the collector's own first dry run took HTTP 429 on the sixth request,
 * and retrying into a closed door is how a rate limit becomes a ban.
 */
export const FAILURE_BACKOFF_MS = 60_000;

/**
 * 🔴 THE CEILING ON WHAT WE EVER ASK OF WINDY, per minute, for this
 * process, whatever the traffic.
 *
 * Windy's Free plan answers `x-ratelimit-limit: 300` per 60 s
 * (measured 02.11.2026). Thirty is a tenth of that and 1 800 an hour.
 * A page cannot make us exceed it: past it the endpoint answers 429 and
 * the page keeps its captions and its link to Windy, without a picture.
 */
export const MAX_WINDY_CALLS_PER_MINUTE = 30;

/**
 * The most a SINGLE campsite page can cost Windy per hour.
 *
 * A reader's request for a page's cameras makes ONE call to Windy for
 * all of them, and that call makes every one of them fresh for ten
 * minutes. The page cannot cause another call until they expire, so
 * `3 600 000 / FRAME_CACHE_MS` = 6 an hour, however many readers it has.
 * True for a page whose cameras are ALL live, and equally for one with
 * cameras that have no frame or that Windy no longer lists — those are
 * cached as answers too (see `Entry`). Derived, not typed: `frames.spec.ts`
 * simulates the hour and counts, for a page of live, frameless and absent
 * cameras together.
 */
export const WINDY_CALLS_PER_PAGE_HOUR = 3_600_000 / FRAME_CACHE_MS;

/** The same limit the page's list shows (`WEBCAM_LIMIT` in nearby.ts). */
export const MAX_REFS_PER_REQUEST = 3;

/**
 * The one host a frame may be served from: the one the page's CSP
 * `img-src` names. An address on any other host is refused here, so the
 * API can never hand the browser something the CSP would block or
 * something that is not Windy's.
 */
export const FRAME_HOST = 'imgproxy.windy.com';

export const WINDY_API = 'https://api.windy.com/webcams/api/v3/webcams';

/** `ref` is Windy's numeric `webcamId`, as a string. Nothing else is asked. */
export const REF_PATTERN = /^[0-9]{1,20}$/;

/**
 * The refs a caller asked for, or null when the request is malformed.
 *
 * 🔴 Strict, because these go into a URL that carries OUR key. Digits
 * only, at most three, no duplicates silently collapsed into a smaller
 * request than was asked.
 */
export function parseRefs(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 80)
    return null;
  const refs = raw.split(',');
  if (refs.length > MAX_REFS_PER_REQUEST) return null;
  if (!refs.every((r) => REF_PATTERN.test(r))) return null;
  if (new Set(refs).size !== refs.length) return null;
  return refs;
}

/** The list call for these cameras, asking for their images and nothing else. */
export function windyUrl(refs: string[]): string {
  if (refs.length === 0 || !refs.every((r) => REF_PATTERN.test(r))) {
    throw new Error('windyUrl wants one to three numeric refs');
  }
  return `${WINDY_API}?webcamIds=${refs.join(',')}&limit=${refs.length}&include=images`;
}

/**
 * One camera's `images.daylight.preview` exactly as Windy returned it, or
 * null. Accepted or refused whole: https, our one frame host, no
 * credentials. Never built, never normalised.
 */
export function frameAddress(input: unknown): string | null {
  const u = (input as { images?: { daylight?: { preview?: unknown } } } | null)
    ?.images?.daylight?.preview;
  if (typeof u !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== FRAME_HOST)
    return null;
  if (parsed.username || parsed.password) return null;
  return u;
}

/**
 * The frames in a Windy list answer, keyed by the ref WE asked for.
 *
 * 🔴 By `webcamId`, not by position: the list is not promised in the
 * order of the ids, and a picture under the wrong camera's caption is
 * worse than none. A camera Windy did not return, or returned without a
 * usable address, is simply absent.
 */
export function framesFrom(
  body: unknown,
  asked: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = (body as { webcams?: unknown } | null)?.webcams;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const id = (row as { webcamId?: unknown } | null)?.webcamId;
    const ref =
      typeof id === 'number' || typeof id === 'string' ? String(id) : '';
    if (!asked.includes(ref)) continue;
    const url = frameAddress(row);
    if (url) out[ref] = url;
  }
  return out;
}

export interface FrameDeps {
  /** Milliseconds, injectable so a test can move the clock. */
  now: () => number;
  /** Windy's list call. Receives the URL; the key travels in a header. */
  callWindy: (
    url: string,
  ) => Promise<{ status: number; json: () => Promise<unknown> }>;
  /** Which of these refs we hold in `webcams`. Only those are ever asked of Windy. */
  known: (refs: string[]) => Promise<string[]>;
}

export class FramesRefused extends Error {
  constructor(
    readonly status: 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What we know about ONE camera, and when we learned it.
 *
 * 🔴 `url: null` IS AN ANSWER, NOT AN ABSENCE. "Windy has no frame for
 * this camera" and "Windy no longer lists it" are things Windy told us,
 * and they live for FRAME_CACHE_MS exactly like a frame does. The first
 * version cached only cameras that HAD a frame, so a page with one dead
 * camera among three could never be "all fresh" and every reader's
 * request went to Windy: measured by review, 360 calls an hour instead of
 * 6. Cameras go dark, change status and vanish all the time — which is
 * why we store only their ids — so this is the normal case, not an edge.
 */
interface Entry {
  url: string | null;
  at: number;
}

/**
 * The cache and the rules around it. Pure but for the three injected
 * dependencies, so every rule is tested against a clock.
 */
export class FrameCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<
    string,
    Promise<Record<string, string>>
  >();
  /**
   * When Windy last failed us — ONE pause for all of Windy, not one per
   * set of cameras and not one per camera.
   *
   * 🔴 Keyed by the sorted list of refs, this pause was bypassed by
   * rotating a second ref: `A,x`, `A,y`, `A,z` are three different keys
   * and each one called Windy while Windy was refusing — thirty times a
   * minute at the ceiling, which is the "excessive automated requests"
   * the written terms keep. A failure (a 429, a 5xx, a timeout) is a fact
   * about Windy, not about which cameras happened to be in the list, so
   * the pause is global: during it NO call is made, whatever is asked.
   * Cost of a failure to the rest of the site: one minute without new
   * frames, and nothing worse. Cost of the alternative, measured: up to
   * 30 calls into a closed door every minute.
   */
  private pausedAt: number | null = null;
  private callTimes: number[] = [];
  /** Total calls made to Windy, for tests and for the log line. */
  calls = 0;

  constructor(private readonly deps: FrameDeps) {}

  /** `undefined` = nothing fresh known; `null` = fresh "no frame". */
  private fresh(ref: string, now: number): string | null | undefined {
    const e = this.entries.get(ref);
    // 🔴 `<`, not `<=`: at exactly FRAME_CACHE_MS the address is old.
    return e && now - e.at < FRAME_CACHE_MS ? e.url : undefined;
  }

  async frames(refs: string[]): Promise<Record<string, string>> {
    // 🔴 FIRST, drop what we do not hold. A ref that is not in `webcams`
    // never reaches the cache, the pause or the ceiling, so a caller who
    // pads a real ref with invented ids spends nothing but their own
    // request — see the per-reader limit in throttle.ts for that part.
    const held = await this.deps.known(refs);
    if (held.length === 0) return {};

    const now = this.deps.now();
    const out: Record<string, string> = {};
    let needCall = false;
    for (const r of held) {
      const u = this.fresh(r, now);
      if (typeof u === 'string') out[r] = u;
      else if (u === undefined) needCall = true;
    }
    if (!needCall) return out;

    const key = [...held].sort().join(',');
    const running = this.inFlight.get(key);
    if (running) return running;

    const p = this.refresh(held).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  /**
   * ONE call for every camera asked about, including those still fresh.
   *
   * 🔴 All of them, not only the missing ones: that is what makes the
   * per-page bound hold. After this call every camera this page shows is
   * ten minutes young — frame or no frame — so the page cannot trigger
   * another call before they expire, whatever other pages did to some of
   * them in between.
   */
  private async refresh(held: string[]): Promise<Record<string, string>> {
    const now = this.deps.now();
    if (this.pausedAt !== null && now - this.pausedAt < FAILURE_BACKOFF_MS) {
      throw new FramesRefused(
        503,
        'the camera provider is not being asked just now',
      );
    }
    const wanted = held;

    this.callTimes = this.callTimes.filter((t) => now - t < 60_000);
    if (this.callTimes.length >= MAX_WINDY_CALLS_PER_MINUTE) {
      throw new FramesRefused(
        429,
        'too many frame requests to the camera provider just now',
      );
    }
    this.callTimes.push(now);
    this.calls += 1;

    const fail = (message: string): never => {
      this.pausedAt = now;
      throw new FramesRefused(503, message);
    };

    let res: Awaited<ReturnType<FrameDeps['callWindy']>>;
    try {
      res = await this.deps.callWindy(windyUrl(wanted));
    } catch {
      return fail('the camera provider did not answer');
    }
    if (res.status !== 200) {
      return fail(`the camera provider answered ${res.status}`);
    }
    const got = framesFrom(await res.json(), wanted);
    const at = this.deps.now();
    // Every camera asked about gets an entry: its frame, or `null`.
    for (const r of wanted) {
      this.entries.set(r, { url: got[r] ?? null, at });
    }
    this.prune(at);
    const out: Record<string, string> = {};
    for (const r of held) {
      const u = this.fresh(r, at);
      if (typeof u === 'string') out[r] = u;
    }
    return out;
  }

  /** Drop what has expired, so the maps cannot grow without bound. */
  private prune(now: number): void {
    if (this.entries.size < 1000) return;
    for (const [ref, e] of this.entries)
      if (now - e.at >= FRAME_CACHE_MS) this.entries.delete(ref);
  }
}
