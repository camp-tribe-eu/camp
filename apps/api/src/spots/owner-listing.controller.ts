import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentViewer } from '../auth/current-viewer.decorator';
import type { Viewer } from '../auth/ownership';
import { OwnerListingService } from './owner-listing.service';

const NO_SESSION = {
  code: 'no_session',
  message: 'Sign in first — listings belong to an account.',
} as const;

/**
 * Що підтверджений власник робить зі своїм листингом. CAMP-51 / CAMP-86.
 *
 * 🔴 ШЛЯХИ ЛІТЕРАЛЬНІ, БЕЗ ПАРАМЕТРА. Та сама причина, що й у
 * `spot-claim.controller.ts`: `bucketOf` звіряє шлях точною рівністю, і
 * маршрут із `:slug` ніколи не збігся б із жодним переліком. Тут він
 * лишається у відрі `ordinary`, і це свідомо — правку робить власник
 * свого ж кемпінгу, це дешевий UPDATE і нікому більше не шкодить.
 */
@Controller('owner')
export class OwnerListingController {
  constructor(private readonly listings: OwnerListingService) {}

  @Get('listings')
  async mine(@CurrentViewer() viewer: Viewer) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    return { listings: await this.listings.mine(viewer.id) };
  }

  @Post('listing')
  @HttpCode(200)
  async edit(
    @CurrentViewer() viewer: Viewer,
    @Body() body: { slug?: unknown; patch?: unknown },
  ) {
    if (!viewer) throw new UnauthorizedException(NO_SESSION);
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    const res = await this.listings.edit(slug, viewer.id, body?.patch);
    if (res.ok === false) {
      if (res.why === 'bad-patch') {
        // 🔴 Кажемо, ЩО САМЕ не так. «Невірні дані» без переліку — це
        // спосіб зробити форму непрохідною й не дізнатись про це.
        throw new HttpException(
          {
            code: 'bad_patch',
            message: res.faults.join('; '),
            faults: res.faults,
          },
          400,
        );
      }
      // 🔴 «Не ваш» і «немає такого» — одна відповідь, один код.
      throw new HttpException(
        {
          code: 'not_yours',
          message: 'Not found, or not yours.',
        },
        404,
      );
    }
    return { overrides: res.overrides };
  }
}
