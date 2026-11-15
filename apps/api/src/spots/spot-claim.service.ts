import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MAILER } from '../auth/account.service';
import {
  claimOwnerLinkMessage,
  claimSpotMessage,
  ownerLinkFor,
  type Mailer,
} from '../auth/mail';
import {
  AddressLimiter,
  LINK_TTL_MS,
  METHOD_LINK,
  MIN_STABLE_DAYS,
  type SpotFacts,
  linkTokenHash,
  maskForClaim,
  mentionsDomain,
  newLinkToken,
  ownerBasis,
  spotDomains,
  typedEmail,
} from './owner-email';
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  type ConfirmRefusal,
  type StartRefusal,
  PER_SPOT_PER_DAY,
  PER_USER_PER_DAY,
  codeHash,
  confirmRefusal,
  maskEmail,
  newCode,
  osmEmail,
  startRefusal,
  updatedRowCount,
} from './spot-claim';

export type StartResult =
  | { ok: true; sentTo: string; expiresAt: Date }
  | { ok: false; why: StartRefusal | 'no-spot' | 'mail-unavailable' };

export type OwnerLinkStart =
  { ok: true } | { ok: false; why: 'bad-email' | 'mail-unavailable' };

export type OwnerLinkConfirm =
  { ok: true; slug: string; name: string | null } | { ok: false };

export type ConfirmResult =
  { ok: true } | { ok: false; why: ConfirmRefusal | 'no-spot' };

/**
 * «Claim your listing». CAMP-51.
 *
 * 🔴 РІШЕННЯ ЖИВУТЬ У `spot-claim.ts`, ТУТ ЛИШЕ БАЗА Й ПОШТА. Сторож,
 * який можна перевірити лише піднявши HTTP, перевіряють один раз — тому
 * вся відмовна логіка чиста й накрита 28 випадками без Nest.
 */
