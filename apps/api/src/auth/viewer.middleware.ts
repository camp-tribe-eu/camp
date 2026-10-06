import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Viewer } from './ownership';
import { parseBearer } from './session';

/** The request, once this has run. */
export type WithViewer = Request & { viewer?: Viewer };

/**
 * Turns a bearer token into a Viewer on the request.
 *
 * 🔴 MIDDLEWARE, NOT A GUARD, and the distinction is the point. This
 * NEVER rejects: a missing, malformed or expired token leaves
 * `viewer = null` and the request continues. Deciding what a null viewer
 * may have belongs to `denyReason`, in one place, which is what makes
 * 401-vs-403 answerable at all.
 *
 * A guard here would have to choose between rejecting anonymous callers
 * (breaking every public route) or always returning true (a guard that
 * guards nothing). Neither is honest.
 */
@Injectable()
export class ViewerMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: WithViewer, _res: Response, next: NextFunction) {
    // 🔴 A failure to resolve is anonymous, not a 500. A database blip
    // must not turn a public page into an error — and an endpoint that
    // throws on a malformed token is an endpoint that can be probed.
    try {
      req.viewer = await this.auth.resolveViewer(
        parseBearer(req.headers.authorization),
      );
    } catch {
      req.viewer = null;
    }
    next();
  }
}
