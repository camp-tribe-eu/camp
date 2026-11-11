import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PagesService, type PageView } from './pages.service';

@Controller('pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  async list(@Query('language') language = 'en'): Promise<{ slugs: string[] }> {
    return { slugs: await this.pages.slugs(language) };
  }

  /**
   * Зображення банера країни (CAMP-469). Два сегменти шляху, тож із
   * `:slug` нижче не зіткнеться. 404, коли зображення не поставлено, —
   * веб читає це як «малюй, як малював».
   */
  @Get('camping-country/:code')
  async campingCountryBanner(
    @Param('code') code: string,
    @Query('language') language = 'en',
  ): Promise<{ src: string; alt: string }> {
    const banner = await this.pages.campingCountryBanner(code, language);
    if (!banner) throw new NotFoundException(`немає зображення для «${code}»`);
    return banner;
  }

  /**
   * 🔴 404, А НЕ ПОРОЖНЯ СТОРІНКА. Сторінка, якої немає, мусить
   * виглядати як відсутня і для читача, і для пошуковика — інакше ми
   * віддамо 200 над порожнечею, і вона потрапить в індекс.
   */
  @Get(':slug')
  async bySlug(
    @Param('slug') slug: string,
    @Query('language') language = 'en',
  ): Promise<PageView> {
    const page = await this.pages.bySlug(slug, language);
    if (!page) throw new NotFoundException(`немає сторінки «${slug}»`);
    return page;
  }
}
