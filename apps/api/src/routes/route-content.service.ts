import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Маршрути з бази — CAMP-479.
 *
 * Факти лежать у `routes` і `route_points`, проза — у `pages` того ж
 * слага з `type = 'route'`. Цей сервіс зводить їх назад у ту форму, яку
 * сторінка вже вміє малювати.
 *
 * 🔴 РОЛЬ СЕКЦІЇ ЧИТАЄТЬСЯ ЗІ `slot`, А НЕ З НОМЕРА ПО ПОРЯДКУ.
 * Редактор має право переставити секції місцями. Збирання за `sort`
 * віддало б «дороги» там, де сторінка чекає «сезон», — і зробило б це
 * мовчки, бо обидва поля це текст.
 */

export interface RoutePoi {
  name: string;
  what: string;
}

export interface RouteStageView {
  name: string;
  lat: number;
  lon: number;
  nights: number;
  why: string;
  pois: RoutePoi[];
}

export interface RouteView {
  slug: string;
  name: string;
  region: string | null;
  countries: string[];
  days: number;
  months: number[];
  suits: string[];
  summary: string;
  seasonNote: string;
  roads: string;
  intro: string[];
  attribution: string;
  curatedAt: string | null;
  stages: RouteStageView[];
}

interface SectionRow {
  slot: string | null;
  heading: string | null;
  body: string | null;
  items: unknown;
}

interface RouteRow {
  slug: string;
  region: string | null;
  countries: string[] | null;
  duration_days: number;
  months: number[] | null;
  suits: string[] | null;
  curated_at: string | null;
  title: string | null;
  meta_description: string | null;
  sections: SectionRow[] | null;
  stages: Array<{
    name: string | null;
    lat: number;
    lon: number;
    nights: number | null;
  }> | null;
}

/**
 * 🔴 ОДИН ЗАПИТ НА ВСЕ, А НЕ ЗАПИТ НА КОЖЕН МАРШРУТ. Перелік маршрутів
 * будується на сторінці `/routes`, а сторінок кемпінгів у нас понад
 * пʼятдесят тисяч: звичка робити «запит у циклі» коштує тут не
 * мілісекунд, а хвилин збірки.
 */
const SQL = `
  SELECT r.slug,
         r.region,
         r.countries,
         r.duration_days,
         r.months,
         r.suits,
         to_char(r.curated_at, 'YYYY-MM-DD') AS curated_at,
         t.title,
         t.meta_description,
         (SELECT json_agg(json_build_object(
                   'slot', s.slot, 'heading', st.heading,
                   'body', st.body, 'items', st.items)
                 ORDER BY s.sort)
            FROM page_sections s
            JOIN page_section_translations st
              ON st.section_id = s.id AND st.language_code = $1
           WHERE s.page_id = p.id AND s.visible) AS sections,
         (SELECT json_agg(json_build_object(
                   'name', rp.name,
                   'lat', ST_Y(rp.location::geometry),
                   'lon', ST_X(rp.location::geometry),
                   'nights', rp.nights)
                 ORDER BY rp.sequence)
            FROM route_points rp
           WHERE rp.route_id = r.id) AS stages
    FROM routes r
    JOIN pages p
      ON p.slug = r.slug
     AND p.type = 'route'
     AND p.status = 'published'
    JOIN page_translations t
      ON t.page_id = p.id AND t.language_code = $1`;

@Injectable()
export class RouteContentService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async all(language = 'en'): Promise<RouteView[]> {
    const rows: RouteRow[] = await this.db.query(`${SQL} ORDER BY r.slug`, [
      language,
    ]);
    return rows.map((r) => toView(r));
  }

  async bySlug(slug: string, language = 'en'): Promise<RouteView | null> {
    const rows: RouteRow[] = await this.db.query(
      `${SQL} AND r.slug = $2 LIMIT 1`,
      [language, slug],
    );
    return rows[0] ? toView(rows[0]) : null;
  }
}

/** Секція за роллю; відсутня — порожній рядок, а не виняток. */
function bySlot(sections: SectionRow[], slot: string): SectionRow | undefined {
  return sections.find((s) => s.slot === slot);
}

function toView(r: RouteRow): RouteView {
  const sections = r.sections ?? [];
  const intro = bySlot(sections, 'intro')?.body ?? '';

  return {
    slug: r.slug,
    name: r.title ?? r.slug,
    region: r.region,
    countries: r.countries ?? [],
    days: r.duration_days,
    months: r.months ?? [],
    suits: r.suits ?? [],
    summary: r.meta_description ?? '',
    seasonNote: bySlot(sections, 'season')?.body ?? '',
    roads: bySlot(sections, 'roads')?.body ?? '',
    // 🔴 АБЗАЦИ РОЗДІЛЯЄ ПОРОЖНІЙ РЯДОК — так їх і склеїла міграція.
    // Розбивати по одному переносу означало б розсипати будь-який текст,
    // де абзац просто перенесено для читабельності.
    intro: intro ? intro.split('\n\n') : [],
    attribution: bySlot(sections, 'attribution')?.body ?? '',
    curatedAt: r.curated_at,
    stages: (r.stages ?? []).map((st, i) => {
      const sec = bySlot(sections, `stage:${i}`);
      const raw = Array.isArray(sec?.items) ? sec.items : [];
      return {
        name: st.name ?? '',
        lat: st.lat,
        lon: st.lon,
        nights: st.nights ?? 0,
        why: sec?.body ?? '',
        pois: raw
          .map((p) => p as { term?: unknown; detail?: unknown })
          .filter(
            (p) => typeof p.term === 'string' && typeof p.detail === 'string',
          )
          .map((p) => ({ name: p.term as string, what: p.detail as string })),
      };
    }),
  };
}
