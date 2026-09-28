import { Controller, Get, Query } from '@nestjs/common';
import { RoutesService } from './routes.service';
import {
  DEFAULT_PER_POINT,
  DEFAULT_RADIUS_M,
  parsePoints,
} from './route-points';
import { parseKinds } from './route-services';

// CAMP-3 / CAMP-45: the one API route the curated route pages need.
//
// 🔴 Why this is a new module and not another handler on SpotsController.
//
// The question it answers is different in kind. Everything on
// SpotsController is "tell me about this campsite / this region / the
// whole set". This is "here are twelve points I chose, give me a few
// campsites beside each" — a request shaped by our editorial selection,
// which is exactly the shape the ODbL Produced Work argument rests on.
// Keeping it in its own module keeps that boundary visible to the next
// person, and keeps the cap (MAX_TOTAL) somewhere it cannot be widened
// by a change to an unrelated listing route.
//
// 🔴 NOT a bulk route, checked rather than assumed. The heaviest
// possible answer is 12 points × 8 campsites = 96 rows with no geometry
// blobs — about the size of one region listing, which sits on the
// default limit. The build calls it once per route page: twelve calls
// for the whole section, measured. `/spots/index` returns 61 422 rows
// and is the reason BULK_LIMIT exists; this is not that.
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  /**
   * Campsites beside each stage of a route.
   *
   *   /routes/near?points=46.16,-1.15;45.88,-1.19&perPoint=4&radius=25000
   *
   * 🔴 The answer keeps the groups in the order the points arrived and
   * emits an EMPTY group rather than dropping a stage that has nothing
   * near it. A stage with no campsites within the radius is a real and
   * publishable fact — the page says "nothing in our database within
   * 25 km of here", which is more useful than a silently shorter list
   * and is the same honesty rule the campsite pages follow about
   * unrecorded amenities.
   */
  @Get('near')
  near(@Query() query: Record<string, string>) {
    return this.routes.near(
      parsePoints(query.points),
      Number(query.perPoint) || DEFAULT_PER_POINT,
      Number(query.radius) || DEFAULT_RADIUS_M,
    );
  }

  /**
   * CAMP-113: fuel, charging, water, a dump point, a shop, a meal and a
   * roof — the nearest of each to every stage.
   *
   *   /routes/services?points=46.16,-1.15;45.88,-1.19&radius=25000
   *   /routes/services?points=…&kinds=fuel,charging
   *
   * 🔴 The answer keeps the groups in the order the points arrived, and
   * a stage with nothing near it gets an EMPTY group rather than being
   * dropped — the same rule `near()` follows, for the same reason. It
   * also OMITS a kind that has nothing within the radius rather than
   * returning a placeholder: which kinds are missing is the page's job
   * to say, and it says "unknown" or "none within 25 km" in words.
   *
   * 🔴 There is no `perKind` parameter. One of each kind is what the
   * ODbL Produced Work position on a route page can carry — the
   * arithmetic is in route-services.ts — and a query parameter that can
   * widen it is a cap that the next caller does not have.
   */
  @Get('services')
  services(@Query() query: Record<string, string>) {
    return this.routes.services(
      parsePoints(query.points),
      parseKinds(query.kinds),
      Number(query.radius) || DEFAULT_RADIUS_M,
    );
  }
}
