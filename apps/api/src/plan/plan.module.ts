import { Module } from '@nestjs/common';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';

// CAMP-391: the HTTP entry to the planner. The algorithm itself lives in
// `planner/` and imports nothing from Nest; this module is the whole of what
// is Nest about it — a controller, and one service that owns the transaction.
@Module({
  controllers: [PlanController],
  providers: [PlanService],
})
export class PlanModule {}
