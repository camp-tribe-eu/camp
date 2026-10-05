import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LOGIN_LIMIT } from '../throttle';
import { parseBearer } from './session';
import type { WithViewer } from './viewer.middleware';

const LOGIN = { default: LOGIN_LIMIT };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Sign in.
   *
   * 🔴 `@Throttle(LOGIN)` is not optional decoration. The API's default
   * is 120 a minute, which on this one route means 120 password guesses
   * a minute against one account. The number and its limits are argued
   * in throttle.ts; `auth.spec.ts` reads THIS FILE and fails if the
   * decorator goes missing, because CAMP-176 showed that a limit kept
   * only in a decorator, or only in a list, drifts out of agreement
   * with the other and nothing notices.
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
