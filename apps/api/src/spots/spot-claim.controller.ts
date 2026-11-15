import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentViewer } from '../auth/current-viewer.decorator';
import type { Viewer } from '../auth/ownership';
import { MAIL_LIMIT } from '../throttle';
import { LINK_TTL_MS } from './owner-email';
import { MAX_ATTEMPTS, PER_SPOT_PER_DAY, PER_USER_PER_DAY } from './spot-claim';
import { SpotClaimService } from './spot-claim.service';

const MAIL = { default: MAIL_LIMIT };

const NO_SESSION = {
  code: 'no_session',
  message: 'Sign in first — a claim belongs to an account.',
} as const;

/**
 * 🔴 КОЖНА ВІДМОВА — СВІЙ КОД І СВОЇ СЛОВА, І ЦЕ НЕ ВВІЧЛИВІСТЬ.
 *
 * Людина, що натрапила на межу, і людина, у кемпінга якої немає адреси в
 * OSM, мають зробити РІЗНЕ. Одна відповідь на всіх лишила б обох без
 * наступного кроку — і ми б дізнались про це з листа «у вас не працює».
 *
 * Але «немає заявки» і «чужа заявка» навмисно однакові: різниця між ними
 * розповідала б, за які листинги вже взялись.
 */
const REFUSAL: Record<
  string,
  { status: number; code: string; message: string }
> = {
  'no-spot': {
    status: 404,
    code: 'no_spot',
    message: 'No campsite with that address.',
  },
  'no-email': {
    status: 422,
    code: 'no_email',
    message:
      'This place has no public email in OpenStreetMap, so there is nowhere to send a code. Adding one to OSM is the way in.',
  },
  'already-claimed': {
    status: 409,
    code: 'already_claimed',
    message: 'Someone has already confirmed this listing.',
  },
  'spot-flooded': {
    status: 429,
    code: 'spot_flooded',
    message: `This place has had ${PER_SPOT_PER_DAY} code letters in a day. Try tomorrow.`,
  },
  'user-flooded': {
    status: 429,
    code: 'user_flooded',
    message: `You have asked for ${PER_USER_PER_DAY} codes in a day. Try tomorrow.`,
  },
  'bad-email': {
    status: 400,
    code: 'bad_email',
    message: 'That does not look like an email address.',
  },
  'mail-unavailable': {
    status: 503,
    code: 'mail_unavailable',
    message: 'We cannot send letters right now. Nothing was recorded.',
  },
  'no-pending': {
    status: 404,
    code: 'no_pending',
    message: 'No code is waiting for this place on your account.',
  },
  expired: {
    status: 410,
    code: 'expired',
    message: 'That code has expired. Ask for a new one.',
  },
  burned: {
    status: 429,
    code: 'burned',
    message: `That code was typed wrong ${MAX_ATTEMPTS} times and no longer works. Ask for a new one.`,
  },
  'wrong-code': {
    status: 400,
    code: 'wrong_code',
    message: 'That code does not match.',
  },
};

/**
 * 🔴 ОДНЕ РЕЧЕННЯ НА ВСІ ВИПАДКИ, і воно чесне про обидва кінці: якщо
 * адреса підійшла — лист іде; якщо листа немає, автоматично підтвердити
 * не вдалося, і поруч названо, куди писати. Різниця між «підійшла» і «не
 * підійшла» тут не видна навмисно.
 */
export const OWNER_LINK_ACCEPTED = `If that address belongs to this campsite, a letter with a link is on its way and works for ${Math.round(LINK_TTL_MS / 60_000)} minutes. If nothing arrives within a few minutes, we could not confirm you automatically — write to hello@camptribe.eu.`;

export const LINK_INVALID =
  'This link does not work: it has been used, it has expired, or it was started from another account. Start again from the campsite page.';

/**
 * 🔴 `res.ok === false`, А НЕ `!res.ok`, І ЦЕ НЕ СТИЛЬ.
 *
 * `apps/api/tsconfig.json` має `strictNullChecks: false`. Без нього
 * звуження розрізнюваного об'єднання за ІСТИННІСТЮ не спрацьовує:
 * `if (!res.ok) refuse(res.why)` компілятор відхилив словами «Property
 * 'why' does not exist on type StartResult». Явне порівняння з літералом
 * звужує й там. Заміряно на цьому ж файлі, обидві форми.
 */
