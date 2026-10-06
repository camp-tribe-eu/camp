import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Viewer } from './ownership';
import type { WithViewer } from './viewer.middleware';

/**
 * The signed-in account, or null.
 *
 * 🔴 Defaults to null rather than undefined. `denyReason` treats a
 * falsy viewer as anonymous either way, but a route reached before the
 * middleware ran would otherwise hand it `undefined` — and "the
 * middleware was not wired up" must look like "nobody is signed in",
 * never like a viewer that passes a truthiness check.
 */
export const CurrentViewer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Viewer =>
    ctx.switchToHttp().getRequest<WithViewer>().viewer ?? null,
);
