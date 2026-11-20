import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MAIL_LIMIT } from '../throttle';
import {
  parseLinkAction,
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

function invalidLink(): HttpException {
  return new HttpException(
    {
      code: 'invalid_link',
      message: 'This link has expired, was already used, or is not valid.',
    },
    400,
  );
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
 *   POST /newsletter/confirm      { "token": "…" }   200 { ok: true } | 400 { code: 'invalid_link' }
 *   POST /newsletter/unsubscribe  { "token": "…" }   те саме
 *
 * 🔴 ЦЕ POST, А НЕ GET, І ЦЕ НЕ СМАК. Посилання в листі веде на СТОРІНКУ сайту
 * (`/newsletter/confirm?token=…`), яка на відкритті нічого не міняє, а кнопка на
 * ній шле сюди токен ТІЛОМ. Поштові сканери (Safe Links, проксі Gmail,
 * корпоративні шлюзи) відкривають усі посилання з листа самі: стан, що
 * міняється на GET, підтверджував би підписку без людини — і «згода» не
 * доводила б нічого (ст. 6(1)(a)) — а так само сканер відписував би людей.
 * GET-маршрутів тут немає зовсім: `GET /newsletter/confirm` — 404.
 * Токен у тілі, а не в адресі: адресу пише журнал вебсервера, тіло — ні.
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

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() body: unknown): Promise<{ ok: true }> {
    const parsed = parseLinkAction(body);
    if (parsed.ok === false || !(await this.newsletter.confirm(parsed.token)))
      throw invalidLink();
    return { ok: true };
  }

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Body() body: unknown): Promise<{ ok: true }> {
    const parsed = parseLinkAction(body);
    if (
      parsed.ok === false ||
      !(await this.newsletter.unsubscribe(parsed.token))
    )
      throw invalidLink();
    return { ok: true };
  }
}
