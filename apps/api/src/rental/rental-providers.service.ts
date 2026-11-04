import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-427 — читання каталогу прокатних компаній.
//
// 🔴 Назовні виходять лише `published`. Чернетка — чиясь недописана думка,
// а каталог порівнює компанії МІЖ СОБОЮ: показати недописаний рядок поруч
// із дописаним означає сказати про компанію неправду чужими руками.
//
// 🔴 ЦИФР РЕЙТИНГУ ТУТ НЕМАЄ, і це друга лінія того самого замка. База вже
// не дає покласти `rating` без дати письмового дозволу
// (`rental_provider_review_profiles_figures_need_permission`), але сервіс
// повторює правило САМ: якби завтра хтось послабив схему, запит усе одно
// не віддасть цифру без дозволу. Два незалежні відмовники, бо кожен із них
// цінний рівно тоді, коли другий обійдено.

export interface ReviewProfileView {
  source: string;
  profileUrl: string;
  /** Null, доки немає письмового дозволу показувати цифру. */
  rating: string | null;
  reviewCount: number | null;
}

export interface ProviderListItem {
  slug: string;
  name: string;
  homeCountry: string;
  website: string | null;
  /** 🔴 ЗАЯВЛЕНІ компанією, не зміряні нами. Сторінка мусить це казати. */
  declaredDepotCount: number | null;
  declaredFleetSize: number | null;
  foundedYear: number | null;
  serviceCount: number;
  vehicleCount: number;
  /**
   * 🔴 Коди сервісів, які компанія ДАЄ — `included` або `extra`, ніколи
   * `unavailable`. Сайт статичний і звужує список у браузері; без цього
   * поля йому довелось би судити про наявність сервісу з його кількості,
   * тобто вгадувати.
   */
  serviceCodes: string[];
  /**
   * 🔴 Країни, де компанія ВИДАЄ МАШИНИ, а не де зареєстрована. На
   * десяти зібраних компаніях прописок чотири, а країн роботи двадцять:
   * фільтр по прописці відповідав би «ніхто» там, де насправді сім
   * компаній.
   */
  countries: string[];
  reviewProfiles: ReviewProfileView[];
  /**
   * 🔴 CAMP-371. Слаги типів, які ПРОКАТНИК САМ назвав хоча б для однієї
   * своєї машини (`camper_type_said` поруч із кожним). Порядок — як у
   * таксономії, щоб два рядки каталогу не перелічували те саме в різному
   * порядку.
   */
  camperTypeSlugs: string[];
  /**
   * 🔴 CAMP-371. Машини БЕЗ типу — ті, де прокатник ніде його не написав,
   * а вигадувати заборонено. Число порахованe в SQL, а не виведене з
   * `vehicleCount - типові`: читач, що обрав «ван», мусить побачити,
   * скільки машин сховано не тому, що вони не вани, а тому, що про них
   * невідомо. Без цього числа фільтр каже «таких немає» там, де насправді
   * «ми не знаємо», — і це брехня мовчанням.
   */
  untypedVehicleCount: number;
}

/** Відповідь `/rental/camper-types` — таксономія, якою звужує каталог. */
export interface CamperTypeView {
  slug: string;
  name: string;
  position: number;
}

/**
 * Дозволені ключі сортування → вираз SQL.
 *
 * 🔴 ПЕРЕЛІК, А НЕ ПІДСТАВЛЯННЯ РЯДКА. Ключ із запиту ніколи не потрапляє
 * в SQL: у запит іде значення з цієї мапи. Інакше `?sort=` стає діркою для
 * ін'єкції, і жоден тест на «сортування працює» цього не побачить.
 */
export const SORTS: Readonly<Record<string, string>> = Object.freeze({
  name: 'p.name ASC',
  depots: 'p.declared_depot_count DESC NULLS LAST, p.name ASC',
  fleet: 'p.declared_fleet_size DESC NULLS LAST, p.name ASC',
  oldest: 'p.founded_year ASC NULLS LAST, p.name ASC',
});

export const DEFAULT_SORT = 'name';

