import { Module } from '@nestjs/common';
import { RentalProvidersController } from './rental-providers.controller';
import { RentalProvidersService } from './rental-providers.service';

// CAMP-427.
@Module({
  controllers: [RentalProvidersController],
  providers: [RentalProvidersService],
  exports: [RentalProvidersService],
})
export class RentalProvidersModule {}
