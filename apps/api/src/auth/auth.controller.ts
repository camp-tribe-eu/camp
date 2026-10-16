import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AccountService,
  BadEmail,
  EmailTaken,
  MailUnavailable,
  StaleLink,
  TooSoon,
  WeakPassword,
} from './account.service';
import { AuthService } from './auth.service';
import { LOGIN_LIMIT, MAIL_LIMIT } from '../throttle';
import { CurrentViewer } from './current-viewer.decorator';
import type { Viewer } from './ownership';
import { parseBearer } from './session';
import type { WithViewer } from './viewer.middleware';

const LOGIN = { default: LOGIN_LIMIT };
const MAIL = { default: MAIL_LIMIT };

/** What the page may say for each way a new password can be refused. */
const PASSWORD_MESSAGE = {
  'too-short': 'Use at least 10 characters.',
  'too-long': 'Use at most 128 characters.',
  common: 'That password is on the list of the most common ones. Pick another.',
  'is-email': 'The password must not be your email address.',
} as const;

/**
 * One HTTP answer per domain error — and ONE body shape, `{ code, message }`,
 * so a page can branch on `code` and never on prose.
 *
 * 🔴 `TooSoon` carries the wait in the BODY as well as in `Retry-After`: the
 * site is on another origin, and a browser hides every response header that
 * is not CORS-exposed, so a header alone would give the page nothing to
 * count down from.
 */
function httpFor(e: unknown, res?: Response): unknown {
  if (e instanceof BadEmail)
    return new HttpException(
      {
        code: 'bad_email',
        message: 'That does not look like an email address.',
      },
      400,
    );
  if (e instanceof WeakPassword)
    return new HttpException(
      {
        code: 'weak_password',
        reason: e.problem,
        message: PASSWORD_MESSAGE[e.problem],
      },
      400,
    );
  if (e instanceof EmailTaken)
    return new HttpException(
      {
        code: 'email_taken',
        message:
          'An account with this email already exists. Sign in, or reset the password.',
      },
      409,
    );
  if (e instanceof StaleLink)
    return new HttpException(
      {
        code: 'link_stale',
        message: 'This link has expired or has already been used.',
      },
      410,
    );
  if (e instanceof MailUnavailable)
    return new HttpException(
      {
        code: 'mail_unavailable',
        message:
          'We cannot send email at the moment, so this is switched off. Nothing was saved.',
      },
      503,
    );
  if (e instanceof TooSoon) {
    res?.setHeader('Retry-After', String(e.retryAfterSec));
    return new HttpException(
      {
        code: 'too_soon',
        retryAfter: e.retryAfterSec,
        message: `A letter was sent a moment ago. You can ask again in ${e.retryAfterSec} seconds.`,
      },
      429,
    );
  }
  return e;
}

