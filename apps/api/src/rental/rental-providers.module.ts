import { Module } from '@nestjs/common';
import {
  RentalCamperTypesController,
  RentalCountriesController,
  RentalProvidersController,
} from './rental-providers.controller';
import { RentalCountriesService } from './rental-countries.service';
import { RentalProvidersService } from './rental-providers.service';

// CAMP-427; CAMP-371 — таксономія типів для фільтра.
@Module({
  controllers: [
    RentalProvidersController,
    RentalCamperTypesController,
    RentalCountriesController,
  ],
  providers: [RentalProvidersService, RentalCountriesService],
  exports: [RentalProvidersService],
})
export class RentalProvidersModule {}
