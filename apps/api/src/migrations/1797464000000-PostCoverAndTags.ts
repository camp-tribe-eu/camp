import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-464 — обкладинка й теги допису блогу.
 *
 * Власник: блог і допис мають бути «як у Темі», а в Теми кожна картка
 * має фото й теги. У нас п'ять однакових лого-заглушок.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ (прод стоїть на 24 з 25). Обкладинка живе в
 * ВЖЕ ІСНУЮЧОМУ полі `pages.banner_image_url` (+ `banner_image_alt` у
 * перекладі) — тому самому, що CAMP-469 завела для банера країни. Поле
 * загальне: «тип camping-country» було лише приміткою в адмінці, а не
 * обмеженням бази. Новим є одне ПОЛЕ наявної колекції:
 *   • `pages.tags` — `jsonb`, масив рядків. Не окрема таблиця тегів:
 *     таблиця була б новою колекцією, а колекція коштує слот навіть
 *     схована.
 *
 * 🔴 ПОЛЕ `jsonb NOT NULL DEFAULT '[]'`, А НЕ NULLABLE. Дві форми
 * «тегів немає» (`NULL` і `[]`) — це дві гілки в кожному читачі, і
 * друга з них забувається. Порожній масив — єдиний запис «тегів нема».
 *
 * 🔴 ЗАСІВ ЛИШЕ ТАМ, ДЕ ВЛАСНИК ЩЕ НІЧОГО НЕ ВПИСАВ. Колонки порожні →
 * кладемо. Вже щось є (власник поставив своє фото чи теги в Directus) →
 * не чіпаємо: перезапис чужої правки міграцією — гірше за відсутню
 * обкладинку.
 *
 * 🔴 КАРТИНКИ — НАШІ ВЛАСНІ БАНЕРИ САЙТУ (`public/banners/*.webp`), а не
 * фото конкретних місць: на сайті надруковано правило «no stock
 * photography and no AI-generated images of places nobody has visited»,
 * і ці зображення нічого не називають — ні країни, ні кемпінгу, ні
 * дороги, яку можна показати на мапі. Допис «про 3,5 тонни» отримує
 * фургон на дорозі, бо це ілюстрація теми, а не твердження про місце.
 * Власник замінює їх у `pages.banner_image_url`, коли матиме свої.
 *
 * Адреса — шлях від кореня. Чужий хост у `img-src` не дозволено CSP, тож
 * зовнішня адреса просто не завантажилась би (веб такі відкидає).
 */
interface Cover {
  slug: string;
  src: string;
  alt: string;
  tags: readonly string[];
}

export const POST_COVERS: readonly Cover[] = [
  {
    slug: 'camper-over-3-5-tonnes',
    src: '/banners/camper.webp',
    alt: 'A white camper van on a long, straight road through green fields at dawn.',
    tags: ['Driving', 'Licence'],
  },
  {
    slug: 'reading-overnight-parking-rules',
    src: '/banners/eu-dawn.webp',
    alt: 'One small tent in a misty green field at sunrise.',
    tags: ['Rules', 'Overnight'],
  },
  {
    slug: 'tourist-taxes-and-camping-fees',
    src: '/banners/tools.webp',
    alt: 'A kettle, a coil of rope and a folded cloth on a beige blanket.',
    tags: ['Costs', 'Campsites'],
  },
  {
    slug: 'when-to-go-camping-seasons-in-europe',
    src: '/banners/lake.webp',
    alt: 'A calm lake at dawn, reeds in the foreground and a pale pink sky.',
    tags: ['Planning', 'Seasons'],
  },
  {
    slug: 'electricity-and-gas-on-campsites',
    src: '/banners/tent.webp',
    alt: 'An orange tent lit from inside, among spruce trees under a blue evening sky.',
    tags: ['Campsites', 'Gear'],
  },
];

export class PostCoverAndTags1797464000000 implements MigrationInterface {
  name = 'PostCoverAndTags1797464000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pages ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    // 🔴 Масив — обмеженням бази, а не лише читачем: `{"0":"x"}` після
    // правки jsonb у Directus читач відкинув би, але краще, щоб база не
    // дала це зберегти.
    await queryRunner.query(
      `ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_tags_is_array`,
    );
    await queryRunner.query(
      `ALTER TABLE pages ADD CONSTRAINT pages_tags_is_array
         CHECK (jsonb_typeof(tags) = 'array')`,
    );

    for (const c of POST_COVERS) {
      await queryRunner.query(
        `UPDATE pages
            SET banner_image_url = $2
          WHERE type = 'post' AND slug = $1
            AND coalesce(banner_image_url, '') = ''`,
        [c.slug, c.src],
      );
      await queryRunner.query(
        `UPDATE page_translations t
            SET banner_image_alt = $2
           FROM pages p
          WHERE t.page_id = p.id AND t.language_code = 'en'
            AND p.type = 'post' AND p.slug = $1
            AND coalesce(t.banner_image_alt, '') = ''`,
        [c.slug, c.alt],
      );
      await queryRunner.query(
        `UPDATE pages
            SET tags = $2::jsonb
          WHERE type = 'post' AND slug = $1
            AND tags = '[]'::jsonb`,
        [c.slug, JSON.stringify(c.tags)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Знімаємо лише те, що поклали САМЕ ми: обкладинка з нашого списку.
    // Фото, яке власник поставив сам, не чіпаємо.
    for (const c of POST_COVERS) {
      await queryRunner.query(
        `UPDATE pages SET banner_image_url = NULL
          WHERE type = 'post' AND slug = $1 AND banner_image_url = $2`,
        [c.slug, c.src],
      );
      await queryRunner.query(
        `UPDATE page_translations t SET banner_image_alt = NULL
           FROM pages p
          WHERE t.page_id = p.id AND p.type = 'post' AND p.slug = $1
            AND t.banner_image_alt = $2`,
        [c.slug, c.alt],
      );
    }
    await queryRunner.query(
      `ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_tags_is_array`,
    );
    await queryRunner.query(`ALTER TABLE pages DROP COLUMN IF EXISTS tags`);
  }
}
