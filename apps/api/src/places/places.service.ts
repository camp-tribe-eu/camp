import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EU_MEMBER_STATES_AND_SUBDIVISIONS, isEuMemberState } from '../osm/eu';
import { countrySql } from '../osm/route-poi-sql';
import { inReadOnlyTransaction, Queryable } from '../planner/read-only';
import { canonicalPath } from '../spots/canonical';
import { mergedNameSql, notSecondarySql } from '../spots/links';
import {
  isUnpublishedCountry,
  publishedCountrySql,
} from '../spots/unpublished-countries';
import {
  foldForSearch,
  PlaceIndex,
  rank,
  type Hit,
  type IndexEntry,
  type SuggestKind,
  type Suggestion,
} from './places-suggest';

// CAMP-456 — підказки місць.
//
// 🔴 КОЖНЕ ЧИТАННЯ БАЗИ — В ОДНІЙ ТРАНЗАКЦІЇ READ ONLY, так само, як
// `POST /plan` (plan.service.ts): це сервер, а не коментар, гарантує, що
// набраний текст не має куди потрапити, крім цього процесу. Нічого тут не
// логується.

/** Скільки живе індекс, мс: година. Новий кемпінг у підказках — не пізніше. */
export const TTL_MS = 60 * 60 * 1000;

/** Читання всіх назв — один раз на годину, тож таймаут щедрий. */
const LOAD_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 5_000;

const COUNTRY_CACHE_MAX = 5000;

/**
 * Скільки кандидатів брати з індексу до визначення країни... Кожне
 * визначення — точка в багатокутнику Natural Earth (до 38 тисяч вершин), тож
 * чим менше, тим швидше; 16 — запас на кілька точок за кордоном ЄС у
 * видачі, де міста йдуть першими.
 */
const CAPS = { place: 16, region: 6, campsite: 4 } as const;
/** ...і скільки кожного виду лишається після відсіву за країною. */
const KEEP = { place: 5, region: 3, campsite: 4 } as const;

const group = (h: Hit): keyof typeof KEEP =>
  h.kind === 'campsite' ? 'campsite' : h.kind === 'region' ? 'region' : 'place';

