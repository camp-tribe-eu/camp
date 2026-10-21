import { DataSource, type QueryRunner } from 'typeorm';
import { PagesService } from './pages.service';

/**
 * 🔴 CAMP-364 — «ВИДИМИЙ ЧИТАЧЕВІ» ПЕРЕВІРЯЄТЬСЯ НА БАЗІ, А НЕ НА ТЕКСТІ
 * ЗАПИТУ.
 *
 * Спокуса була написати тест, який читає SQL і шукає в ньому
 * `published_at <= now()`. Це твердження про ФОРМУ: воно лишиться
 * зеленим, якщо предикат є, але стоїть не в тій дужці, під `OR`, або
 * порівнює не те поле. Тому рядки саджаються у справжню таблицю.
 *
 * 🔴 І В ТРАНЗАКЦІЇ, ЯКА ВІДКОЧУЄТЬСЯ. Сьогоднішні дані тесту не
 * належать: блог може бути порожній, і тоді «майбутнього допису не
 * видно» не відрізнити від «не видно нічого». Садимо всі три випадки
 * самі й відкочуємо.
 *
 * Сервіс дістає `queryRunner` замість `DataSource`: він користується
 * лише `.query`, а так усі запити йдуть тим самим зʼєднанням, що й
 * посаджені рядки — інакше транзакція сховала б їх від перевірки.
 */
describe('PagesService.posts: що саме видно читачеві', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let pages: PagesService;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      // 🔴 ТА САМА КОНВЕНЦІЯ, ЩО В `osm/import-main.db.spec.ts`, а не
      // власна змінна: `CI_DATABASE_URL` оголошено на рівні всього
      // workflow, тож у CI це вже працює без правок кроку. Перша
      // редакція додавала `DATABASE_URL` до кроку тестів — і тим самим
      // міняла середовище ЧУЖИМ тестам, яких я не читав.
      //
      // Відсутня база — це падіння, а не пропуск: пропущений тест
      // виглядає так само зелено, як пройдений.
      url:
        process.env.CAMP_TEST_DATABASE_URL ??
        process.env.CI_DATABASE_URL ??
        'postgres://localhost:5432/camptribe_dev',
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    pages = new PagesService(qr as unknown as DataSource);

    const add = async (
      key: string,
      slug: string,
      status: string,
      publishedAt: string | null,
    ) => {
      const rows = (await qr.query(
        `INSERT INTO pages (slug, type, status, published_at, author_name)
         VALUES ($1, 'post', $2::pages_status_enum, $3::timestamptz, 'Тест')
         RETURNING id`,
        [slug, status, publishedAt],
      )) as Array<{ id: string }>;
      ids[key] = rows[0].id;
      await qr.query(
        `INSERT INTO page_translations (page_id, language_code, title, meta_description)
         VALUES ($1, 'en', $2, $3)`,
        [rows[0].id, `Заголовок ${key}`, `Опис ${key}`],
      );
    };

    await add('past', 'camp364-past', 'published', '2020-01-01T00:00:00Z');
    await add('future', 'camp364-future', 'published', '2099-01-01T00:00:00Z');
    await add('draft', 'camp364-draft', 'draft', '2020-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  const slugs = async () => (await pages.posts('en')).map((p) => p.slug);

  it('опублікований у минулому — видно', async () => {
    expect(await slugs()).toContain('camp364-past');
  });

  it('🔴 опублікований МАЙБУТНЬОЮ датою — не видно', async () => {
    const got = await slugs();
    expect(got).not.toContain('camp364-future');
    // Пара: перелік не порожній, інакше твердження вище зелене ні про що.
    expect(got).toContain('camp364-past');
  });

  it('чернетка — не видно', async () => {
    expect(await slugs()).not.toContain('camp364-draft');
  });

  /**
   * 🔴 ВИПАДОК «ОПУБЛІКОВАНИЙ БЕЗ ДАТИ» НАПИСАТИ НЕМОЖЛИВО, І ЦЕ
   * ПРОПИСАНО В СХЕМІ, А НЕ В МОЇЙ ГОЛОВІ.
   *
   * Я його написав і дістав `pages_post_published_has_date`. Тобто
   * репозиторій знав те, чого не знав я: допис не може вийти без дати.
   * Отже на цьому спирається `posts()`, і якщо обмеження колись
   * приберуть, воно мусить впасти ТУТ, а не в блозі.
   */
  it('🔴 схема досі вимагає дату для опублікованого допису', async () => {
    const rows = (await qr.query(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname = 'pages_post_published_has_date'`,
    )) as Array<{ def: string }>;
    // (jest, не Playwright: другого аргумента з поясненням немає, тож
    // пояснення лишається тут — обмеження зникло, і `posts()` спирався
    // б на порожнечу.)
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('published_at IS NOT NULL');

    await expect(
      qr.query(
        `INSERT INTO pages (slug, type, status, published_at)
         VALUES ('camp364-nodate', 'post', 'published', NULL)`,
      ),
    ).rejects.toThrow(/pages_post_published_has_date/);
  });

  it('🔴 `bySlug` бачить ту саму множину, що й перелік', async () => {
    // Розійдуться — дістанемо мертві адреси або ранній допис в індексі.
    expect(await pages.bySlug('camp364-past', 'en', 'post')).not.toBeNull();
    expect(await pages.bySlug('camp364-future', 'en', 'post')).toBeNull();
    expect(await pages.bySlug('camp364-draft', 'en', 'post')).toBeNull();
  });

  it('`slugs` для дописів теж бачить ту саму множину', async () => {
    const got = await pages.slugs('en', 'post');
    expect(got).toContain('camp364-past');
    expect(got).not.toContain('camp364-future');
    expect(got).not.toContain('camp364-draft');
  });

  it('допис не плутається зі сторінкою того самого слагу', async () => {
    await qr.query(
      `INSERT INTO pages (slug, type, status, published_at)
       VALUES ('camp364-past', 'page', 'published', now())`,
    );
    const page = (await qr.query(
      `SELECT id FROM pages WHERE slug = 'camp364-past' AND type = 'page'`,
    )) as Array<{ id: string }>;
    await qr.query(
      `INSERT INTO page_translations (page_id, language_code, title)
       VALUES ($1, 'en', 'Сторінка, не допис')`,
      [page[0].id],
    );
    const post = await pages.bySlug('camp364-past', 'en', 'post');
    expect(post?.title).toBe('Заголовок past');
  });
});
