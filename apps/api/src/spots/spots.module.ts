import { Module } from '@nestjs/common';
import { SpotsController } from './spots.controller';
import { SpotsService } from './spots.service';
import { MapQueryService } from './map.service';

@Module({
  controllers: [SpotsController],
  providers: [SpotsService, MapQueryService],
  exports: [SpotsService, MapQueryService],
})
export class SpotsModule {}
