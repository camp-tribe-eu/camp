import { Controller, Get, Param } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CurrentViewer } from '../auth/current-viewer.decorator';
import { Viewer } from '../auth/ownership';

// CAMP-50 part 2: the saved trips in a user's cabinet, and the first
// endpoint in this API where the answer depends on WHO is asking.
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /**
   * 🔴 `/trips/mine` is declared BEFORE `/trips/:id`.
   *
   * Express matches in declaration order, so with these the other way
   * round `mine` would be read as an id — a 403 on the one route that
   * must work for every signed-in user. Order is load-bearing here, not
   * style, which is why it is written down.
   */
  @Get('mine')
  mine(@CurrentViewer() viewer: Viewer) {
    return this.trips.mine(viewer);
  }

  @Get(':id')
  one(@CurrentViewer() viewer: Viewer, @Param('id') id: string) {
    return this.trips.forViewer(viewer, id);
  }
}
