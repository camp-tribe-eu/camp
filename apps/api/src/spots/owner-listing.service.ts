import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { canonicalPath } from './canonical';
import { SpotClaimService } from './spot-claim.service';
import {
  faults,
  merge,
  updatedRowCountOf,
  type OverridePatch,
} from './owner-overrides';

export type EditResult =
  | { ok: true; overrides: Record<string, unknown> }
  | { ok: false; why: 'anonymous' | 'no-spot' | 'not-yours'; faults?: string[] }
  | { ok: false; why: 'bad-patch'; faults: string[] };

/**
 * Правки власника поверх OSM. CAMP-51 / CAMP-86.
 *
 * 🔴 ЧОМУ ЦЕ ВЗАГАЛІ ПРАЦЮЄ. Колонка `owner_overrides` існує з CAMP-28, і
 * тижневий імпорт OSM її НЕ ЧІПАЄ — три окремі місця в `import-spots.ts`
 * стережуть, щоб `slug` і `owner_overrides` не потрапили в `DO UPDATE`.
 * Без цього правка власника зникала б щотижня без жодного пояснення.
 *
 * Читання вже готове: `withOwnerOverrides()` у `apps/web/src/lib/api.ts`
 * зливає цю колонку поверх OSM. Бракувало рівно запису — заміряно
 * 03.11.2026: непорожніх `owner_overrides` **0 із 63 159**.
 */
@Injectable()
export class OwnerListingService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly claims: SpotClaimService,
  ) {}

  async edit(
    slug: string,
    viewerId: string | null,
    patch: unknown,
  ): Promise<EditResult> {
    if (typeof viewerId !== 'string' || viewerId === '')
      return { ok: false, why: 'anonymous' };

    const rows = (await this.db.query(
      `SELECT id, owner_overrides FROM camping_spots WHERE slug = $1`,
      [slug],
    )) as { id: string; owner_overrides: Record<string, unknown> }[];
    // 🔴 Неіснуючий кемпінг відповідає так само, як чужий — інакше
    // кінцева точка стає довідником про те, які slug справжні.
    if (rows.length === 0) return { ok: false, why: 'not-yours' };

    if (!(await this.claims.isOwner(rows[0].id, viewerId)))
      return { ok: false, why: 'not-yours' };

    // 🔴 ПЕРЕВІРКА ПІСЛЯ ПРАВ, А НЕ ДО НИХ. Інакше чужий отримав би
    // «поле X не редагується» на свій кемпінг і дізнався б, що кемпінг
    // існує, а відмова — лише про права.
    const bad = faults(patch);
    if (bad.length > 0) return { ok: false, why: 'bad-patch', faults: bad };

    const next = merge(rows[0].owner_overrides ?? {}, patch as OverridePatch);
    const res = await this.db.query(
      `UPDATE camping_spots SET owner_overrides = $2 WHERE id = $1 RETURNING id`,
      [rows[0].id, JSON.stringify(next)],
    );
    if (updatedRowCountOf(res) === 0) return { ok: false, why: 'no-spot' };
    return { ok: true, overrides: next };
  }

  /**
   * Кемпінги, які цей акаунт підтвердив. Порожньо — теж відповідь.
   *
   * 🔴 ШЛЯХ РАХУЄ API, А НЕ СТОРІНКА. Адреса сторінки кемпінгу — це
   * `/camping/<країна>/<регіон>/<slug>`, і зібрати її зі самого `slug`
   * неможливо. Перша редакція віддавала лише `slug`, а сторінка клеїла
   * `/camping/${slug}` — посилання в нікуди на кожному рядку.
   *
   * `canonicalPath` віддає `null` для кемпінгу без регіону: у нього
   * сторінки НЕМАЄ (CAMP-34), і це теж відповідь, яку інтерфейс мусить
   * показати словами, а не мовчазним посиланням на 404.
   */
  async mine(viewerId: string): Promise<
    {
      slug: string;
      name: string | null;
      path: string | null;
      overrides: Record<string, unknown>;
    }[]
  > {
    const rows = (await this.db.query(
      `SELECT s.slug, s.name, s.country, s.region, s.owner_overrides AS overrides
         FROM spot_claims c
         JOIN camping_spots s ON s.id = c.camping_spot_id
        WHERE c.user_id = $1 AND c.used_at IS NOT NULL
        ORDER BY s.slug`,
      [viewerId],
    )) as {
      slug: string;
      name: string | null;
      country: string;
      region: string | null;
      overrides: Record<string, unknown>;
    }[];
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      path: canonicalPath(r.country, r.region, r.slug),
      overrides: r.overrides ?? {},
    }));
  }
}
