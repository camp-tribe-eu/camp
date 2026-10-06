import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientError } from '../entities/client-error.entity';
import { NotFoundHit } from '../entities/not-found-hit.entity';
import { ClientErrorsController } from './client-errors.controller';
import { ClientErrorsService } from './client-errors.service';
import { NotFoundController } from './not-found.controller';
import { NotFoundService } from './not-found.service';

// CAMP-92, and CAMP-235: two tables that both record something going
// wrong and both deliberately cannot identify anybody.
@Module({
  imports: [TypeOrmModule.forFeature([ClientError, NotFoundHit])],
  controllers: [ClientErrorsController, NotFoundController],
  providers: [ClientErrorsService, NotFoundService],
  exports: [ClientErrorsService, NotFoundService],
})
export class TelemetryModule {}
