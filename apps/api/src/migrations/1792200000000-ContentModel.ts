import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-362 — модель контенту: сторінки зі СЕКЦІЙ, а не унікальна верстка.
 *
 * Рішення власника 20.10.2026, дослівно: «немає унікальних секцій, є
 * універсальні секції які можна вивести на будь яку сторінку» — тобто те
 * саме, як робляться преміум-теми Shopify.
 *
 * 🔴 ЧОМУ НЕ ЯК У ТУТОРІАЛІ DIRECTUS. Їхній патерн Builder (M2A) дає
 * КОЖНОМУ типу секції власну колекцію: `block_hero`, `block_faq`,
 * `block_cards`… Дванадцять типів — дванадцять колекцій плюс таблиця
 * звʼязку. Ліміт Core це 25 колекцій, і хоча грант знімає ліміти, впертись
 * у них означало б, що день, коли ключ відпаде, перетворить половину
 * адмінки на Inactive. Отже: ОДНА колекція `page_sections` із полем
 * `type`. Кількість полів Directus не обмежує, кількість колекцій — так,
 * тому різноманіття кладемо в поля.
 *
 * 🔴 ЧОГО ТУТ НЕМАЄ І ЧОМУ. `legal_pages` НЕ згортається в `pages`, хоча
 * спершу я саме це й планував. У неї є `version` і `effective_from` —
 * тобто це версійований правовий документ, і питання «яка редакція діяла
 * 3 березня» має відповідь лише доти, доки ці колонки існують. Загальна
 * сторінка такого не несе. `guides` так само лишаються собою: автор,
 * `facts_checked_at`, `provenance` — це редакційна стаття з походженням,
 * а не блок тексту.
 *
 * Схема — єдине джерело правди для DDL, Directus її лише читає
 * (`apps/cms/configure.mjs` не створює таблиць, і це навмисно).
 */