@Injectable()
export class PlacesService implements OnApplicationBootstrap {
  private index: { built: number; value: PlaceIndex } | null = null;
  private building: Promise<PlaceIndex> | null = null;
  /** Країна точки за «lat,lon»: див. `withCountries`. Скидається разом з індексом. */
  private readonly countries = new Map<string, string>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private async read<T>(
    timeoutMs: number,
    fn: (db: Queryable) => Promise<T>,
  ): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const db: Queryable = {
      query: async (sql, params) => ({
        rows: (await runner.query(sql, params)) as Record<string, unknown>[],
      }),
    };
    try {
      return await inReadOnlyTransaction(db, async () => {
        await db.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        return fn(db);
      });
    } finally {
      await runner.release();
    }
  }

  /**
   * Збірка на старті, у фоні: перша людина, що набрала три літери, не
   * чекає читання всієї бази. Збій тут нічого не ламає — перший запит
   * спробує сам.
   */
  onApplicationBootstrap(): void {
    void this.ready().catch(() => undefined);
  }

  /** Скинути індекс: наступний запит збере його заново. Для тестів і для оператора. */
  invalidate(): void {
    this.index = null;
    this.countries.clear();
  }

  /**
   * Індекс, а якщо він застарів чи ще не збудований — його збірка. Одночасні
   * запити чекають ОДНУ збірку, а не запускають по одній: 20 літер, набраних
   * поспіль на холодному сервері, не мають дати 20 читань усієї бази.
   * Збій збірки не запамʼятовується: наступний запит спробує знову.
   */
  private async ready(now = Date.now()): Promise<PlaceIndex> {
    if (this.index && now - this.index.built < TTL_MS) return this.index.value;
    this.building ??= this.build().then(
      (value) => {
        this.index = { built: Date.now(), value };
        this.building = null;
        return value;
      },
      (err) => {
        this.building = null;
        throw err;
      },
    );
    return this.building;
  }

  private async build(): Promise<PlaceIndex> {
    return this.read(LOAD_TIMEOUT_MS, async (db) => {
      const entries: IndexEntry[] = [];

      const places = await db.query(
        `SELECT name, place, ST_Y(ST_PointOnSurface(geom)) AS lat,
                ST_X(ST_PointOnSurface(geom)) AS lon
           FROM osm_ctx_place
          WHERE place IN ('city', 'town', 'village') AND name IS NOT NULL`,
      );
      for (const r of places.rows) {
        const name = String(r.name);
        const f = foldForSearch(name);
        if (f === '') continue;
        entries.push({
          f,
          kind: String(r.place) as SuggestKind,
          name,
          lat: Number(r.lat),
          lon: Number(r.lon),
          country: '',
        });
      }

      const regions = await db.query(
        `SELECT name, name_en, ST_Y(ST_PointOnSurface(geom)) AS lat,
                ST_X(ST_PointOnSurface(geom)) AS lon
           FROM ne_admin1`,
      );
      for (const r of regions.rows) {
        // Місцева назва й англійська — два записи про одне місце; видача
        // лишає кращий (`rank` зводить регіони за координатами).
        for (const n of [r.name, r.name_en]) {
          if (typeof n !== 'string') continue;
          const f = foldForSearch(n);
          if (f === '') continue;
          entries.push({
            f,
            kind: 'region',
            name: n,
            lat: Number(r.lat),
            lon: Number(r.lon),
            country: '',
          });
        }
      }

      const campsites = await db.query(
        `SELECT s.slug, s.country, s.region, ${mergedNameSql('s')} AS name,
                ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lon
           FROM camping_spots s
          WHERE s.missing_since IS NULL AND s.region IS NOT NULL
            AND ${publishedCountrySql('s')}
            AND ${notSecondarySql('s')}
            AND ${mergedNameSql('s')} IS NOT NULL`,
      );
      for (const r of campsites.rows) {
        const entry = campsiteEntry(r);
        if (entry) entries.push(entry);
      }
      return new PlaceIndex(entries);
    });
  }

  async suggest(q: string, limit: number): Promise<Suggestion[]> {
    const index = await this.ready();
    const hits = index.search(q, CAPS);
    const resolved = await this.withCountries(hits);
    // Лише ЄС-27 і лише опубліковані країни; ліміт кожного виду — після відсіву.
    const kept: Hit[] = [];
    const taken = { place: 0, region: 0, campsite: 0 };
    for (const h of resolved) {
      if (!isEuMemberState(h.country) || isUnpublishedCountry(h.country))
        continue;
      const g = group(h);
      if (taken[g] >= KEEP[g]) continue;
      taken[g] += 1;
      kept.push(h);
    }
    return rank(kept, limit);
  }

  /** Країни тим, що їх не мають (населені пункти й регіони) — тим самим `countrySql`, що в планувальника. */
  private async withCountries(hits: Hit[]): Promise<Hit[]> {
    const key = (h: Hit) => `${h.lat},${h.lon}`;
    // 🔴 Країна точки не міняється між літерами, які людина набирає, а
    // кандидати майже ті самі («ant» → «anto» → «antw»), тож відповідь бази
    // запамʼятовується за точкою. Межа розміру — щоб памʼять не росла від
    // кожного запиту; при переповненні скидається ціле, а не по одному.
    const need = hits.filter(
      (h) => h.country === '' && !this.countries.has(key(h)),
    );
    if (need.length > 0) {
      const res = await this.read(QUERY_TIMEOUT_MS, (db) =>
        db.query(
          `SELECT t.i::int AS i,
                  ${countrySql('ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)', '$3')} AS country
             FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat, i)`,
          [
            need.map((h) => h.lon),
            need.map((h) => h.lat),
            [...EU_MEMBER_STATES_AND_SUBDIVISIONS],
          ],
        ),
      );
      if (this.countries.size + need.length > COUNTRY_CACHE_MAX)
        this.countries.clear();
      for (const r of res.rows) {
        this.countries.set(key(need[Number(r.i) - 1]), String(r.country ?? ''));
      }
    }
    return hits.map((h) =>
      h.country === ''
        ? { ...h, country: this.countries.get(key(h)) ?? '' }
        : h,
    );
  }

  /** Кемпінг за slug: точка для `/plan?to=<slug>`. `null` — такого немає. Читає базу, а не індекс. */
  async campsite(slug: string): Promise<Suggestion | null> {
    const rows = await this.read(QUERY_TIMEOUT_MS, (db) =>
      db.query(
        `SELECT s.slug, s.country, s.region, ${mergedNameSql('s')} AS name,
                ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lon
           FROM camping_spots s
          WHERE s.slug = $1 AND s.missing_since IS NULL AND s.region IS NOT NULL
            AND ${publishedCountrySql('s')}
            AND ${notSecondarySql('s')}
            AND ${mergedNameSql('s')} IS NOT NULL
          LIMIT 1`,
        [slug],
      ),
    );
    const entry = rows.rows[0] ? campsiteEntry(rows.rows[0]) : null;
    return entry ? rank([{ ...entry, lead: true }], 1)[0] : null;
  }
}

/**
 * Рядок кемпінгу → запис. Кемпінг без адреси сторінки не потрапляє: пропозиція,
 * яка не веде нікуди, була б обіцянкою без сторінки (`canonicalPath` повертає
 * `null` для такого, і це його чесна відповідь).
 */
function campsiteEntry(r: Record<string, unknown>): IndexEntry | null {
  const country = String(r.country).toLowerCase();
  const path = canonicalPath(
    country,
    r.region as string | null,
    String(r.slug),
  );
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const name = String(r.name);
  if (!path || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const f = foldForSearch(name);
  if (f === '') return null;
  return {
    f,
    kind: 'campsite',
    name,
    lat,
    lon,
    country,
    slug: String(r.slug),
    path,
  };
}
