import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientError } from '../entities/client-error.entity';
import { ClientErrorsController } from './client-errors.controller';
import { ClientErrorsService } from './client-errors.service';

// CAMP-92.
@Module({
  imports: [TypeOrmModule.forFeature([ClientError])],
  controllers: [ClientErrorsController],
  providers: [ClientErrorsService],
  exports: [ClientErrorsService],
})
export class TelemetryModule {}
