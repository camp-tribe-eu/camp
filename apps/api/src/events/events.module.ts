import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpotEventDaily } from '../entities/spot-event-daily.entity';
import { ZeroResultSearchDaily } from '../entities/zero-result-search-daily.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

// CAMP-504: запис подій із першого дня. Денні лічильники, без персональних
// даних; хеш дедуплікації — лише в памʼяті (`dedup.ts`).
@Module({
  imports: [TypeOrmModule.forFeature([SpotEventDaily, ZeroResultSearchDaily])],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