function refuse(why: string): never {
  const r = REFUSAL[why];
  // Невідома причина — це наш дефект, а не 500 без сліду.
  if (!r) throw new HttpException({ code: 'refused', message: why }, 400);
  throw new HttpException({ code: r.code, message: r.message }, r.status);
}

/**
 * «Claim your listing». CAMP-51.
 *
 * Два кроки й жодного посилання в листі: код іде на публічну адресу
 * кемпінгу з тегів OSM, а вводиться тут, у вже відкритому акаунті.
 *
 * 🔴 ЧОМУ `spot-claims`, А НЕ `spots/:slug/claim`. ЦЕ CAMP-176 ЗНОВУ.
 *
 * Перша редакція мала параметр у шляху — і `throttle.spec.ts` це зловив.
 * `bucketFor()` звіряє шлях із переліком ТОЧНОЮ рівністю, тож
 * `spots/alpenblick/claim` не збігся б із жодним рядком: запит дістав би
 * ЧИСЛО з MAIL_LIMIT, а відро — `ordinary`. Рівно той дефект, що
 * описаний у `throttle.ts`: ліміт на вході, якого насправді немає.
 *
 * Вчити матчер розбирати `:param` означало б правити спільний,
 * безпековий шматок заради одного маршруту. Дешевше й чесніше —
 * літеральний шлях, а slug у тілі POST, де йому й місце.
 */
@Controller('spot-claims')
export class SpotClaimController {
  constructor(private readonly claims: SpotClaimService) {}

  @Post()
  @HttpCode(202)
  @Throttle(MAIL)
  async start(
    @CurrentViewer() viewer: Viewer,
    @Body() body: { slug?: unknown },
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    const res = await this.claims.start(slug, viewer.id);
    if (res.ok === false) refuse(res.why);
    // 🔴 Назовні йде МАСКА. Повна адреса лишається в тегах OSM, звідки
    // взята: інакше ця кінцева точка — зручний спосіб витягти 11 628
    // робочих адрес підприємств по одній.
    return { sentTo: res.sentTo, expiresAt: res.expiresAt.toISOString() };
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle(MAIL)
  async confirm(
    @CurrentViewer() viewer: Viewer,
    @Body() body: { slug?: unknown; code?: unknown },
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const res = await this.claims.confirm(slug, viewer.id, code);
    if (res.ok === false) refuse(res.why);
    return { confirmed: true };
  }

  /**
   * CAMP-505: «Це мій кемпінг» — власник вводить свою пошту.
   *
   * 🔴 ВІДПОВІДЬ ОДНАКОВА ЗАВЖДИ: 202 і те саме тіло, чи є такий кемпінг,
   * чи збігся домен, чи вичерпано межу. Тіло каже чесно, що саме відбулось
   * «якщо адреса підійшла», і що робити, коли листа немає. Деталі —
   * `SpotClaimService.startByEmail`.
   *
   * 🔴 АДРЕСА ВИХОДИТЬ ЛИШЕ В ЛИСТ. Ані в відповіді, ані в базі (там
   * маска), ані в журналі.
   */
  @Post('by-email')
  @HttpCode(202)
  @Throttle(MAIL)
  async startByEmail(
    @CurrentViewer() viewer: Viewer,
    @Body() body: { slug?: unknown; email?: unknown },
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    const res = await this.claims.startByEmail(slug, viewer.id, body?.email);
    if (res.ok === false) refuse(res.why);
    return {
      accepted: true,
      message: OWNER_LINK_ACCEPTED,
    };
  }

  /**
   * CAMP-505: клік «підтвердити» на сторінці з листа. POST, а не GET:
   * поштові сканери й попередній перегляд посилань відкривають GET самі,
   * і одноразове посилання згоріло б, нікого не підтвердивши (або, гірше,
   * підтвердило б).
   */
  @Post('by-email/confirm')
  @HttpCode(200)
  @Throttle(MAIL)
  async confirmByEmail(
    @CurrentViewer() viewer: Viewer,
    @Body() body: { token?: unknown },
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const res = await this.claims.confirmLink(body?.token, viewer.id);
    if (res.ok === false)
      throw new HttpException(
        { code: 'link_invalid', message: LINK_INVALID },
        400,
      );
    return { confirmed: true, slug: res.slug, name: res.name };
  }
}
