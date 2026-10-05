import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trip } from '../entities/trip.entity';
import { DENIED, Viewer, denyReason } from '../auth/ownership';

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
