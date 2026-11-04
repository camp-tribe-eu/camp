import { Module } from '@nestjs/common';
import {
  RentalCamperTypesController,
  RentalProvidersController,
} from './rental-providers.controller';
import { RentalProvidersService } from './rental-providers.service';

// CAMP-427; CAMP-371 — таксономія типів для фільтра.
@Module({
  controllers: [RentalProvidersController, RentalCamperTypesController],
  providers: [RentalProvidersService],
  exports: [RentalProvidersService],
})
export class RentalProvidersModule {}
