import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource, type QueryRunner } from 'typeorm';
import { PagesService } from './pages.service';

/**
 * CAMP-469 — слот під власне зображення банера країни, перевірений на БАЗІ.
 *
 * Рядки правляться в транзакції, що відкочується: «зображення є» і
 * «зображення немає» садяться самі, а не читаються з сьогоднішніх даних
 * (власник міг уже щось поставити, і тоді тест залежав би від нього).
 * Сам факт «27 порожніх слотів» міряється на чистій, щойно змігрованій
 * базі і тому читає її ДО будь-якої правки.
 */
describe('CAMP-469: банер країни', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let pages: PagesService;

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
    pages = new PagesService(qr as unknown as DataSource);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  const set = (code: string, url: string | null, alt: string | null = null) =>
    Promise.all([
      qr.query(
        `UPDATE pages SET banner_image_url = $2
          WHERE slug = $1 AND type = 'camping-country'`,
        [code, url],
      ),
      qr.query(
        `UPDATE page_translations SET banner_image_alt = $2
          WHERE page_id = (SELECT id FROM pages WHERE slug = $1 AND type = 'camping-country')`,
        [code, alt],
      ),
    ]);

  it('🔴 країна, якій власник нічого не поставив, віддає null — запасний шлях', async () => {
    await set('si', null);
    expect(await pages.campingCountryBanner('si', 'en')).toBeNull();
  });

  it('🔴 країна із зображенням віддає саме його й опис', async () => {
    await set('si', '/banners/camp469-test.jpg', 'Lake Bled at dawn');
    expect(await pages.campingCountryBanner('si', 'en')).toEqual({
      src: '/banners/camp469-test.jpg',
      alt: 'Lake Bled at dawn',
    });
    // Пара: сусідня країна не отримала чужого зображення.
    expect(await pages.campingCountryBanner('at', 'en')).toBeNull();
  });

  it('код у верхньому регістрі знаходить той самий рядок', async () => {
    await set('si', '/banners/camp469-test.jpg');
    expect((await pages.campingCountryBanner('SI', 'en'))?.src).toBe(
      '/banners/camp469-test.jpg',
    );
  });

  it('порожній рядок і пробіли в CMS — це «немає»', async () => {
    await set('si', '');
    expect(await pages.campingCountryBanner('si', 'en')).toBeNull();
    await set('si', '   ');
    expect(await pages.campingCountryBanner('si', 'en')).toBeNull();
  });

  it('зображення без опису лишається, опис порожній', async () => {
    await set('si', '/banners/camp469-test.jpg', null);
    expect(await pages.campingCountryBanner('si', 'en')).toEqual({
      src: '/banners/camp469-test.jpg',
      alt: '',
    });
  });

  it('🔴 країна, знята з публікації, не віддає зображення', async () => {
    await set('si', '/banners/camp469-test.jpg');
    await qr.query(
      `UPDATE pages SET status = 'draft' WHERE slug = 'si' AND type = 'camping-country'`,
    );
    expect(await pages.campingCountryBanner('si', 'en')).toBeNull();
  });

  it('🔴 зображення, посаджене на сторінку ІНШОГО типу з тим самим слагом, не виходить', async () => {
    await qr.query(
      `INSERT INTO pages (slug, type, status, banner_image_url)
       VALUES ('zz', 'page', 'published', '/banners/leak.jpg')`,
    );
    expect(await pages.campingCountryBanner('zz', 'en')).toBeNull();
  });

  it('🔴 слотів рівно стільки, скільки держав ЄС-27, і всі порожні на свіжій базі', async () => {
    const members = Object.keys(
      JSON.parse(
        readFileSync(
          join(__dirname, '..', 'osm', 'eu-member-states.json'),
          'utf8',
        ),
      ).members,
    ).sort();
    const rows = (await qr.query(
      `SELECT slug FROM pages WHERE type = 'camping-country' ORDER BY slug`,
    )) as Array<{ slug: string }>;
    expect(rows.map((r) => r.slug)).toEqual(members);
    expect(members).toHaveLength(27);
  });
});