@Injectable()
export class SpotClaimService {
  private readonly log = new Logger(SpotClaimService.name);
  private readonly pending = new Set<Promise<void>>();
  /** Лічильник листів на адресу — лише в пам'яті; див. `AddressLimiter`. */
  private readonly addresses = new AddressLimiter();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  /**
   * Виконати `job` ПІСЛЯ того, як відповідь пішла. Той самий прийом, що в
   * `AccountService.later`: лист — це сотні мілісекунд, і запит, що чекав би
   * на нього, відповідав би повільніше за той, що листа не шле. Різниця в
   * часі — це відповідь на питання «ця адреса пройшла?».
   *
   * Помилки пишуться лише за класом: текст помилки провайдера може містити
   * адресу одержувача, а журнал збійних адрес — це список людей.
   */
  private later(job: () => Promise<void>): void {
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        job()
          .catch((e: unknown) =>
            this.log.error(
              `owner letter not sent (${(e as { name?: string })?.name ?? 'error'})`,
            ),
          )
          .finally(resolve);
      });
    });
    this.pending.add(done);
    void done.then(() => this.pending.delete(done));
  }

  /** Дочекатися всіх відкладених листів: тести й вимкнення. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.drain();
  }

  /** Початок доби за UTC — вікно, у якому рахуються межі розсилки. */
  private static dayAgo(now: Date): Date {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  async start(spotSlug: string, viewerId: string | null): Promise<StartResult> {
    const rows = (await this.db.query(
      `SELECT id, name, contact FROM camping_spots WHERE slug = $1`,
      [spotSlug],
    )) as { id: string; name: string | null; contact: unknown }[];
    if (rows.length === 0) return { ok: false, why: 'no-spot' };
    const spot = rows[0];

    const now = new Date();
    const since = SpotClaimService.dayAgo(now);
    const [{ owner }] = (await this.db.query(
      `SELECT max(user_id::text) AS owner FROM spot_claims
        WHERE camping_spot_id = $1 AND used_at IS NOT NULL`,
      [spot.id],
    )) as { owner: string | null }[];
    const [{ for_spot }] = (await this.db.query(
      // 🔴 `method = 'osm_code'`: рядки-посилання ЧУЖИХ акаунтів не мають
      // права вичерпати цю межу (CAMP-505, рецензія PR #586). Інакше
      // сторонній, що вписав справжню адресу з домену кемпінгу, відбирав би
      // в власника й шлях із кодом.
      `SELECT count(*)::int AS for_spot FROM spot_claims
        WHERE camping_spot_id = $1 AND created_at >= $2
          AND method = 'osm_code'`,
      [spot.id, since],
    )) as { for_spot: number }[];
    const [{ by_user }] = (await this.db.query(
      `SELECT count(*)::int AS by_user FROM spot_claims
        WHERE user_id = $1 AND created_at >= $2`,
      [viewerId ?? '00000000-0000-0000-0000-000000000000', since],
    )) as { by_user: number }[];

    const refusal = startRefusal({
      viewerId,
      contact: spot.contact as Record<string, unknown> | null,
      confirmedOwnerId: owner,
      sentForSpotToday: for_spot,
      sentByUserToday: by_user,
    });
    if (refusal) return { ok: false, why: refusal };

    // 🔴 АДРЕСА БЕРЕТЬСЯ ТУТ І БІЛЬШЕ НІДЕ. Ні з тіла запиту, ні з
    // профілю: інакше це перестає бути доказом володіння.
    const to = osmEmail(spot.contact as Record<string, unknown>);
    const masked = to === null ? null : maskEmail(to);
    if (to === null || masked === null) return { ok: false, why: 'no-email' };
    if (!this.mailer) return { ok: false, why: 'mail-unavailable' };

    const code = newCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await this.db.query(
      `INSERT INTO spot_claims
         (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [spot.id, viewerId, codeHash(code), masked, expiresAt],
    );
    await this.mailer.sender.send(
      claimSpotMessage(
        to,
        code,
        spot.name ?? 'this campsite',
        Math.round(CODE_TTL_MS / 3_600_000),
      ),
    );
    return { ok: true, sentTo: masked, expiresAt };
  }

  async confirm(
    spotSlug: string,
    viewerId: string | null,
    code: string,
  ): Promise<ConfirmResult> {
    const rows = (await this.db.query(
      `SELECT id FROM camping_spots WHERE slug = $1`,
      [spotSlug],
    )) as { id: string }[];
    if (rows.length === 0) return { ok: false, why: 'no-spot' };
    const spotId = rows[0].id;

    const pending = (await this.db.query(
      `SELECT id, user_id, code_hash, expires_at, used_at, attempts
         FROM spot_claims
        WHERE camping_spot_id = $1 AND user_id = $2 AND used_at IS NULL
          AND method = 'osm_code'
        ORDER BY created_at DESC LIMIT 1`,
      [spotId, viewerId ?? '00000000-0000-0000-0000-000000000000'],
    )) as {
      id: string;
      user_id: string;
      code_hash: string;
      expires_at: Date;
      used_at: Date | null;
      attempts: number;
    }[];

    const why = confirmRefusal(
      viewerId,
      pending.length === 0
        ? null
        : {
            userId: pending[0].user_id,
            codeHash: pending[0].code_hash,
            expiresAt: new Date(pending[0].expires_at),
            usedAt: pending[0].used_at,
            attempts: pending[0].attempts,
          },
      code,
      new Date(),
    );
    if (why) {
      // 🔴 НЕВДАЛА СПРОБА КОШТУЄ СПРОБИ, І САМЕ ТОМУ ПЕРЕБІР СКІНЧЕННИЙ.
      // Рахуємо лише хибний код: протермінована чи спалена заявка не має
      // палити лічильник ще раз.
      if (why === 'wrong-code' && pending.length > 0) {
        await this.db.query(
          `UPDATE spot_claims SET attempts = attempts + 1 WHERE id = $1`,
          [pending[0].id],
        );
      }
      return { ok: false, why };
    }

    // 🔴 `WHERE used_at IS NULL` — ТУТ, А НЕ В ПЕРЕВІРЦІ ВИЩЕ. Між SELECT
    // і UPDATE встигає другий запит; виграти має рівно один, і вирішує це
    // база, а не порядок рядків у коді.
    const res = (await this.db.query(
      `UPDATE spot_claims SET used_at = now()
        WHERE id = $1 AND used_at IS NULL
        RETURNING id`,
      [pending[0].id],
    )) as unknown[];
    if (updatedRowCount(res) === 0) return { ok: false, why: 'no-pending' };
    return { ok: true };
  }

  /**
   * CAMP-505: початок самоверифікації по домену пошти.
   *
   * 🔴 ВІДПОВІДЬ ОДНАКОВА, ЧИ Є КЕМПІНГ, ЧИ ЗБІГЛАСЬ АДРЕСА, ЧИ ВИЧЕРПАНО
   * МЕЖУ. Три речі, які ця точка могла б виказати: що такий кемпінг є;
   * який домен у нього; чи хтось уже підтвердив його. Кожна — це довідник
   * для того, хто перебирає. Єдині відмови — ті, що залежать лише від
   * того, що надіслав сам запитувач (`bad-email`) або від налаштування
   * сервера (`mail-unavailable`): однакові для всіх.
   *
   * 🔴 УСЯ РОБОТА, ЩО ЗАЛЕЖИТЬ ВІД ДАНИХ, — ПІСЛЯ ВІДПОВІДІ. Пошук кемпінгу,
   * збіг, запити до бази, вставка й лист різні для збігу й промаху (промах
   * кінчається на першому запиті, збіг іде далі), і час відповіді виказував
   * би результат. Запит чекає лише на те, що однакове для всіх: перевірку
   * форми адреси й налаштування пошти. Те, що тепер ховається за `later`,
   * раніше жило до відповіді (рецензія PR #586).
   */
  async startByEmail(
    spotSlug: string,
    viewerId: string,
    typed: unknown,
  ): Promise<OwnerLinkStart> {
    const email = typedEmail(typed);
    if (email === null) return { ok: false, why: 'bad-email' };
    const mailer = this.mailer;
    if (!mailer) return { ok: false, why: 'mail-unavailable' };
    this.later(() => this.attempt(spotSlug, viewerId, email, mailer));
    return { ok: true };
  }

  /**
   * Те, що робиться після відповіді: рішення й лист. Кожна відмова —
   * `quiet`: слово в журналі, ні адреси, ні slug.
   */
  private async attempt(
    spotSlug: string,
    viewerId: string,
    email: string,
    mailer: Mailer,
  ): Promise<void> {
    // 🔴 Ключ — ПАРА (акаунт, адреса), а не адреса. Інакше будь-хто, хто
    // тричі впише чужу робочу адресу, відбирає лист у її власника на добу
    // (рецензія PR #586). Межа лишається межею для того, хто шле.
    if (!this.addresses.take(`${viewerId}|${email}`))
      return this.quiet('address-limit');

    const rows = (await this.db.query(
      `SELECT id, name, website, contact,
              (content_changed_at IS NOT NULL
               AND content_changed_at <= now() - make_interval(days => $2))
                AS stable
         FROM camping_spots WHERE slug = $1`,
      [spotSlug, MIN_STABLE_DAYS],
    )) as {
      id: string;
      name: string | null;
      website: string | null;
      contact: Record<string, unknown> | null;
      stable: boolean;
    }[];
    if (rows.length === 0) return this.quiet('no-spot');
    const spot = rows[0];
    const facts = { website: spot.website, contact: spot.contact };

    const shared = await this.sharedDomains(spot.id, facts);
    const basis = ownerBasis(facts, email, shared);
    if (basis === null) return this.quiet('no-match');
    // 🔴 Значення, яке з'явилось у наших даних щойно, автопідтвердження не
    // дає: будь-хто може вписати свій сайт чи пошту в OSM і дочекатись
    // імпорту. Див. `MIN_STABLE_DAYS`.
    if (!spot.stable) return this.quiet('unstable');
    const masked = maskForClaim(email);
    if (masked === null) return this.quiet('unmaskable');

    const since = SpotClaimService.dayAgo(new Date());
    const [{ owner }] = (await this.db.query(
      `SELECT max(user_id::text) AS owner FROM spot_claims
        WHERE camping_spot_id = $1 AND used_at IS NOT NULL`,
      [spot.id],
    )) as { owner: string | null }[];
    if (owner !== null) return this.quiet('already-claimed');
    // 🔴 Межа кемпінгу — на ПАРУ (кемпінг, акаунт): три заявки стороннього
    // не мають права закрити дорогу власнику (рецензія PR #586).
    const [{ for_pair }] = (await this.db.query(
      `SELECT count(*)::int AS for_pair FROM spot_claims
        WHERE camping_spot_id = $1 AND user_id = $2 AND created_at >= $3`,
      [spot.id, viewerId, since],
    )) as { for_pair: number }[];
    if (for_pair >= PER_SPOT_PER_DAY) return this.quiet('spot-limit');
    const [{ by_user }] = (await this.db.query(
      `SELECT count(*)::int AS by_user FROM spot_claims
        WHERE user_id = $1 AND created_at >= $2`,
      [viewerId, since],
    )) as { by_user: number }[];
    if (by_user >= PER_USER_PER_DAY) return this.quiet('user-limit');

    const token = newLinkToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.db.query(
      `INSERT INTO spot_claims
         (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at,
          method, basis)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        spot.id,
        viewerId,
        linkTokenHash(token),
        masked,
        expiresAt,
        METHOD_LINK,
        basis,
      ],
    );
    await mailer.sender.send(
      claimOwnerLinkMessage(
        email,
        ownerLinkFor(mailer.webBase, token),
        spot.name ?? 'this campsite',
        Math.round(LINK_TTL_MS / 60_000),
        `${mailer.webBase}/legal/privacy`,
      ),
    );
  }

  /**
   * Домени цього кемпінгу, які згадує ще хтось.
   *
   * 🔴 ДОМЕН, ЯКИЙ ЗГАДУЮТЬ ДВА КЕМПІНГИ, НЕ НАЛЕЖИТЬ ЖОДНОМУ З НИХ. Сайт
   * мережі, регіональний каталог, провайдер, на якому «живуть» десятки
   * кемпінгів, — це домен, скриньку на якому має не власник. Список таких
   * провайдерів нам не перелічити (kpn.nl, kabelbw.de, camping.it,
   * bayern.de…), але їх видно за ПОВТОРОМ у наших же даних. За таким
   * доменом автопідтвердження не дається — лише дослівна адреса з
   * контактів.
   *
   * Запит бере кандидатів підрядком (`ILIKE`), а підрахунок повторює вже
   * точно, за зареєстрованим доменом: підрядок знаходить зайве, і зайве
   * тут відсіюється, а не рахується.
   */
  private async sharedDomains(
    spotId: string,
    facts: SpotFacts,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    for (const domain of spotDomains(facts)) {
      const others = (await this.db.query(
        `SELECT website, contact FROM camping_spots
          WHERE id <> $1 AND (website ILIKE $2 OR contact::text ILIKE $2)
          LIMIT 200`,
        [spotId, `%${domain}%`],
      )) as {
        website: string | null;
        contact: Record<string, unknown> | null;
      }[];
      if (others.some((o) => mentionsDomain(o, domain))) out.add(domain);
    }
    return out;
  }

  /** Тиха відмова: причина лише в журналі, і лише словом — ні адреси, ні slug. */
  private quiet(reason: string): void {
    this.log.log(`owner link not sent: ${reason}`);
  }

  /**
   * CAMP-505: клік «підтвердити» на сторінці, куди веде посилання з листа.
   *
   * 🔴 ОДИН ОПЕРАТОР, А НЕ «ПЕРЕВІР, ПОТІМ ЗАПИШИ». Токен, акаунт, строк,
   * одноразовість і метод — умови одного `UPDATE … WHERE`. Між SELECT і
   * UPDATE встигає другий клік, прострочення й чужий акаунт; базі це
   * вирішувати, а не порядкові рядків у коді.
   *
   * 🔴 УСІ ВІДМОВИ — ОДНА. «Витрачене», «прострочене», «чуже», «такого
   * немає» і «кемпінг уже підтверджено іншим» людині відповідають однаково:
   * різниця розповідала б стороннім, чи є така заявка і чия вона.
   */
  async confirmLink(
    token: unknown,
    viewerId: string,
  ): Promise<OwnerLinkConfirm> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(token))
      return { ok: false };
    let res: unknown;
    try {
      res = await this.db.query(
        `UPDATE spot_claims SET used_at = now()
          WHERE code_hash = $1 AND method = 'link' AND user_id = $2
            AND used_at IS NULL AND expires_at > now()
          RETURNING camping_spot_id`,
        [linkTokenHash(token), viewerId],
      );
    } catch (e) {
      // Другий підтверджений на той самий кемпінг: частковий унікальний
      // індекс відмовив. Це «ні», а не 500.
      if ((e as { code?: string })?.code === '23505') return { ok: false };
      throw e;
    }
    if (updatedRowCount(res) === 0) return { ok: false };
    const rows = (
      Array.isArray((res as unknown[])[0]) ? (res as unknown[])[0] : res
    ) as { camping_spot_id: string }[];
    const spot = (await this.db.query(
      `SELECT slug, name FROM camping_spots WHERE id = $1`,
      [rows[0].camping_spot_id],
    )) as { slug: string; name: string | null }[];
    return { ok: true, slug: spot[0]?.slug ?? '', name: spot[0]?.name ?? null };
  }

  /** Чи тримає цей акаунт грант на цей кемпінг. */
  async isOwner(spotId: string, viewerId: string): Promise<boolean> {
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM spot_claims
        WHERE camping_spot_id = $1 AND user_id = $2 AND used_at IS NOT NULL`,
      [spotId, viewerId],
    )) as { n: number }[];
    return n > 0;
  }
}

export { MAX_ATTEMPTS };
