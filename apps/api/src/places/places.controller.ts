import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { parseSuggestQuery, SLUG, type Suggestion } from './places-suggest';
import { PlacesService } from './places.service';

// CAMP-456 — місця для форми планувальника.
//
//   POST /places/suggest   { "q": "ant", "limit": 8 }  → { items: Suggestion[] }
//   GET  /places/campsite/:slug                        → Suggestion | 404
//
// 🔴 ПІДКАЗКИ — POST, ХОЧА НІЧОГО НЕ МІНЯЮТЬ, і причина та сама, що в
// `POST /plan`: набраний текст — це місце, де людина планує бути. У рядку
// запиту він потрапив би в журнал доступу веб-сервера (політика
// приватності: «the address of the page you asked for», чотирнадцять днів),
// у журнал будь-якого проксі й в історію. У тілі він не йде нікуди, крім
// цього процесу, а процес його ніде не пише: ні журнал застосунку, ні
// таблиця (read-only транзакція в сервісі). Відповідь — 200, бо нічого не
// створено.
//
// 🔴 `GET /places/campsite/:slug` — GET, бо slug кемпінгу — це публічна адреса
// сторінки, а не чиїсь наміри: вона й так стоїть у `/plan?to=<slug>`, який
// людині дала сторінка кемпінгу.
//
// Тіло — недовірений вхід: тип, довжина, межа числа — у `parseSuggestQuery`,
// відмова — 400 із кодом, а не 500.
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Post('suggest')
  @HttpCode(200)
  async suggest(@Body() body: unknown): Promise<{ items: Suggestion[] }> {
    const rec =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const parsed = parseSuggestQuery(rec.q, rec.limit);
    if (parsed.ok === false) {
      throw new BadRequestException({
        code: parsed.code,
        message: `The place search was refused: ${parsed.code.replace(/_/g, ' ')}.`,
      });
    }
    return { items: await this.places.suggest(parsed.q, parsed.limit) };
  }

  @Get('campsite/:slug')
  async campsite(@Param('slug') slug: string): Promise<Suggestion> {
    const missing = () =>
      new NotFoundException({
        code: 'unknown_campsite',
        message: 'No such campsite.',
      });
    if (!SLUG.test(slug)) throw missing();
    const found = await this.places.campsite(slug);
    if (!found) throw missing();
    return found;
  }
}
