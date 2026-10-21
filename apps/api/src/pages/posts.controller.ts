import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PagesService, type PageView, type PostSummary } from './pages.service';

/**
 * CAMP-364 — блог.
 *
 * 🔴 ОКРЕМИЙ КОРІНЬ, А НЕ `?type=post` НА `/pages`. Унікальний індекс
 * таблиці — `(type, slug)`, тобто сторінка й допис МОЖУТЬ мати однаковий
 * слаг. Один маршрут, ключований лише слагом, довелось би розсуджувати
 * параметром запиту, і запит без нього віддавав би довільного з двох —
 * рівно той дефект, який уже був усередині `bySlug` до того, як тип
 * почали питати явно.
 */
@Controller('posts')
export class PostsController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  async list(
    @Query('language') language = 'en',
  ): Promise<{ posts: PostSummary[] }> {
    return { posts: await this.pages.posts(language) };
  }

  /** 404, а не порожня сторінка — з тієї самої причини, що й у `/pages`. */
  @Get(':slug')
  async bySlug(
    @Param('slug') slug: string,
    @Query('language') language = 'en',
  ): Promise<PageView> {
    const post = await this.pages.bySlug(slug, language, 'post');
    if (!post) throw new NotFoundException(`немає допису «${slug}»`);
    return post;
  }
}
