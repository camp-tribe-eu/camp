import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  LegalService,
  type LegalDocument,
  type LegalSummary,
} from './legal.service';

/**
 * CAMP-365 — правові документи для сайту.
 *
 * Веб читає їх ПІД ЧАС ЗБІРКИ й віддає статикою: власник правит у CMS,
 * перезбірка (або ISR) приносить нову сторінку, а лежача база читача не
 * зачіпає. Тому цей контролер навмисно простий — він не знає про
 * рендер, лише про те, що опубліковано.
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  async list(
    @Query('language') language = 'en',
  ): Promise<{ documents: LegalSummary[] }> {
    return { documents: await this.legal.list(language) };
  }

  /**
   * 🔴 404, А НЕ ПОРОЖНІЙ ДОКУМЕНТ. Чернетка й неіснуючий слаг для
   * читача однакові — «такого немає». Віддати 200 над порожнечею на
   * правовій адресі означало б опублікувати «у нас немає умов».
   */
  @Get(':slug')
  async bySlug(
    @Param('slug') slug: string,
    @Query('language') language = 'en',
  ): Promise<LegalDocument> {
    const doc = await this.legal.bySlug(slug, language);
    if (!doc) throw new NotFoundException(`немає документа «${slug}»`);
    return doc;
  }
}
