import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  normaliseCamperType,
  normaliseCountry,
  normaliseServices,
  RentalProvidersService,
} from './rental-providers.service';
import {
  RentalCountriesService,
  type RentalCountryView,
} from './rental-countries.service';

// CAMP-427.
@Controller('rental/providers')
export class RentalProvidersController {
  constructor(private readonly providers: RentalProvidersService) {}

  @Get()
  list(
    @Query('country') country?: string,
    @Query('services') services?: string | string[],
    @Query('type') type?: string,
    @Query('sort') sort?: string,
  ) {
    return this.providers.list(
      {
        country: normaliseCountry(country),
        services: normaliseServices(services),
        camperType: normaliseCamperType(type),
      },
      sort,
    );
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.providers.bySlug(slug);
  }
}

// CAMP-371, пункт 3 — таксономія для фільтра «який вен чи причеп».
//
// 🔴 ОКРЕМИЙ ШЛЯХ, А НЕ `rental/providers/camper-types`. У контролері вище
// стоїть `:slug`, і `camper-types` читалось би як слаг компанії, якби
// маршрути зареєструвались не в тому порядку. Порядок оголошення — надто
// тонка річ, щоб на ньому тримати адресу.
@Controller('rental/camper-types')
export class RentalCamperTypesController {
  constructor(private readonly providers: RentalProvidersService) {}

  @Get()
  list() {
    return this.providers.camperTypes();
  }
}

/**
 * Текст країн оренди — CAMP-479.
 *
 * 🔴 ОКРЕМИЙ КОНТРОЛЕР, А НЕ ЩЕ ОДИН ШЛЯХ У `rental/providers`. Питання
 * іншого роду: там «хто здає техніку за цими ознаками», тут «що ми
 * написали про країну». Змішати їх означало б, що зміна правил видачі
 * партнерів чіпає сторінку з редакційним текстом.
 */
@Controller('rental/countries')
export class RentalCountriesController {
  constructor(private readonly countries: RentalCountriesService) {}

  @Get()
  async list(
    @Query('language') language = 'en',
  ): Promise<{ countries: RentalCountryView[] }> {
    return { countries: await this.countries.all(language) };
  }

  @Get(':code')
  async one(
    @Param('code') code: string,
    @Query('language') language = 'en',
  ): Promise<RentalCountryView> {
    const country = await this.countries.byCode(code.toLowerCase(), language);
    if (!country) throw new NotFoundException(`немає країни «${code}»`);
    return country;
  }
}