/**
 * 🔴 НЕВІДОМИЙ КЛЮЧ — ПОМИЛКА, А НЕ ТИХЕ ЗАМОВЧУВАННЯ.
 *
 * Мовчазне падіння на сортування за замовчуванням виглядає для читача як
 * «сортування не працює», а для нас — як зелений тест: сторінка ж
 * віддалась. Хай краще скаже, що ключа немає.
 */
export function sortClause(key: string | undefined): string {
  const chosen = key ?? DEFAULT_SORT;
  const clause = SORTS[chosen];
  if (!clause) {
    throw new BadRequestException(
      `невідоме сортування «${chosen}»; доступні: ${Object.keys(SORTS).join(', ')}`,
    );
  }
  return clause;
}

export interface ProviderFilters {
  /** ISO-3166-1 alpha-2, великими. */
  country?: string;
  /** Коди сервісів, які мусять бути `included` АБО `extra`. */
  services?: string[];
  /**
   * Слаг типу з `camper_types`: компанія мусить мати хоча б одну машину
   * цього типу, названого САМИМ прокатником. Машини без типу не рахуються
   * ні за, ні проти — їх кількість іде окремим полем.
   */
  camperType?: string;
}

/**
 * Слаг типу — з того ж словника, що й `camper_types.slug` (`^[a-z0-9_]+$`).
 * Порожнє — «без фільтра». Чужий, але правильно складений слаг просто не
 * знайде жодної машини: це не помилка запиту, а порожня відповідь.
 */
export function normaliseCamperType(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  const slug = value.trim();
  if (!/^[a-z0-9_]+$/.test(slug)) {
    throw new BadRequestException(`«${value}» не схоже на слаг типу кемпера`);
  }
  return slug;
}

/** Країна — рівно дві літери. Усе інше відмовляємо, а не шукаємо мовчки. */
export function normaliseCountry(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  const up = value.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) {
    throw new BadRequestException(
      `«${value}» не схоже на код країни ISO-3166-1 alpha-2`,
    );
  }
  return up;
}

/** Коди сервісів — із того ж словника, що й у базі (`^[a-z0-9_]+$`). */
export function normaliseServices(
  value: string | string[] | undefined,
): string[] {
  const list =
    value === undefined ? [] : Array.isArray(value) ? value : value.split(',');
  const codes = list.map((s) => s.trim()).filter((s) => s !== '');
  const bad = codes.filter((c) => !/^[a-z0-9_]+$/.test(c));
  if (bad.length) {
    throw new BadRequestException(
      `не схоже на коди сервісів: ${bad.join(', ')}`,
    );
  }
  return codes;
}

