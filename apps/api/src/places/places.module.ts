import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

// CAMP-456: підказки місць для /plan. Читає лише наявні таблиці.
@Module({
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
