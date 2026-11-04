import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { RentalProvidersService } from './rental-providers.service';

// CAMP-371, пункт 3: фільтр «який вен чи причеп шукаєте» — проти справжніх
// рядків, через справжній SQL сервісу.
//
// 🔴 КОЖНЕ ОЧІКУВАНЕ ЧИСЛО НИЖЧЕ ПОРАХОВАНЕ РУКАМИ З ТРЬОХ КОМПАНІЙ, ЗАСІЯНИХ
// ТУТ, а не прогоном модуля двічі. Компанії обрані так, щоб кожна гілка
// мала свідка:
//
//   alpha  — один ван, один напівінтегрований, ДВІ машини без типу
//   bravo  — один ван, жодної без типу
//   charlie — три машини, і ЖОДНА не має типу: саме її читач, що обрав
//             «ван», не побачить, і саме про неї мусить сказати число
//   delta  — ван, але `draft`: назовні не виходить, і в числа теж
//
// Отже «ван» → alpha і bravo (2 із 3 опублікованих); машин без типу
// 2 + 0 + 3 = 5, і це число мусить бути ПОРАХОВАНЕ, а не записане.
//
// 🔴 ТАКСОНОМІЯ БЕРЕТЬСЯ З ТОГО Ж ФАЙЛУ, ЩО Й СІВАЛКА
// (`camper-types.seed.json`), а не з переліку в тесті: копія пʼяти слагів
// тут стерегла б копію, і шостий тип у сіді пройшов би повз.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP, як і в сусідніх
// `*.db.spec.ts`. Файл створює власну базу `camp371_*` зі справжніх
// міграцій і прибирає її; у названій базі не читає й не пише нічого.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: DataSource;
let dbName: string;
let service: RentalProvidersService;

interface SeedType {
  slug: string;
  position: number;
  licenceClass: string;
  status: string;
  translations: {
    en: { name: string; altNames?: string; description?: string };
  };
}

const TAXONOMY = (
  JSON.parse(
    readFileSync(join(__dirname, 'camper-types.seed.json'), 'utf8'),
  ) as { types: SeedType[] }
).types;

/** Машини однієї компанії: тип або `null`, і тоді без жодного доказу. */
type Vehicle = { name: string; type: string | null };

const COMPANIES: {
  slug: string;
  status: 'published' | 'draft';
  vehicles: Vehicle[];
}[] = [
  {
    slug: 'alpha',
    status: 'published',
    vehicles: [
      { name: 'Alpha Van', type: 'van' },
      { name: 'Alpha Low', type: 'lowprofile' },
      { name: 'Alpha Unknown 1', type: null },
      { name: 'Alpha Unknown 2', type: null },
    ],
  },
  {
    slug: 'bravo',
    status: 'published',
    vehicles: [{ name: 'Bravo Van', type: 'van' }],
  },
  {
    slug: 'charlie',
    status: 'published',
    vehicles: [
      { name: 'Charlie 1', type: null },
      { name: 'Charlie 2', type: null },
      { name: 'Charlie 3', type: null },
    ],
  },
  {
    slug: 'delta',
    status: 'draft',
    vehicles: [{ name: 'Delta Van', type: 'van' }],
  },
];

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp371_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;

  // Справжня схема зі справжніх міграцій, разом з обмеженням
  // `rental_provider_vehicles_type_has_evidence`: тип без доказу база
  // не прийме, і тест це знає, а не обходить.
  db = new DataSource({
    ...AppDataSource.options,
    url: url.toString(),
  } as never);
  await db.initialize();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.runMigrations();

  const typeIds = new Map<string, string>();
  for (const t of TAXONOMY) {
    const [{ id }] = (await db.query(
      `INSERT INTO camper_types (slug, position, licence_class, status)
       VALUES ($1, $2, $3::camper_types_licence_class_enum, $4::camper_types_status_enum)
       RETURNING id`,
      [t.slug, t.position, t.licenceClass, t.status],
    )) as { id: string }[];
    typeIds.set(t.slug, id);
    await db.query(
      `INSERT INTO camper_type_translations (camper_type_id, language_code, name)
       VALUES ($1, 'en', $2)`,
      [id, t.translations.en.name],
    );
  }

  for (const c of COMPANIES) {
    const [{ id }] = (await db.query(
      `INSERT INTO rental_providers (slug, name, home_country, website, source_url, status)
       VALUES ($1, $2, 'BE', 'https://example.invalid', 'https://example.invalid/about',
               $3::rental_providers_status_enum)
       RETURNING id`,
      [c.slug, c.slug.toUpperCase(), c.status],
    )) as { id: string }[];
    for (const v of c.vehicles) {
      const typeId = v.type ? typeIds.get(v.type) : null;
      if (v.type && !typeId) throw new Error(`немає типу «${v.type}» у сіді`);
      await db.query(
        `INSERT INTO rental_provider_vehicles
           (provider_id, name, slug, source_url, source_checked_on,
            camper_type_id, camper_type_said, camper_type_checked_on)
         VALUES ($1, $2, $3, 'https://example.invalid/fleet', '2026-11-02',
                 $4, $5, $6)`,
        [
          id,
          v.name,
          v.name.toLowerCase().replace(/\s+/g, '-'),
          typeId ?? null,
          typeId ? `they say: ${v.type}` : null,
          typeId ? '2026-11-03' : null,
        ],
      );
    }
  }

  service = new RentalProvidersService(db);
});

