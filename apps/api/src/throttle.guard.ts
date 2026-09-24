import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BUILD_TOKEN_HEADER, clientKey, isExempt } from './throttle';

/**
 * CAMP-69: the throttler, told who the caller is and who is exempt.
 *
 * 🔴 Two overrides, both of which are the difference between a limit
 * that protects us and a limit that hurts us:
 *
 *   getTracker    behind Cloudflare every request arrives from
 *                 Cloudflare, so the default (the socket address) would
 *                 count all of Europe as one caller and 429 the seventh
 *                 reader. See clientKey.
 *
 *   shouldSkip    the build asks for 9 830 campsites in about two
 *                 minutes. Without this it is throttled, and because
 *                 getSpot returns null rather than throwing, the result
 *                 is a build that exits 0 with most of the site missing.
 *                 See isExempt.
 *
 * The decisions themselves are in throttle.ts, as pure functions, so
 * they can be tested without booting Nest or faking a request.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const socket = (req.ip as string) ?? 'unknown';
    return clientKey(headers, socket);
  }

  protected async shouldSkip(context: {
    switchToHttp: () => { getRequest: () => Record<string, unknown> };
  }): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const token = headers[BUILD_TOKEN_HEADER];
    const path = ((req.path ?? req.url) as string) ?? '';
    return isExempt(path, typeof token === 'string' ? token : null);
  }
}
