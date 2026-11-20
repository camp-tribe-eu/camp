import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { webBaseFrom } from '../auth/mail';
import { MAIL_LIMIT } from '../throttle';
import {
  isTokenShaped,
  parseSubscription,
  type NewsletterProblem,
} from './newsletter.rules';
import { NewsletterService } from './newsletter.service';

// 🔴 The MAIL bucket: what this route costs is a LETTER from our domain to an
// address the caller typed (see contact.controller.ts, same reasoning).
// `MAIL_ROUTES` in throttle.ts sets the counter; throttle.spec.ts reads this
// file to check the two agree (the CAMP-176 comparison).
const MAIL = { default: MAIL_LIMIT };

function invalid(problems: NewsletterProblem[]): HttpException {
  return new HttpException(
    {
      code: 'invalid_subscription',
      message:
        problems.length === 1
          ? problems[0].message
          : `${problems.length} things are wrong with this request; see \`errors\`.`,
      errors: problems,
    },
    400,
  );
}

/**
 * Куди веде сторінка результату: сайт, з налаштувань, ніколи із запиту.
 * Без `WEB_BASE_URL` перенаправляти нікуди — 503, а не відносна адреса, яка
 * вказала б на сам API.
 */
function resultUrl(page: 'confirmed' | 'unsubscribed' | 'link-invalid') {
  const base = webBaseFrom(process.env.WEB_BASE_URL);
  if (base === null) {
    throw new HttpException(
      { code: 'site_unconfigured', message: 'WEB_BASE_URL is not set.' },
      503,
    );
  }
  return { url: `${base}/newsletter/${page}`, statusCode: 302 };
}

/**
 * Підписка на листи CampTribe з подвійним підтвердженням (CAMP-441/7).
 *
 *   POST /newsletter  { "email": "…", "leaveBlank": "", "elapsedMs": 8123 }
 *
 *   200 { ok: true }                 ЗАВЖДИ ТАКА Ж, чи адреса нова, чи чекає, чи
 *                                    вже підтверджена, чи це скрипт: відповідь не
 *                                    розкриває, хто в нашому списку
 *   400 { code: 'invalid_subscription', errors: [...] }   адреса не адреса
 *   429                              відро `mail` вичерпане
 *   503 { code: 'mail_unavailable' } немає відправника (залежить лише від
 *                                    налаштувань, тож однакова для всіх адрес)
 *
 *   GET /newsletter/confirm?token=…      → 302 на /newsletter/confirmed
 *   GET /newsletter/unsubscribe?token=…  → 302 на /newsletter/unsubscribed
 *   обидва: невідомий чи прострочений токен → 302 на /newsletter/link-invalid
 *
 * 🔴 ВІДКРИТО ДЛЯ КОГО ЗАВГОДНО, і мусить бути: підписується не власник акаунта.
 * Жодної куки, жодного акаунта, жодного IP у таблиці.
 */
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Post()
  @HttpCode(200)
  @Throttle(MAIL)
  async subscribe(@Body() body: unknown): Promise<{ ok: true }> {
    const parsed = parseSubscription(body);
    // `=== false`, not `!ok`: this package builds without strictNullChecks.
    if (parsed.ok === false) throw invalid(parsed.problems);
    const { outcome } = await this.newsletter.subscribe(parsed.subscription);
    if (outcome === 'unavailable') {
      throw new HttpException(
        {
          code: 'mail_unavailable',
          message: 'We could not send the confirmation letter just now.',
        },
        503,
      );
    }
    // 🔴 `delivery` навмисно не чекаємо — інакше час відповіді розрізняє «лист
    // пішов» і «адреса вже підтверджена».
    return { ok: true };
  }

  @Get('confirm')
  @Redirect()
  async confirm(@Query('token') token: unknown) {
    const ok = isTokenShaped(token) && (await this.newsletter.confirm(token));
    return resultUrl(ok ? 'confirmed' : 'link-invalid');
  }

  @Get('unsubscribe')
  @Redirect()
  async unsubscribe(@Query('token') token: unknown) {
    const ok =
      isTokenShaped(token) && (await this.newsletter.unsubscribe(token));
    return resultUrl(ok ? 'unsubscribed' : 'link-invalid');
  }
}
