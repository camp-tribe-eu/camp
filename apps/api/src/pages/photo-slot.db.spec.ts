import { DataSource, type QueryRunner } from 'typeorm';
import { PagesService } from './pages.service';
import { PHOTO_SLOTS } from './photo-slots';

/**
 * Слоти фото власника, перевірені на БАЗІ (рішення власника 16.11.2026).
 *
 * Рядки правляться в транзакції, що відкочується: «фото є» і «фото немає»
 * садяться самі, а не читаються з сьогоднішніх даних. Сам факт «чотири
 * порожні слоти» міряється на щойно змігрованій базі.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогін — у тілі PR):
 *   1. у `photoSlot` забрати `p.type = 'photo-slot'` → червоніє «сторінка
 *      іншого типу з тим самим слагом»;
 *   2. забрати `${VISIBLE}` → червоніє «знятий з публікації слот»;
 *   3. забрати `isPhotoSlotKey` → червоніє «ключ не з переліку»;
 *   4. міграція перестає засівати один слот → червоніє «рівно стільки
 *      слотів, скільки в переліку».
 */
describe('фото-слоти власника', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let pages: PagesService;
  let queries: string[];

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
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
    queries = [];
    const real = qr.query.bind(qr);
    qr.query = ((sql: string, params?: unknown[]) => {
      queries.push(sql);
      return real(sql, params);
    }) as typeof qr.query;
    pages = new PagesService(qr as unknown as DataSource);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  const set = async (
    key: string,
    url: string | null,
    alt: string | null = null,
  ) => {
    await qr.query(
      `UPDATE pages SET banner_image_url = $2 WHERE slug = $1 AND type = 'photo-slot'`,
      [key, url],
    );
    await qr.query(
      `UPDATE page_translations SET banner_image_alt = $2
        WHERE page_id = (SELECT id FROM pages WHERE slug = $1 AND type = 'photo-slot')`,
      [key, alt],
    );
  };

  it('🔴 слот без фото віддає null — веб малює заглушку', async () => {
    await set('route-hero', null);
    expect(await pages.photoSlot('route-hero', 'en')).toBeNull();
  });

  it('🔴 слот із фото віддає його й опис; сусідній слот не отримує чужого', async () => {
    await set('route-hero', '/banners/photo-slot-test.jpg', 'A mountain road');
    expect(await pages.photoSlot('route-hero', 'en')).toEqual({
      src: '/banners/photo-slot-test.jpg',
      alt: 'A mountain road',
    });
    expect(await pages.photoSlot('guide-hero', 'en')).toBeNull();
  });

  it('порожній рядок і пробіли — це «немає»; фото без опису лишається з порожнім alt', async () => {
    await set('route-hero', '');
    expect(await pages.photoSlot('route-hero', 'en')).toBeNull();
    await set('route-hero', '   ');
    expect(await pages.photoSlot('route-hero', 'en')).toBeNull();
    await set('route-hero', '/banners/photo-slot-test.jpg', null);
    expect(await pages.photoSlot('route-hero', 'en')).toEqual({
      src: '/banners/photo-slot-test.jpg',
      alt: '',
    });
  });

  it('🔴 слот, знятий з публікації, не віддає фото', async () => {
    await set('route-hero', '/banners/photo-slot-test.jpg');
    await qr.query(
      `UPDATE pages SET status = 'draft' WHERE slug = 'route-hero' AND type = 'photo-slot'`,
    );
    expect(await pages.photoSlot('route-hero', 'en')).toBeNull();
  });

  it('🔴 фото на сторінці ІНШОГО типу з тим самим слагом не виходить як слот', async () => {
    await qr.query(
      `DELETE FROM pages WHERE slug = 'route-hero' AND type = 'photo-slot'`,
    );
    await qr.query(
      `WITH p AS (
         INSERT INTO pages (slug, type, status, banner_image_url)
         VALUES ('route-hero', 'page', 'published', '/banners/leak.jpg')
         RETURNING id)
       INSERT INTO page_translations (page_id, language_code, title)
       SELECT id, 'en', 'x' FROM p`,
    );
    expect(await pages.photoSlot('route-hero', 'en')).toBeNull();
  });

  it('🔴 ключ не з переліку — null, і до бази навіть не ходимо', async () => {
    // Рядок, що існує в базі, але не в переліку: ключ усе одно відсікається.
    await qr.query(
      `WITH p AS (
         INSERT INTO pages (slug, type, status, banner_image_url)
         VALUES ('rogue-slot', 'photo-slot', 'published', '/banners/rogue.jpg')
         RETURNING id)
       INSERT INTO page_translations (page_id, language_code, title)
       SELECT id, 'en', 'x' FROM p`,
    );
    queries.length = 0;
    expect(await pages.photoSlot('rogue-slot', 'en')).toBeNull();
    expect(await pages.photoSlot('contact', 'en')).toBeNull();
    expect(queries).toEqual([]);
  });

  it('🔴 слоти не потрапляють у карту сайту: ні в сторінки, ні в дописи, ні в bySlug', async () => {
    expect(await pages.slugs('en')).not.toEqual(
      expect.arrayContaining(PHOTO_SLOTS.map((s) => s.key)),
    );
    for (const { key } of PHOTO_SLOTS) {
      expect(await pages.slugs('en')).not.toContain(key);
      expect(await pages.slugs('en', 'post')).not.toContain(key);
      expect(await pages.bySlug(key, 'en')).toBeNull();
    }
  });

  it('🔴 слотів рівно стільки, скільки в переліку, усі порожні на свіжій базі', async () => {
    const rows = (await qr.query(
      `SELECT p.slug, p.banner_image_url AS url, t.banner_image_alt AS alt, t.title
         FROM pages p JOIN page_translations t ON t.page_id = p.id
        WHERE p.type = 'photo-slot' ORDER BY p.slug`,
    )) as Array<{
      slug: string;
      url: string | null;
      alt: string | null;
      title: string;
    }>;
    expect(rows.map((r) => r.slug)).toEqual(
      PHOTO_SLOTS.map((s) => s.key).sort(),
    );
    expect(PHOTO_SLOTS).toHaveLength(4);
    // Власник бачить у Directus, чий це слот.
    for (const r of rows) {
      expect(r.title).toBe(PHOTO_SLOTS.find((s) => s.key === r.slug)!.title);
      // «Усі порожні» — ЗНАЧЕННЯ полів, а не лише наявність рядків.
      expect(r.url).toBeNull();
      expect(r.alt).toBeNull();
    }
  });
});
