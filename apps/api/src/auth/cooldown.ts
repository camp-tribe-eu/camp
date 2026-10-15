import { createHash } from 'node:crypto';

/**
 * "You may ask for another letter in 60 seconds" (CAMP-228, decision 4).
 *
 * 🔴 THE COUNTER IS AGAINST US, NOT AGAINST PEOPLE. Without it the form is a
 * way to bury somebody else's mailbox in our letters, and then it is
 * *we* who look like the spammer and our domain that lands on the blacklists.
 *
 * 🔴 KEYED BY THE ADDRESS, NEVER BY THE ACCOUNT. This is what keeps the
 * counter from becoming the existence oracle the card forbids: if the clock
 * were started by "a letter was actually sent", then asking twice would be
 * refused for an address we know and accepted for one we do not, and the
 * second request would tell the caller which is which. Here the first
 * request for an address starts the clock whether or not an account exists
 * behind it, so the second is refused identically for both.
 *
 * 🔴 THE KEY IS THE ADDRESS AS SPELLED, so it paces an address and not a
 * mailbox: `victim+1@gmail.com` and `victim+2@gmail.com` have a clock each and
 * reach the same inbox. The bound on a mailbox is the per-caller `mail` bucket
 * in throttle.ts, nothing here. Folding `+tags` and dots would change who can
 * register, which is the owner's decision.
 *
 * 🔴 AND A REFUSED REQUEST DOES NOT RESTART IT. Otherwise a person pressing
 * the button every ten seconds would never see it come back.
 *
 * In memory, per process — the same limit `throttle.ts` states for the rate
 * limiter, for the same reason: today there is one API process. The day there
 * are two, this allows twice as many letters, and that is written here rather
 * than discovered. A restart forgets every clock, which an outsider cannot
 * cause. It holds a digest of the address, not the address, so a heap dump or
 * a stack trace of this object is not a list of the people who asked.
 */
export type Take = { ok: true } | { ok: false; retryAfterSec: number };

export class Cooldown {
  /**
   * Digest → when it was last allowed. Insertion order is time order, as long
   * as the clock does not step back; if it does, an expired entry can sit
   * behind a live one until the front clears, which wastes a little memory
   * (bounded by `maxKeys`) and decides nothing: `take` reads its own key
   * directly.
   */
  private readonly last = new Map<string, number>();

  /** The one statement of "still waiting", used by `take` AND the sweep. */
  private live(at: number, now: number): boolean {
    return now - at < this.windowMs;
  }

  constructor(
    private readonly windowMs: number,
    /**
     * A hard ceiling on remembered keys. The rate limiter already caps how
     * many a caller can add, so this is the belt for a botnet: when it is
     * reached the OLDEST key is forgotten, which lets one address be asked
     * for early — a far smaller harm than refusing everyone.
     */
    private readonly maxKeys = 100_000,
  ) {}

  get size(): number {
    return this.last.size;
  }

  take(key: string, now: Date): Take {
    const t = now.getTime();
    this.sweep(t);

    const digest = createHash('sha256').update(key, 'utf8').digest('hex');
    const previous = this.last.get(digest);
    // At exactly `windowMs` it is allowed again: "in 60 seconds" must not
    // mean "in 60 seconds and a millisecond". `live` is the only place that
    // boundary is written, so there is one line to get wrong, not two.
    if (previous !== undefined && this.live(previous, t)) {
      return {
        ok: false,
        retryAfterSec: Math.ceil((previous + this.windowMs - t) / 1000),
      };
    }

    this.last.set(digest, t);
    while (this.last.size > this.maxKeys) {
      const oldest = this.last.keys().next().value as string;
      this.last.delete(oldest);
    }
    return { ok: true };
  }

  /** Drop everything that has expired. Cheap: it stops at the first live key. */
  private sweep(t: number): void {
    for (const [key, at] of this.last) {
      if (this.live(at, t)) break;
      this.last.delete(key);
    }
  }
}
