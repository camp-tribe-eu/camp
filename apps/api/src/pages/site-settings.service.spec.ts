import { DataSource, type QueryRunner } from 'typeorm';
import { parseSocialLinks, SiteSettingsService } from './site-settings.service';

/**
 * CAMP-481 — налаштування сайту читаються з бази, а не вгадуються.
 *
 * 🔴 ПЕРЕВІРЯЄТЬСЯ НА СПРАВЖНІЙ ТАБЛИЦІ, А НЕ НА ТЕКСТІ ЗАПИТУ. Тест,
 * що шукає `singleton` у рядку SQL, лишився б зеленим і тоді, коли
 * предикат стоїть не в тій дужці або порівнює не те поле. Рядки
 * саджаються й відкочуються, як у `pages.service.spec.ts`.
 *
 * 🔴 ОКРЕМИЙ ВИПАДОК «ПОРОЖНІЙ РЯДОК» — ГОЛОВНИЙ ТУТ. Саме він
 * відрізняє «редактор стер текст» від «тексту немає», і саме його
 * проґавив би тест, що садить лише заповнені значення: порожній рядок
 * доїхав би до вебу як `''`, і підвал намалював би порожній абзац.
 */
describe('SiteSettingsService: що доїжджає до вебу', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let service: SiteSettingsService;

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
    service = new SiteSettingsService(qr as unknown as DataSource);

    // Сьогоднішній рядок тесту не належить: міграція вже могла посіяти
    // свій, і тоді перевірка читала б чуже значення.
    await qr.query(`DELETE FROM site_settings_translations`);
    await qr.query(`DELETE FROM site_settings`);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  const seed = async (tagline: string | null, footerNote: string | null) => {
    const rows = (await qr.query(
      `INSERT INTO site_settings (singleton) VALUES (true) RETURNING id`,
    )) as Array<{ id: string }>;
    await qr.query(
      `INSERT INTO site_settings_translations (settings_id, language_code, tagline, footer_note)
       VALUES ($1, 'en', $2, $3)`,
      [rows[0].id, tagline, footerNote],
    );
  };

  it('віддає те, що вписав редактор', async () => {
    await seed('Підпис сайту', 'Речення підвалу');
    expect(await service.get('en')).toEqual({
      tagline: 'Підпис сайту',
      footerNote: 'Речення підвалу',
      socialLinks: [],
    });
  });

  it('🔴 стертий текст доїжджає як null, а не як порожній рядок', async () => {
    await seed('   ', '');
    const got = await service.get('en');
    expect(got.tagline).toBeNull();
    expect(got.footerNote).toBeNull();
  });

  it('🔴 немає рядка зовсім — null, а не падіння', async () => {
    expect(await service.get('en')).toEqual({
      tagline: null,
      footerNote: null,
      socialLinks: [],
    });
  });

  it('🔴 чужа мова не підміняє англійську', async () => {
    await seed('Підпис сайту', 'Речення підвалу');
    // Переклад, якого немає, мусить дати порожнечу, а не англійський
    // текст: мовчазне падіння на мову за замовчуванням зробило б
    // неперекладену сторінку невідрізненною від перекладеної.
    expect(await service.get('fr')).toEqual({
      tagline: null,
      footerNote: null,
      socialLinks: [],
    });
  });

  it('🔴 CAMP-448: соцмережі йдуть із бази й не залежать від мови', async () => {
    await seed('Підпис сайту', 'Речення підвалу');
    await qr.query(`UPDATE site_settings SET social_links = $1::jsonb`, [
      JSON.stringify({
        facebook: 'https://www.facebook.com/camptribe',
        instagram: 'https://www.instagram.com/camptribe',
      }),
    ]);
    const en = await service.get('en');
    // Порядок — порядок кнопок (SOCIAL_NETWORKS), а не порядок ключів у базі.
    expect(en.socialLinks.map((l) => l.network)).toEqual([
      'instagram',
      'facebook',
    ]);
    // Мови без перекладу тексту кнопки не зникають: LEFT JOIN, не JOIN.
    const fr = await service.get('fr');
    expect(fr.tagline).toBeNull();
    expect(fr.socialLinks).toHaveLength(2);
  });
});

describe('parseSocialLinks: один зіпсований запис коштує одного запису', () => {
  const good = 'https://www.instagram.com/camptribe';

  it('порожня база, не обʼєкт і масив — жодної кнопки', () => {
    expect(parseSocialLinks({})).toEqual([]);
    expect(parseSocialLinks(null)).toEqual([]);
    expect(parseSocialLinks('x')).toEqual([]);
    expect(parseSocialLinks([good])).toEqual([]);
  });

  it('🔴 небезпечна, чужа й порожня адреси відпадають поодинці', () => {
    const got = parseSocialLinks({
      instagram: good,
      facebook: 'javascript:alert(1)',
      youtube: 'http://youtube.com/c/x',
      tiktok: '   ',
      x: 42,
      linkedin: 'not a url',
      myspace: 'https://myspace.com/x',
    });
    expect(got).toEqual([{ network: 'instagram', url: good }]);
  });
});
