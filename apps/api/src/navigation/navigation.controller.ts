import { Controller, Get, Query } from '@nestjs/common';
import {
  NavigationService,
  type NavItemView,
  type NavLocation,
} from './navigation.service';

// CAMP-365.
//
// 🔴 ОДИН ЗАПИТ ВІДДАЄ ВСІ РОЗТАШУВАННЯ, а не три окремі виклики.
// Шапка й підвал стоять на КОЖНІЙ сторінці, тож три запити означали б
// три звернення на кожне завантаження. Меню маленьке — дешевше віддати
// все разом, ніж економити байти ціною обходів.
@Controller('navigation')
export class NavigationController {
  constructor(private readonly nav: NavigationService) {}

  @Get()
  async all(
    @Query('lang') lang?: string,
  ): Promise<Record<NavLocation, NavItemView[]>> {
    // 🔴 Мова за замовчуванням — англійська, бо саме вона запущена
    // (CAMP-219: решта пʼять лежать із `live: false`). Коли це
    // зміниться, значення має прийти з налаштувань, а не звідси.
    const language = lang && /^[a-z]{2}$/.test(lang) ? lang : 'en';
    const [header, footer, mobile] = await Promise.all([
      this.nav.byLocation('header', language),
      this.nav.byLocation('footer', language),
      this.nav.byLocation('mobile', language),
    ]);
    return { header, footer, mobile };
  }
}
