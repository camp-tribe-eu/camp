import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizeIp } from '@nestjs/throttler/dist/ip';
import {
  BUILD_TOKEN_HEADER,
  clientKey,
  isBulkPath,
  isExempt,
} from './throttle';

/**
 * CAMP-69: the throttler, told who the caller is and who is exempt.
 *
 * 🔴 Three overrides. The first version had two and both were wrong in
 * ways CI could not see — an adversarial review found them by measuring
 * against the running API, which is the only reason they are right now.
 *
 *   getTracker    who the request is counted against. Behind Cloudflare
 *                 the socket address is Cloudflare's, so all of Europe
 *                 would share one bucket. See clientKey — and note that
 *                 the IPv6 masking below is NOT optional.
 *
 *   generateKey   which bucket that caller lands in. The library's own
 *                 key includes the route handler, which means the
 *                 "120 a minute" in throttle.ts was per route: one
 *                 address measured 120 on /spots/countries, then another
 *                 120 on /spots/summary, and so on across eleven routes
 *                 — over a thousand a minute against a documented
 *                 hundred and twenty. Now there are exactly two buckets
 *                 per caller: the expensive routes, and everything else.
 *
 *   shouldSkip    the build asks for 9 830 campsites in about two
 *                 minutes. Without this it is throttled, and because
 *                 getSpot returns null rather than throwing, the result
 *                 is a build that exits 0 with most of the site missing.
 *
 * The decisions themselves are pure functions in throttle.ts, so they
 * can be tested without booting Nest or faking a request.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const socket = (req.ip as string) ?? 'unknown';
    // 🔴 normalizeIp, from the library, and not by hand. It masks IPv6 to
    // a /64 — the reason being that a single residential line is routed a
    // whole /64, so without it one visitor is 18 quintillion callers.
    // Measured before the fix: twelve addresses inside one /64 got twelve
    // 200s on a route that allows six. IPv4 passes through untouched.
    return normalizeIp(clientKey(headers, socket));
  }

  /**
   * 🔴 Two buckets per caller, not one per route.
   *
   * `suffix` is already the tracker string from getTracker. The base
   * implementation prepends the controller and handler names, which is a
   * sensible default for an API where every route costs the same — and
   * wrong for ours, where three routes answer with the entire dataset
   * and the rest answer with one row.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const path = ((req.path ?? req.url) as string) ?? '';
    return `${name}:${isBulkPath(path) ? 'bulk' : 'ordinary'}:${suffix}`;
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const token = headers[BUILD_TOKEN_HEADER];
    const path = ((req.path ?? req.url) as string) ?? '';
    return isExempt(path, typeof token === 'string' ? token : null);
  }
}