afterAll(async () => {
  await db?.destroy();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

const slugs = (items: { slug: string }[]) => items.map((i) => i.slug);

describe('фільтр за типом: звужує за словами прокатника', () => {
  it('без типу — усі три опубліковані, чернетка назовні не виходить', async () => {
    const r = await service.list({});
    expect(slugs(r)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('🔴 type=van: alpha і bravo, і ТІЛЬКИ вони', async () => {
    const r = await service.list({ camperType: 'van' });
    expect(slugs(r)).toEqual(['alpha', 'bravo']);
    for (const p of r) expect(p.camperTypeSlugs).toContain('van');
  });

  it('type=lowprofile: лише alpha', async () => {
    const r = await service.list({ camperType: 'lowprofile' });
    expect(slugs(r)).toEqual(['alpha']);
  });

  it('тип, якого ніхто не назвав, — порожньо, а не всі', async () => {
    expect(await service.list({ camperType: 'caravan' })).toEqual([]);
  });

  it('слаги типів компанії — у порядку таксономії, без повторів', async () => {
    const r = await service.list({});
    const alpha = r.find((p) => p.slug === 'alpha')!;
    expect(alpha.camperTypeSlugs).toEqual(['van', 'lowprofile']);
    expect(r.find((p) => p.slug === 'charlie')!.camperTypeSlugs).toEqual([]);
  });
});

describe('🔴 число машин без типу — порахованe, а не записане', () => {
  it('у кожної компанії — її власне число: 2, 0, 3', async () => {
    const r = await service.list({});
    expect(
      Object.fromEntries(r.map((p) => [p.slug, p.untypedVehicleCount])),
    ).toEqual({ alpha: 2, bravo: 0, charlie: 3 });
  });

  it('разом 5 — і це число не збігається ні з кількістю компаній, ні з машинами', async () => {
    const r = await service.list({});
    const hidden = r.reduce((n, p) => n + p.untypedVehicleCount, 0);
    expect(hidden).toBe(5);
    expect(r.reduce((n, p) => n + p.vehicleCount, 0)).toBe(8);
  });

  it('🔴 число не залежить від обраного типу: сховано те саме, що б не обрали', async () => {
    const van = await service.list({ camperType: 'van' });
    expect(van.find((p) => p.slug === 'alpha')!.untypedVehicleCount).toBe(2);
  });
});

describe('таксономія для фільтра', () => {
  it('🔴 віддає рівно ті опубліковані типи, що в сіді, у порядку position, з назвами', async () => {
    const types = await service.camperTypes();
    const expected = TAXONOMY.filter((t) => t.status === 'published').sort(
      (a, b) => a.position - b.position,
    );
    expect(types.map((t) => t.slug)).toEqual(expected.map((t) => t.slug));
    expect(types.map((t) => t.name)).toEqual(
      expected.map((t) => t.translations.en.name),
    );
    // Щоб «рівно ті» щось означало: у сіді їх справді пʼять.
    expect(types.length).toBe(5);
  });
});
