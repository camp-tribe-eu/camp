import { Controller, Get, Param, Query } from '@nestjs/common';
import {
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
    @Query('sort') sort?: string,
  ) {
    return this.providers.list(
      {
        country: normaliseCountry(country),
        services: normaliseServices(services),
      },
      sort,
    );
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.providers.bySlug(slug);
  }
}
