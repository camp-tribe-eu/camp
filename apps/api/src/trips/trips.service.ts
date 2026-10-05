import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trip } from '../entities/trip.entity';
import { DENIED, Viewer, denyReason } from '../auth/ownership';

/** The shape Postgres will accept for a `uuid` column, checked before it is asked. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  /**
   * One trip, for the account that owns it.
   *
   * 🔴 THIS METHOD IS CAMP-50'S ACCEPTANCE CRITERION: "an attempt to
   * open someone else's trip by direct ID returns 403, not data."
   *
   * The lookup is by ID ALONE — deliberately. Scoping the query with
   * `AND user_id = :viewer` would also be safe here, and it is the
   * pattern that rots: the day someone adds a listing, an admin view or
   * a join, the scope is quietly missing and nothing fails. Fetching
   * first and asking `denyReason` second means the authorisation is a
   * step that is either there or absent, in one tested place.
   *
   * 🔴 A trip that does not exist answers the same 403, with the same
   * sentence, as one belonging to somebody else. Telling them apart
   * turns the endpoint into a directory of which IDs are real.
   */
  async forViewer(viewer: Viewer, id: string): Promise<Trip> {
    // 🔴 ANONYMOUS IS ANSWERED BEFORE THE DATABASE IS TOUCHED.
    //
    // The first version queried first and asked afterwards. Review
    // measured the result: an unauthenticated caller reached SQL on
    // every request, 120 a minute per IP, for free — and a non-UUID id
    // made that a 500 from the driver rather than a refusal.
    //
    // Nothing observable changes: an anonymous caller already got 401
    // whether or not the trip existed, so leaving early cannot leak
    // which ids are real. It just stops unauthenticated input from
    // reaching the query planner at all.
    if (!viewer?.id) throw new UnauthorizedException(DENIED);

    // 🔴 A malformed id is refused here rather than handed to Postgres,
    // which answers `invalid input syntax for type uuid` — a 500.
    // Measured by review: `GET /trips/not-a-uuid` was a 500 for a
    // stranger AND for an anonymous caller.
    //
    // It answers DENIED, not 400, for the same reason a missing trip
    // does: one shape of refusal, so nothing about an id can be read
    // off the difference. An id that cannot name a row is a row the
    // caller does not have.
    if (!UUID.test(id)) throw new ForbiddenException(DENIED);

    const trip = await this.trips.findOne({
      where: { id },
      relations: { stops: true },
    });
    const reason = denyReason(viewer, trip);
    if (reason === 'anonymous') throw new UnauthorizedException(DENIED);
    if (reason) throw new ForbiddenException(DENIED);
    return trip as Trip;
  }

  /** Every trip of the signed-in account. Anonymous callers get 401. */
  async mine(viewer: Viewer): Promise<Trip[]> {
    if (denyReason(viewer, { userId: viewer?.id }) === 'anonymous')
      throw new UnauthorizedException(DENIED);
    return this.trips.find({
      where: { userId: (viewer as { id: string }).id },
      order: { createdAt: 'DESC' },
    });
  }
}
