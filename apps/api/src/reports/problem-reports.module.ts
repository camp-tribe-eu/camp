import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProblemReport } from '../entities/problem-report.entity';
import { ProblemReportsController } from './problem-reports.controller';
import { ProblemReportsService } from './problem-reports.service';

// «Report a problem»: one open POST, one table, read in Directus by a person.
// The rules are in ./problem-reports.rules and import nothing from Nest; this
// module is the whole of what is Nest about it.
@Module({
  imports: [TypeOrmModule.forFeature([ProblemReport])],
  controllers: [ProblemReportsController],
  providers: [ProblemReportsService],
})
export class ProblemReportsModule {}