export class ContentModel1792200000000 implements MigrationInterface {
  name = 'ContentModel1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Сторінки ────────────────────────────────────────────────────
    //
    // 🔴 `type` розрізняє сторінку й допис БЕЗ окремої колекції: блог це
    // ті самі секції, лише з датою й автором. Власник просив і блог, і
    // сингл-пост у реліз; дві колекції замість однієї коштували б місця
    // в ліміті й нічого не дали б.
    await queryRunner.query(
      `CREATE TYPE "public"."pages_type_enum" AS ENUM('page', 'post')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pages_status_enum" AS ENUM('draft', 'review', 'published', 'archived')`,
    );
    await queryRunner.query(`
      CREATE TABLE "pages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying NOT NULL,
        "type" "public"."pages_type_enum" NOT NULL DEFAULT 'page',
        "status" "public"."pages_status_enum" NOT NULL DEFAULT 'draft',
        "published_at" TIMESTAMP WITH TIME ZONE,
        "author_name" character varying,
        "sort" integer NOT NULL DEFAULT 0,
        "noindex" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pages" PRIMARY KEY ("id")
      )
    `);
    // 🔴 Унікальність ПО ТИПУ, а не глобальна: `/about` і допис із тим
    // самим слагом живуть за різними адресами й зіткнутись не можуть.
    // Глобальний унікальний індекс заборонив би це без причини.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_pages_type_slug" ON "pages" ("type", "slug")`,
    );
    // 🔴 Опублікований допис БЕЗ дати — це сторінка, яка не знає, коли
    // вона зʼявилась, а блог без дати не блог. Для звичайної сторінки
    // дата не потрібна й не вимагається.
    await queryRunner.query(`
      ALTER TABLE "pages"
        ADD CONSTRAINT "pages_post_published_has_date"
        CHECK (
          "type" <> 'post'
          OR "status" <> 'published'
          OR "published_at" IS NOT NULL
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "page_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "language_code" character varying(16) NOT NULL,
        "title" character varying NOT NULL,
        "meta_description" text,
        CONSTRAINT "PK_page_translations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_page_translations_page_lang" ON "page_translations" ("page_id", "language_code")`,
    );

    // ── Секції ──────────────────────────────────────────────────────
    //
    // 🔴 `type` це ВАРЧАР, а не enum, і це навмисно. Новий тип секції
    // мусить коштувати рядок у конфігурації Directus, а не міграцію:
    // enum вимагав би `ALTER TYPE` на проді щоразу, коли власник хоче
    // новий блок. Перелік дозволених значень живе в адмінці, де його
    // й редагують.
    await queryRunner.query(`
      CREATE TABLE "page_sections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "page_id" uuid NOT NULL,
        "sort" integer NOT NULL DEFAULT 0,
        "type" character varying(64) NOT NULL,
        "variant" character varying(64),
        "visible" boolean NOT NULL DEFAULT true,
        "image_url" text,
        "cta_href" text,
        CONSTRAINT "PK_page_sections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_page_sections_page" FOREIGN KEY ("page_id")
          REFERENCES "pages" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_page_sections_page_sort" ON "page_sections" ("page_id", "sort")`,
    );

    // 🔴 ТЕКСТ — У ПЕРЕКЛАДАХ, РЕШТА — У СЕКЦІЇ. `items` тут теж, бо все
    // всередині повторюваного блоку (питання й відповідь у FAQ, заголовок
    // картки) це текст.
    //
    // Ціна названа прямо: картинка в межах `items` редагується на кожну
    // мову окремо. Поки жива одна мова (CAMP-219: пʼять лежать із
    // `live: false`) це нічого не коштує; коли мов стане більше —
    // виносити структуру окремо, і це буде видно з цього коментаря.
    await queryRunner.query(`
      CREATE TABLE "page_section_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "section_id" uuid NOT NULL,
        "language_code" character varying(16) NOT NULL,
        "heading" character varying,
        "subheading" character varying,
        "body" text,
        "image_alt" character varying,
        "cta_label" character varying,
        "items" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_page_section_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_page_section_translations_section" FOREIGN KEY ("section_id")
          REFERENCES "page_sections" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_page_section_translations_section_lang" ON "page_section_translations" ("section_id", "language_code")`,
    );

    // ── Навігація ───────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "public"."navigation_location_enum" AS ENUM('header', 'footer', 'mobile')`,
    );
    await queryRunner.query(`
      CREATE TABLE "navigation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "location" "public"."navigation_location_enum" NOT NULL,
        "sort" integer NOT NULL DEFAULT 0,
        "href" text NOT NULL,
        "parent_id" uuid,
        "visible" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_navigation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_navigation_parent" FOREIGN KEY ("parent_id")
          REFERENCES "navigation" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_navigation_location_sort" ON "navigation" ("location", "sort")`,
    );
    // 🔴 Пункт не може бути власним батьком. Цикл у меню це нескінченний
    // рендер, а не крива верстка — і помітний він буде вже в проді.
    // Глибші цикли цей CHECK не ловить; їх ловить сторож у коді, бо SQL
    // для цього довелося б писати рекурсивний тригер.
    await queryRunner.query(`
      ALTER TABLE "navigation"
        ADD CONSTRAINT "navigation_not_own_parent"
        CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
    `);
    await queryRunner.query(`
      CREATE TABLE "navigation_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "navigation_id" uuid NOT NULL,
        "language_code" character varying(16) NOT NULL,
        "label" character varying NOT NULL,
        CONSTRAINT "PK_navigation_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_navigation_translations_nav" FOREIGN KEY ("navigation_id")
          REFERENCES "navigation" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_navigation_translations_nav_lang" ON "navigation_translations" ("navigation_id", "language_code")`,
    );

    // ── Налаштування сайту ──────────────────────────────────────────
    //
    // 🔴 РІВНО ОДИН РЯДОК, і це тримає база, а не домовленість.
    // `singleton` завжди `true`, унікальний, і CHECK забороняє `false` —
    // отже другий рядок вставити неможливо. Без цього «налаштування
    // сайту» за півроку стали б таблицею з трьома рядками, з яких код
    // читає перший-ліпший.
    await queryRunner.query(`
      CREATE TABLE "site_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "singleton" boolean NOT NULL DEFAULT true,
        "contact_email" character varying(320),
        "social_links" jsonb NOT NULL DEFAULT '{}',
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_settings_singleton" UNIQUE ("singleton"),
        CONSTRAINT "site_settings_is_singleton" CHECK ("singleton")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "site_settings_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "settings_id" uuid NOT NULL,
        "language_code" character varying(16) NOT NULL,
        "tagline" character varying,
        "footer_note" text,
        CONSTRAINT "PK_site_settings_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_site_settings_translations_settings" FOREIGN KEY ("settings_id")
          REFERENCES "site_settings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_site_settings_translations_lang" ON "site_settings_translations" ("settings_id", "language_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Зворотний порядок: спершу те, що посилається, потім те, на що.
    for (const table of [
      'site_settings_translations',
      'site_settings',
      'navigation_translations',
      'navigation',
      'page_section_translations',
      'page_sections',
      'page_translations',
      'pages',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const type of [
      'navigation_location_enum',
      'pages_status_enum',
      'pages_type_enum',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."${type}"`);
    }
  }
}
