import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Redirect,
  Req,
} from '@nestjs/common';
import { clientKey } from '../throttle';
import { parseBrowserEvent, parseSlug, parseSurface } from './events.rules';
import { EventsService } from './events.service';
import type { Visitor } from './events.service';

/** Адреса сайту кемпінгу, яку ВІДДАЄ редирект: лише http(s), лише з бази. */
export function safeWebsite(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function visitorOf(
  req: { ip?: string; headers?: Record<string, unknown> },
  userAgent: string | undefined,
): Visitor {
  const headers = req.headers ?? {};
  return { ip: clientKey(headers, req.ip ?? 'unknown'), userAgent };
}

// CAMP-504 — запис подій. Без cookies, без згоди, без персональних даних у
// базі: IP і user-agent живуть у цьому запиті й у хеші в памʼяті на добу.
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   *   POST /events  { "event": "spot_view", "slug": "…", "ref": "google.com" }
   *
   * 202 і без тіла: браузер не чекає й не падає через відповідь. `ref` —
   * лише щоб визначити КЛАС джерела; сам рядок далі цього методу не йде.
   */
  @Post('events')
  @HttpCode(202)
  async record(
    @Body() body: Record<string, unknown>,
    @Headers('user-agent') userAgent: string | undefined,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    const event = parseBrowserEvent(body?.event);
    const slug = parseSlug(body?.slug);
    if (event === null || slug === null) throw new BadRequestException();
    await this.events.recordSpotEvent(
      slug,
      event,
      body?.ref,
      visitorOf(req, userAgent),
    );
  }

  /** POST /events/zero  { "surface": "map", "filters": ["type:free", "overnight"] } */
  @Post('events/zero')
  @HttpCode(202)
  async recordZero(
    @Body() body: Record<string, unknown>,
    @Headers('user-agent') userAgent: string | undefined,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    const surface = parseSurface(body?.surface);
    if (surface === null) throw new BadRequestException();
    const outcome = await this.events.recordZeroResult(
      surface,
      body?.filters,
      visitorOf(req, userAgent),
    );
    if (outcome === 'invalid') throw new BadRequestException();
  }

  /**
   *   GET /out/:slug  →  302 на сайт кемпінгу
   *
   * 🔴 НЕ ВІДКРИТИЙ РЕДИРЕКТ. Адреса призначення береться з БАЗИ за slug
   * кемпінгу й більше ні звідки: у запиті немає параметра `url`, `to`,
   * `next` — і код його не читає. Невідомий slug, кемпінг без сайту або
   * адреса не http(s) — 404, не перехід.
   *
   * Рахунок не блокує перехід: якщо запис упав, людина все одно потрапляє
   * на сайт.
   */
  @Get('out/:slug')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async out(
    @Param('slug') rawSlug: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    const slug = parseSlug(rawSlug);
    if (slug === null) throw new NotFoundException();
    const spot = await this.events.lookup(slug);
    const url = safeWebsite(spot?.website);
    if (!spot || url === null) throw new NotFoundException();
    try {
      await this.events.countSpot(
        spot.id,
        'website_click',
        'direct',
        visitorOf(req, userAgent),
      );
    } catch {
      // Рахунок — побічна справа; перехід важливіший.
    }
    return { url, statusCode: 302 };
  }
}
