import { MigrationInterface, QueryRunner } from 'typeorm';
import { PHOTO_SLOTS } from '../pages/photo-slots';

/**
 * Слоти під фото, які заповнює власник,.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ І ЖОДНОГО НОВОГО ПОЛЯ: слот — рядок `pages` з
 * `type = 'photo-slot'`, слаг = ключ слота (`pages/photo-slots.ts`).
 * Колонок `banner_image_url` / `banner_image_alt` уже створила CAMP-469.
 * Тому на проді `directus_fields` не поповнюється.
 *
 * 🔴 У МІГРАЦІЇ ЗОБРАЖЕНЬ НЕМАЄ — лише порожні слоти. Фото ставить власник.
 *
 * 🔴 ІДЕМПОТЕНТНО І НЕ ЧІПАЄ ЧУЖОГО: слот, що вже є, пропускається, тож
 * повторний прогін не стирає фото, яке власник уже поставив.
 * 🔴 `down` видаляє ЛИШЕ порожні слоти: з фото власника міграція не
 * розлучається.
 *
 * Рядок видимий лише коду, що читає `type = 'photo-slot'`; усі інші
 * читачі `pages` (меню, карта сайту, блог) фільтрують за типом.
 */
export class PhotoSlots1797940000000 implements MigrationInterface {
  name = 'PhotoSlots1797940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { key, title } of PHOTO_SLOTS) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'photo-slot'`,
        [key],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'photo-slot', 'published', now(), 0, true)
         RETURNING id`,
        [key],
      );
      await queryRunner.query(
        `INSERT INTO page_translations (page_id, language_code, title)
         VALUES ($1, 'en', $2)`,
        [page[0].id, title],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM pages
        WHERE type = 'photo-slot'
          AND (banner_image_url IS NULL OR btrim(banner_image_url) = '')`,
    );
  }
}
