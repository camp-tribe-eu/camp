import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  normaliseCamperType,
  normaliseCountry,
  normaliseServices,
  RentalProvidersService,
} from './rental-providers.service';

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
