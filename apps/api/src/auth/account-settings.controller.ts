import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LOGIN_LIMIT, MAIL_LIMIT } from '../throttle';
import {
  AccountService,
  BadEmail,
  MailUnavailable,
  SameEmail,
  TooSoon,
  WeakPassword,
} from './account.service';
import { NoSuchAccount, WrongPassword } from './account-rights.service';
import { AuthService } from './auth.service';
import { CurrentViewer } from './current-viewer.decorator';
import type { Viewer } from './ownership';
import { PASSWORD_MESSAGE } from './password-policy';

const LOGIN = { default: LOGIN_LIMIT };
const MAIL = { default: MAIL_LIMIT };

/** The one body every refusal for "not signed in" gets, as in `GET /auth/me`. */
const NO_SESSION = {
  code: 'no_session',
  message: 'You are not signed in.',
} as const;

/**
 * Налаштування акаунта. CAMP-229.
 *
 * 🔴 ТРИ РОЗДІЛИ, А НЕ ЧОТИРИ, І ЦЕ РІШЕННЯ, А НЕ НЕДОРОБКА. Картка називає
 * чотири: пошта, пароль, мова й одиниці, листи. Перші три тут є. «Мови й
 * одиниць» немає ніде в продукті: ні колонки в `users`, ні коду, що читав
 * би таку настройку, ні другої мови. Перемикач, який нічого не перемикає, —
 * це обіцянка, яку інтерфейс дає, а продукт не виконує; саме такі мертві
 * елементи ця картка й знайшла в сусідніх місцях. Зʼявиться те, що читає
 * настройку, — зʼявиться й вона.
 *
 * 🔴 КОЖЕН МАРШРУТ, ЩО МІНЯЄ ОБЛІКОВІ ДАНІ, ПИТАЄ ПАРОЛЬ ЩЕ РАЗ. Сесія
 * доводить, що хтось увійшов колись; пароль доводить, що це та сама людина
 * зараз. Без цього кроку вкрадений токен однієї вкладки дозволяв би перевести
 * акаунт на чужу адресу — тобто забрати його назавжди.
 *
 * Жоден маршрут не читає ідентифікатора з запиту: міняється завжди акаунт
 * того, хто звернувся. Питання «чи можу я змінити чужу пошту» тут просто
 * немає на чому поставити.
 */
@Controller('account')
export class AccountSettingsController {
  constructor(
    private readonly accounts: AccountService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Що показати на сторінці налаштувань.
   *
   * 🔴 `no-store` І НА 401 ТЕЖ, як у `GET /auth/me`: це приватні дані однієї
   * людини, і спільний кеш, що їх затримав би, віддав би їх наступному, хто
   * спитає ту саму адресу з іншим токеном.
   *
   * Повертає СТАН, а не історію: чи ввімкнені листи — так або ні. Момент
   * згоди лишається в базі (він знадобиться, якщо спитають, коли її дали),
   * але сторінці нема що з ним робити, а поле, якого тут немає, не може
   * витекти.
   */
  @Get('settings')
  @Header('Cache-Control', 'no-store')
  async settings(@CurrentViewer() viewer: Viewer) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const profile = await this.auth.profile(viewer.id);
    if (!profile) throw new UnauthorizedException(NO_SESSION);
    const letters = await this.accounts.letters(viewer.id);
    return { ...profile, letters };
  }

  /**
   * Новий пароль.
   *
   * 🔴 ВІДПОВІДЬ НЕСЕ НОВИЙ ТОКЕН, і це не зручність, а наслідок рішення в
   * сервісі: зміна пароля вбиває ВСІ сесії, включно з цією. Без нового
   * токена сторінка викинула б людину на /login рівно за те, що вона
   * зробила все правильно.
   *
   * 🔴 403 НА ХИБНИЙ ПАРОЛЬ, НЕ 401. Той, хто звернувся, УВІЙШОВ; 401 тут
   * прочитався б сторінкою як «сесія скінчилась» і відправив би її на
   * /login посеред зміни пароля. Те саме рішення, що й у `account/delete`.
   */
  @Post('password')
  @Throttle(LOGIN)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async password(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    if (typeof b.currentPassword !== 'string' || b.currentPassword === '')
      throw new HttpException(
        {
          code: 'password_required',
          message: 'Enter your current password to confirm.',
        },
        400,
      );
    try {
      const session = await this.accounts.changePassword(
        viewer.id,
        b.currentPassword,
        b.newPassword,
      );
      return { token: session.token, expiresAt: session.expiresAt };
    } catch (e) {
      throw httpForSettings(e);
    }
  }

  /**
   * Перевести акаунт на іншу адресу.
   *
   * 🔴 202, А НЕ 200: нічого ще не змінилось. Адреса переїде лише тоді, коли
   * хтось відкриє посилання з листа, надісланого НА НЕЇ. Відповідь однакова
   * і для вільної адреси, і для зайнятої — інакше ця форма стала б оракулом
   * перелічення, який ми закрили у формах відновлення.
   */
  @Post('email')
  @Throttle(MAIL)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async email(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    if (typeof b.password !== 'string' || b.password === '')
      throw new HttpException(
        {
          code: 'password_required',
          message: 'Enter your password to confirm.',
        },
        400,
      );
    try {
      await this.accounts.requestEmailChange(viewer.id, b.password, b.email);
      return {
        status: 'sent',
        message:
          'If that address can receive letters, a confirmation is on its way to it. Nothing changes until it is opened.',
      };
    } catch (e) {
      throw httpForSettings(e);
    }
  }

  /**
   * Листи про новини: увімкнути чи вимкнути.
   *
   * Єдиний маршрут тут, що НЕ питає пароля, і навмисно: ввімкнена чи
   * вимкнена розсилка нікому не дає доступу, а зайвий пароль привчав би
   * вводити його там, де він не потрібен.
   */
  @Post('letters')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async letters(@CurrentViewer() viewer: Viewer, @Body() body: unknown) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    try {
      const on = await this.accounts.setLetters(viewer.id, b.letters);
      return { letters: on };
    } catch (e) {
      throw httpForSettings(e);
    }
  }
}

/**
 * Одна помилка — одна відповідь, і нічого з цього не знає про HTTP вище.
 *
 * 🔴 `NoSuchAccount` ТУТ — ЦЕ 401, А НЕ 404. Він означає лише одне: сесія
 * вказує на акаунт, якого більше немає (його видалили в іншій вкладці).
 * Сторінці треба відправити людину на вхід, а не показати «не знайдено».
 */
function httpForSettings(e: unknown): unknown {
  if (e instanceof WrongPassword)
    return new HttpException(
      {
        code: 'wrong_password',
        message: 'That password is not right. Nothing was changed.',
      },
      403,
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
  if (e instanceof BadEmail)
    return new HttpException(
      {
        code: 'bad_email',
        message: 'That does not look like an email address.',
      },
      400,
    );
  if (e instanceof SameEmail)
    return new HttpException(
      {
        code: 'same_email',
        message: 'That is already the address on this account.',
      },
      400,
    );
  if (e instanceof TooSoon)
    return new HttpException(
      {
        code: 'too_soon',
        retryAfter: e.retryAfterSec,
        message:
          'A letter was sent a moment ago. Please wait before asking again.',
      },
      429,
    );
  if (e instanceof MailUnavailable)
    return new HttpException(
      {
        code: 'mail_unavailable',
        message:
          'We cannot send letters right now, so the address was not changed.',
      },
      503,
    );
  if (e instanceof NoSuchAccount) return new UnauthorizedException(NO_SESSION);
  return e;
}
