import { Controller, Get, Query } from '@nestjs/common';
import {
  SiteSettingsService,
  type SiteSettingsView,
} from './site-settings.service';

/**
 * CAMP-481 — налаштування сайту для вебу.
 *
 * 🔴 200 І `null`, А НЕ 404. Сторінки, якої немає, бути не може —
 * тому там 404. А налаштування існують завжди: питання лише, чи
 * редактор уже щось вписав. 404 тут змусив би веб ловити виняток там,
 * де стан цілком законний, і першою ж спробою «спростити» хтось
 * перетворив би його на мовчазний запасний текст у коді.
 */
@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Get()
  async get(@Query('language') language = 'en'): Promise<SiteSettingsView> {
    return this.settings.get(language);
  }
}