@Injectable()
export class RentalProvidersService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(
    filters: ProviderFilters,
    sort?: string,
  ): Promise<ProviderListItem[]> {
    const params: unknown[] = [];
    const where: string[] = [`p.status = 'published'`];

    if (filters.country) {
      params.push(filters.country);
      where.push(`EXISTS (
        SELECT 1 FROM rental_provider_countries rc
        WHERE rc.provider_id = p.id AND rc.country = $${params.length}
      )`);
    }
    // 🔴 Кожен названий сервіс — ОКРЕМА умова існування, а не `IN (…)`.
    // `IN` дав би «має хоча б один із», тобто фільтр «тільки з душем і
    // велокріпленням» повертав би й тих, у кого лише велокріплення.
    for (const code of filters.services ?? []) {
      params.push(code);
      where.push(`EXISTS (
        SELECT 1 FROM rental_provider_services s
        WHERE s.provider_id = p.id
          AND s.code = $${params.length}
          AND s.availability <> 'unavailable'
      )`);
    }
    // 🔴 CAMP-371. Тип звужує за словами ПРОКАТНИКА: `camper_type_id`
    // стоїть лише там, де поруч лежить `camper_type_said` (обмеження
    // `rental_provider_vehicles_type_has_evidence`). Машина без типу не
    // проходить фільтр — і не має проходити, бо ми не знаємо, що вона
    // таке; але скільки їх, каже `untyped_vehicle_count` нижче.
    if (filters.camperType) {
      params.push(filters.camperType);
      where.push(`EXISTS (
        SELECT 1 FROM rental_provider_vehicles v
        JOIN camper_types ct ON ct.id = v.camper_type_id
        WHERE v.provider_id = p.id AND ct.slug = $${params.length}
      )`);
    }

    const rows = (await this.db.query(
      `SELECT p.slug, p.name, p.home_country, p.website,
              p.declared_depot_count, p.declared_fleet_size, p.founded_year,
              (SELECT count(*) FROM rental_provider_services s
                WHERE s.provider_id = p.id) AS service_count,
              (SELECT count(*) FROM rental_provider_vehicles v
                WHERE v.provider_id = p.id) AS vehicle_count,
              (SELECT count(*) FROM rental_provider_vehicles v
                WHERE v.provider_id = p.id
                  AND v.camper_type_id IS NULL) AS untyped_vehicle_count,
              COALESCE((SELECT array_agg(t.slug ORDER BY t.position, t.slug)
                          FROM (SELECT DISTINCT ct.slug, ct.position
                                  FROM rental_provider_vehicles v
                                  JOIN camper_types ct ON ct.id = v.camper_type_id
                                 WHERE v.provider_id = p.id) t), '{}') AS camper_type_slugs,
              COALESCE((SELECT array_agg(s.code ORDER BY s.code)
                          FROM rental_provider_services s
                         WHERE s.provider_id = p.id
                           AND s.availability <> 'unavailable'), '{}') AS service_codes,
              COALESCE((SELECT array_agg(rc.country ORDER BY rc.country)
                          FROM rental_provider_countries rc
                         WHERE rc.provider_id = p.id), '{}') AS countries
         FROM rental_providers p
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortClause(sort)}`,
      params,
    )) as Record<string, string | number | null>[];

    const profiles = await this.reviewProfilesBySlug(
      rows.map((r) => String(r.slug)),
    );

    return rows.map((r) => ({
      slug: String(r.slug),
      name: String(r.name),
      homeCountry: String(r.home_country),
      website: (r.website as string | null) ?? null,
      declaredDepotCount: num(r.declared_depot_count),
      declaredFleetSize: num(r.declared_fleet_size),
      foundedYear: num(r.founded_year),
      serviceCount: Number(r.service_count),
      vehicleCount: Number(r.vehicle_count),
      serviceCodes: (r.service_codes as unknown as string[]) ?? [],
      countries: (r.countries as unknown as string[]) ?? [],
      reviewProfiles: profiles.get(String(r.slug)) ?? [],
      camperTypeSlugs: (r.camper_type_slugs as unknown as string[]) ?? [],
      untypedVehicleCount: Number(r.untyped_vehicle_count),
    }));
  }

  /**
   * 🔴 CAMP-371. ТАКСОНОМІЯ БЕРЕТЬСЯ З БАЗИ, А НЕ З КОНСТАНТИ В КОДІ.
   *
   * Пʼять типів живуть у `camper_types` і засіваються з
   * `camper-types.seed.json`, де кожен несе джерело. Перелік у коді був
   * би другим описом того самого, і розійшлися б вони тихо: шостий тип у
   * сіді — і фільтр його не показує, а тест на «пʼять типів» зелений.
   * Порядок — `position`, як у таксономії; назва — з перекладу, щоб
   * читач не бачив `lowprofile`.
   */
  async camperTypes(): Promise<CamperTypeView[]> {
    const rows = (await this.db.query(
      `SELECT ct.slug, ct.position, ctt.name
         FROM camper_types ct
         JOIN camper_type_translations ctt
           ON ctt.camper_type_id = ct.id AND ctt.language_code = $1
        WHERE ct.status = 'published'
        ORDER BY ct.position, ct.slug`,
      ['en'],
    )) as { slug: string; position: number; name: string }[];
    return rows.map((r) => ({
      slug: String(r.slug),
      name: String(r.name),
      position: Number(r.position),
    }));
  }

  async bySlug(slug: string) {
    const rows = (await this.db.query(
      `SELECT p.* FROM rental_providers p
        WHERE p.slug = $1 AND p.status = 'published'`,
      [slug],
    )) as Record<string, unknown>[];
    if (rows.length === 0)
      throw new NotFoundException(`немає провайдера «${slug}»`);
    const p = rows[0];

    const services = (await this.db.query(
      `SELECT code, availability, note, source_url, source_checked_on
         FROM rental_provider_services
        WHERE provider_id = $1
        ORDER BY availability, code`,
      [p.id],
    )) as Record<string, unknown>[];

    // 🔴 CAMP-371. ТИП ЇДЕ РАЗОМ ІЗ ДОКАЗОМ І ВЛАСНОЮ ДАТОЮ.
    //
    // `LEFT JOIN`, бо тип є лише в 30 машин зі 115: порожнє поле чесніше
    // за тип, виведений із довжини. Назва береться з перекладу, а не зі
    // слага — читач не має читати `lowprofile`.
    const vehicles = (await this.db.query(
      `SELECT v.name, v.slug, v.berths, v.belted_seats, v.length_cm,
              v.source_url, v.source_checked_on,
              ct.slug AS camper_type_slug,
              ctt.name AS camper_type_name,
              v.camper_type_said, v.camper_type_checked_on
         FROM rental_provider_vehicles v
         LEFT JOIN camper_types ct ON ct.id = v.camper_type_id
         LEFT JOIN camper_type_translations ctt
                ON ctt.camper_type_id = ct.id AND ctt.language_code = $2
        WHERE v.provider_id = $1
        ORDER BY v.name`,
      [p.id, 'en'],
    )) as Record<string, unknown>[];

    const tr = (await this.db.query(
      `SELECT intro, what_to_know FROM rental_provider_translations
        WHERE provider_id = $1 AND language_code = $2`,
      [p.id, 'en'],
    )) as Record<string, string | null>[];

    return {
      slug: p.slug,
      name: p.name,
      intro: tr[0]?.intro ?? null,
      whatToKnow: tr[0]?.what_to_know ?? null,
      legalName: p.legal_name ?? null,
      registrationNumber: p.registration_number ?? null,
      homeCountry: p.home_country,
      website: p.website ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      declaredDepotCount: num(p.declared_depot_count as never),
      declaredFleetSize: num(p.declared_fleet_size as never),
      foundedYear: num(p.founded_year as never),
      sourceUrl: p.source_url ?? null,
      sourceCheckedOn: p.source_checked_on ?? null,
      countries: (
        (await this.db.query(
          `SELECT country FROM rental_provider_countries
            WHERE provider_id = $1 ORDER BY country`,
          [p.id],
        )) as { country: string }[]
      ).map((r) => r.country),
      services,
      vehicles,
      reviewProfiles:
        (await this.reviewProfilesBySlug([String(p.slug)])).get(
          String(p.slug),
        ) ?? [],
    };
  }

  /**
   * 🔴 `CASE WHEN permission_confirmed_on IS NULL THEN NULL` — це і є друга
   * лінія замка. Навіть якби в рядку лежала цифра, без дати дозволу вона
   * звідси не вийде.
   */
  private async reviewProfilesBySlug(
    slugs: string[],
  ): Promise<Map<string, ReviewProfileView[]>> {
    const out = new Map<string, ReviewProfileView[]>();
    if (slugs.length === 0) return out;
    const rows = (await this.db.query(
      `SELECT p.slug, r.source, r.profile_url,
              CASE WHEN r.permission_confirmed_on IS NULL THEN NULL ELSE r.rating END AS rating,
              CASE WHEN r.permission_confirmed_on IS NULL THEN NULL ELSE r.review_count END AS review_count
         FROM rental_provider_review_profiles r
         JOIN rental_providers p ON p.id = r.provider_id
        WHERE p.slug = ANY($1)
        ORDER BY r.source`,
      [slugs],
    )) as Record<string, string | number | null>[];
    for (const r of rows) {
      const slug = String(r.slug);
      const list = out.get(slug) ?? [];
      list.push({
        source: String(r.source),
        profileUrl: String(r.profile_url),
        rating: (r.rating as string | null) ?? null,
        reviewCount: r.review_count === null ? null : Number(r.review_count),
      });
      out.set(slug, list);
    }
    return out;
  }
}

const num = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);
