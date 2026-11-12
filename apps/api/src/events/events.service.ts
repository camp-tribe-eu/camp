import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpotEventDaily } from '../entities/spot-event-daily.entity';
import { ZeroResultSearchDaily } from '../entities/zero-result-search-daily.entity';
import { DailyDedup } from './dedup';
import {
  canonicalFilters,
  classifyReferrer,
  isBot,
  ownHosts,
  utcDay,
} from './events.rules';
import type { SourceClass, SpotEvent, Surface } from './events.rules';

/** Хто питає. IP і UA існують лише в цьому обʼєкті, на час запиту. */
export interface Visitor {
  ip: string;
  userAgent: string | undefined;
}

export type Outcome =
  'counted' | 'bot' | 'duplicate' | 'unknown_spot' | 'invalid';

/**
 * CAMP-504 — єдине місце, де подія стає рядком у базі.
 *
 * Порядок завжди один: БОТ → чи існує обʼєкт → ДЕДУПЛІКАЦІЯ → запис.
 * Дедуплікація стоїть ПІСЛЯ перевірки обʼєкта, щоб вигадані slug-и не
 * заповнювали памʼять.
 *
 * 🔴 ЗАПИС — `INSERT … ON CONFLICT DO UPDATE SET n = n + 1`: один рядок на
 * день, а не рядок на подію.
 */
@Injectable()
export class EventsService {
  private readonly dedup = new DailyDedup();

  constructor(
    @InjectRepository(SpotEventDaily)
    private readonly spots: Repository<SpotEventDaily>,
    @InjectRepository(ZeroResultSearchDaily)
    private readonly zero: Repository<ZeroResultSearchDaily>,
  ) {}

  /** id кемпінгу і його сайт — з БАЗИ, за slug. Нічого з запиту не береться. */
  async lookup(
    slug: string,
  ): Promise<{ id: string; website: string | null } | null> {
    const rows: Array<{ id: string; website: string | null }> =
      await this.spots.query(
        `SELECT id, COALESCE(website, contact->>'website') AS website
           FROM camping_spots WHERE slug = $1 LIMIT 1`,
        [slug],
      );
    return rows[0] ?? null;
  }

  async recordSpotEvent(
    slug: string,
    event: SpotEvent,
    ref: unknown,
    visitor: Visitor,
    now: Date = new Date(),
  ): Promise<Outcome> {
    if (isBot(visitor.userAgent)) return 'bot';
    const spot = await this.lookup(slug);
    if (!spot) return 'unknown_spot';
    return this.countSpot(
      spot.id,
      event,
      classifyReferrer(ref, ownHosts()),
      visitor,
      now,
    );
  }

  /** Для редиректу: кемпінг уже знайдено, бот-фільтр і дедуплікація ті самі. */
  async countSpot(
    spotId: string,
    event: SpotEvent,
    source: SourceClass,
    visitor: Visitor,
    now: Date = new Date(),
  ): Promise<Outcome> {
    if (isBot(visitor.userAgent)) return 'bot';
    const day = utcDay(now);
    if (
      this.dedup.seen({
        ip: visitor.ip,
        userAgent: visitor.userAgent ?? '',
        object: spotId,
        event,
        day,
      })
    )
      return 'duplicate';
    await this.spots.query(
      `INSERT INTO spot_event_daily (day, camping_spot_id, event, source, n)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (day, camping_spot_id, event, source)
       DO UPDATE SET n = spot_event_daily.n + 1`,
      [day, spotId, event, source],
    );
    return 'counted';
  }

  /**
   * Кемпінги, що потрапили у згенерований маршрут. Одне планування — по
   * одній події на кемпінг; повторний запит того самого відвідувача за добу
   * не додає нічого.
   */
  async recordRouteInclusion(
    slugs: string[],
    visitor: Visitor,
    now: Date = new Date(),
  ): Promise<number> {
    if (slugs.length === 0 || isBot(visitor.userAgent)) return 0;
    const rows: Array<{ id: string }> = await this.spots.query(
      `SELECT id FROM camping_spots WHERE slug = ANY($1::text[])`,
      [slugs],
    );
    let counted = 0;
    for (const { id } of rows) {
      if (
        (await this.countSpot(
          id,
          'route_inclusion',
          'direct',
          visitor,
          now,
        )) === 'counted'
      )
        counted += 1;
    }
    return counted;
  }

  async recordZeroResult(
    surface: Surface,
    filters: unknown,
    visitor: Visitor,
    now: Date = new Date(),
  ): Promise<Outcome> {
    const key = canonicalFilters(filters);
    if (key === null) return 'invalid';
    if (isBot(visitor.userAgent)) return 'bot';
    const day = utcDay(now);
    if (
      this.dedup.seen({
        ip: visitor.ip,
        userAgent: visitor.userAgent ?? '',
        object: `${surface}|${key}`,
        event: 'zero_result',
        day,
      })
    )
      return 'duplicate';
    await this.zero.query(
      `INSERT INTO zero_result_search_daily (day, surface, filters, n)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (day, surface, filters)
       DO UPDATE SET n = zero_result_search_daily.n + 1`,
      [day, surface, key],
    );
    return 'counted';
  }
}