/** The body of every "we will send it if there is anything to send" answer. */
const ACCEPTED = { accepted: true } as const;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  /**
   * Sign in.
   *
   * 🔴 `@Throttle(LOGIN)` is not optional decoration. The API's default
   * is 120 a minute, which on this one route means 120 password guesses
   * a minute against one account. The number and its limits are argued
   * in throttle.ts; `throttle.spec.ts` reads THIS FILE and compares the
   * decorator with `LOGIN_ROUTES` in both directions, because CAMP-176
   * showed that a limit kept only in a decorator, or only in a list,
   * drifts out of agreement with the other and nothing notices.
   *
   * 🔴 200, not 201. A POST that creates a session is not creating a
   * resource the caller can address, and an explicit code is one less
   * thing for a client to guess.
   */
  @Post('login')
  @Throttle(LOGIN)
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown>) {
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    // 🔴 Empty credentials are refused before scrypt is asked anything.
    // `verifyPassword('')` is a guaranteed false, so spending 200 ms on
    // it would make the empty-password request a free way to hold a
    // worker busy.
    if (email === '' || password === '')
      throw new UnauthorizedException(FAILED);

    const session = await this.auth.signIn(email, password);
    // 🔴 ONE sentence for both "no such account" and "wrong password".
    // Anything that tells them apart turns this form into a test for
    // whether an address is registered with us.
    if (!session) throw new UnauthorizedException(FAILED);
    return { token: session.token, expiresAt: session.expiresAt.toISOString() };
  }

  /**
   * Create an account. CAMP-228.
   *
   * 🔴 THE BODY HAS NO "TERMS" FIELD AND NO WAY TO SAY "NO" TO THEM. The
   * basis is the contract (GDPR 6(1)(b)): without it there is no account, so
   * a checkbox would offer a choice that does not exist. The only optional
   * thing the form can say is `newsletter`, and it counts only as a literal
   * `true` — see `AccountService.signUp`.
   *
   * 201: an account is a resource. The reply is a session, so the person is
   * signed in, and `emailVerified: false` is what the page reads to say
   * "your route is saved; confirm your email when you like".
   */
  @Post('signup')
  @Throttle(MAIL)
  @HttpCode(201)
  async signUp(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const out = await this.account.signUp({
        email: body?.email,
        password: body?.password,
        newsletter: body?.newsletter,
      });
      return {
        token: out.token,
        expiresAt: out.expiresAt.toISOString(),
        email: out.email,
        emailVerified: out.emailVerified,
      };
    } catch (e) {
      throw httpFor(e, res);
    }
  }

  /**
   * Forgot password.
   *
   * 🔴 202 AND `{ accepted: true }` FOR EVERY ADDRESS THAT PASSES THE SHAPE
   * CHECK — registered, unregistered, confirmed, not. Same status, same
   * bytes, and (by `AccountService.requestLink`) the same wait. The page says
   * "if an account with that address exists, we have sent a link", which is
   * the only sentence that is true in both cases.
   */
  @Post('forgot')
  @Throttle(MAIL)
  @HttpCode(202)
  async forgot(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.account.requestReset(body?.email);
    } catch (e) {
      throw httpFor(e, res);
    }
    return ACCEPTED;
  }

  /** Send the confirmation letter again. Uniform, like `forgot`. */
  @Post('resend-verification')
  @Throttle(MAIL)
  @HttpCode(202)
  async resendVerification(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.account.requestVerification(body?.email);
    } catch (e) {
      throw httpFor(e, res);
    }
    return ACCEPTED;
  }

  /**
   * Confirm the address behind a link.
   *
   * POST, never GET: a mail client's link scanner fetches every URL in a
   * letter, and a GET that spent the token would be spent before the person
   * saw the letter. The page reads the token from its own address and posts it.
   */
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: Record<string, unknown>) {
    try {
      await this.account.verifyEmail(body?.token);
    } catch (e) {
      throw httpFor(e);
    }
    return { verified: true };
  }

  /** Set a new password with a reset link. 204: nothing to return, and no session. */
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: Record<string, unknown>) {
    try {
      await this.account.resetPassword(body?.token, body?.password);
    } catch (e) {
      throw httpFor(e);
    }
  }

  /**
   * Who is signed in. CAMP-229.
   *
   * 🔴 401, NEVER 200 WITH AN EMPTY OBJECT. The account page decides between
   * "show the cabinet" and "send to /login" on this status alone, and an
   * empty 200 is a status that reads as success. Every way a caller can fail
   * to be somebody — no header, a malformed one, a token nobody issued, an
   * expired one, a signed-out one, an account that no longer exists — reaches
   * the same answer by the same line: `viewer` is null, or `profile` is.
   * That is also why one body serves them all: a different message for
   * "expired" and "unknown" is a way to learn whether a guessed token was ever
   * real.
   *
   * 🔴 `no-store`, on the 401 as well as the 200. This answer is one person's
   * private data, and a shared cache that kept it would hand it to the next
   * caller who asked the same URL with a different — or no — token. The
   * header is set before the handler runs, so it rides on the refusal too;
   * `account.db.spec.ts` reads it off both.
   *
   * Throttled with everything ordinary (120 a minute): the page calls it once
   * per visit, and the lookup is one indexed read. It must NOT sit in the
   * login bucket, where a few page loads would eat the budget for guessing
   * passwords; `throttle.spec.ts` pins the bucket.
   */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@CurrentViewer() viewer: Viewer) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const profile = await this.auth.profile(viewer.id);
    if (!profile) throw new UnauthorizedException(NO_SESSION);
    return profile;
  }

  /**
   * Sign out this session.
   *
   * 🔴 204 whether or not the token was real. A logout that answers
   * differently for a valid and an invalid token is an oracle for
   * guessing valid ones.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: WithViewer) {
    await this.auth.signOut(parseBearer(req.headers.authorization));
  }
}

/** The single sentence every failed sign-in gets. */
const FAILED = 'Email or password is wrong.';

/**
 * The one body every refusal of `GET /auth/me` gets, in the `{ code, message }`
 * shape the rest of this controller uses so a page can branch on `code`.
 */
const NO_SESSION = {
  code: 'no_session',
  message: 'You are not signed in.',
} as const;
