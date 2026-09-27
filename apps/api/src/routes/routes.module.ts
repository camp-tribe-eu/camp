import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

// CAMP-3 / CAMP-45. Nothing here touches the `routes` or `route_points`
// tables that already exist in the schema: the curated routes are a
// typed data file in the web app (apps/web/src/data/routes), because
// they are editorial content that belongs in review with the page, not
// rows somebody edits in a database with no diff. This module only
// asks the campsite table what is near a point.
@Module({
  controllers: [RoutesController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
