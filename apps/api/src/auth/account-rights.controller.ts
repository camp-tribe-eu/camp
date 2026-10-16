import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { LOGIN_LIMIT } from '../throttle';
import { parseDeleteRequest } from './account-deletion';
import {
  AccountRightsService,
  NoSuchAccount,
  WrongPassword,
} from './account-rights.service';
import { CurrentViewer } from './current-viewer.decorator';
import type { Viewer } from './ownership';

const LOGIN = { default: LOGIN_LIMIT };

/** The one body every refusal for "not signed in" gets, as in `GET /auth/me`. */
const NO_SESSION = {
  code: 'no_session',
  message: 'You are not signed in.',
} as const;

/** What the page may say for each way a deletion request can be refused. */
const REFUSAL_MESSAGE = {
  photo_choice_required:
    'Choose what happens to your photos. We do not choose for you.',
  confirmation_required:
    'Confirm that you understand how the thirty days work.',
  password_required: 'Enter your password to confirm.',
} as const;

/**
 * The two rights an account owes its owner. CAMP-229, part 3 of 3.
 *
 * 🔴 EVERY ROUTE HERE ANSWERS 401 TO A CALLER WHO IS NOBODY, with the same body
 * and before it reads anything else, and none reads an id from the request:
 * what is exported or deleted is ALWAYS the viewer's own account. There is no
 * `:id` to put somebody else's in, which is what makes "can I export a
 * stranger's data" a question with no route to ask it on.
 */
@Controller('account')
export class AccountRightsController {
  constructor(private readonly rights: AccountRightsService) {}

  /**
   * Ask for an archive of everything we hold (Art. 15).
   *
   * 202: the archive is made AFTER this answer, and the body says "preparing".
   * Asking while one is already being made returns that one.
   */
  @Post('export')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async requestExport(@CurrentViewer() viewer: Viewer) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    return this.rights.requestExport(viewer.id);
  }

  /** Where the archive stands: none, preparing, ready (with its expiry) or failed. */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async exportStatus(@CurrentViewer() viewer: Viewer) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    return this.rights.exportStatus(viewer.id);
  }

  /**
   * The archive itself, as a JSON file.
   *
   * 404 for "none, still being made, failed, expired" alike: there is no file
   * to give in any of them, and the status route is where to ask which.
   *
   * 🔴 `Content-Disposition: attachment` AND `nosniff`. The file is a person's
   * data that nobody should ever see rendered in a tab at our origin, and a
   * body that a browser might sniff as something else is a body that might run.
   */
  @Get('export/file')
  async exportFile(
    @CurrentViewer() viewer: Viewer,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const file = await this.rights.exportFile(viewer.id);
    if (!file)
      throw new HttpException(
        { code: 'no_export', message: 'There is no archive to download.' },
        404,
      );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return file.body;
  }

  /**
   * Delete the account (Art. 17).
   *
   * 🔴 `@Throttle(LOGIN)`, AND `account/delete` IS IN `LOGIN_ROUTES`. This route
   * checks a password, so it is a place to GUESS one: with a stolen session token
   * and the default of 120 a minute it would be the cheapest guessing endpoint we
   * have. It shares sign-in's ten a minute, and `throttle.spec.ts` compares this
   * decorator with that list in both directions.
   *
   * 🔴 BODY: `{ password, photos, understood }`, ALL THREE REQUIRED, none with a
   * default. See `parseDeleteRequest`. A missing `photos` is a 400, not a guess.
   *
   * 200 with the last day the account can be restored. Access has already ended
   * by the time this answers: the token that made the request is dead.
   */
  @Post('delete')
  @Throttle(LOGIN)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async delete(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const parsed = parseDeleteRequest(body);
    if (parsed.kind === 'refused')
      throw new HttpException(
        { code: parsed.why, message: REFUSAL_MESSAGE[parsed.why] },
        400,
      );
    try {
      const out = await this.rights.deleteAccount(viewer.id, parsed.value);
      return {
        deleted: true,
        restorableUntil: out.restorableUntil.toISOString(),
      };
    } catch (e) {
      // 🔴 403, NOT 401. The caller IS signed in; a 401 here would read, on the
      // page, as "your session is gone" and throw them to /login in the middle
      // of confirming a deletion.
      if (e instanceof WrongPassword)
        throw new HttpException(
          {
            code: 'wrong_password',
            message: 'That password is not right. Nothing was deleted.',
          },
          403,
        );
      // A session whose account has vanished is a session nobody holds.
      if (e instanceof NoSuchAccount)
        throw new UnauthorizedException(NO_SESSION);
      throw e;
    }
  }
}
