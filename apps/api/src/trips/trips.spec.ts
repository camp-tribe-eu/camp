import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Trip } from '../entities/trip.entity';
import { DENIED } from '../auth/ownership';
import { TripsService } from './trips.service';

const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const STRANGER = 'bbbbbbbb-0000-0000-0000-000000000002';
const TRIP_ID = 'cccccccc-0000-0000-0000-000000000003';

const theTrip = { id: TRIP_ID, userId: OWNER, name: 'Pyrenees' } as Trip;

/** A repository that answers with whatever row the test put in it. */
const repoOf = (row: Trip | null) =>
  ({
    findOne: jest.fn().mockResolvedValue(row),
    find: jest.fn().mockResolvedValue(row ? [row] : []),
  }) as unknown as Repository<Trip>;

/** The error a call threw, typed as one. A call that does NOT throw is
 * itself a failure here, so this says so loudly instead of returning a
 * Trip that the next assertion would quietly read properties off. */
const threw = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the call to be refused, but it returned data');
};

describe('🔴 CAMP-50 acceptance: someone else’s trip by direct ID', () => {
  // The sentence of the card, as one test.
  it('answers 403 and no data', async () => {
    const service = new TripsService(repoOf(theTrip));
    await expect(
      service.forViewer({ id: STRANGER }, TRIP_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not leak the trip in the error it throws', async () => {
    const service = new TripsService(repoOf(theTrip));
    const error = await threw(service.forViewer({ id: STRANGER }, TRIP_ID));
    expect(JSON.stringify(error)).not.toContain('Pyrenees');
  });

  // 🔴 The enumeration leak, which is the half people forget: if a
  // missing id answered differently from someone else's, the endpoint
  // would be a directory of which ids are real.
  it('answers a MISSING trip exactly as it answers someone else’s', async () => {
    const absent = await threw(
      new TripsService(repoOf(null)).forViewer({ id: STRANGER }, TRIP_ID),
    );
    const foreign = await threw(
      new TripsService(repoOf(theTrip)).forViewer({ id: STRANGER }, TRIP_ID),
    );
    expect([absent.constructor.name, absent.message]).toEqual([
      foreign.constructor.name,
      foreign.message,
    ]);
  });

  it('uses the one sentence, naming neither cause', async () => {
    const error = await threw(
      new TripsService(repoOf(theTrip)).forViewer({ id: STRANGER }, TRIP_ID),
    );
    expect(error.message).toBe(DENIED);
  });
});

describe('TripsService.forViewer', () => {
  it('gives the owner their own trip', async () => {
    const service = new TripsService(repoOf(theTrip));
    await expect(service.forViewer({ id: OWNER }, TRIP_ID)).resolves.toBe(
      theTrip,
    );
  });

  // 401, not 403: signing in might help, and that difference is the
  // reason denyReason returns a reason rather than a boolean.
  it('answers an anonymous caller 401, not 403', async () => {
    const service = new TripsService(repoOf(theTrip));
    await expect(service.forViewer(null, TRIP_ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lets an admin through, because a role is a grant over an account', async () => {
    const service = new TripsService(repoOf(theTrip));
    await expect(
      service.forViewer({ id: STRANGER, roles: ['admin'] }, TRIP_ID),
    ).resolves.toBe(theTrip);
  });

  /**
   * 🔴 The query must NOT be scoped by user.
   *
   * Scoping would also be safe here — and that is the trap. It makes
   * the authorisation invisible, so the day a listing or a join forgets
   * it, nothing fails. This asserts the fetch is by id alone, so that
   * `denyReason` stays the single step that can be present or absent.
   */
  it('looks the trip up by id alone, leaving authorisation to one step', async () => {
    const repo = repoOf(theTrip);
    await new TripsService(repo).forViewer({ id: OWNER }, TRIP_ID);
    const where = (repo.findOne as jest.Mock).mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(['id']);
  });
});

describe('TripsService.mine', () => {
  it('refuses an anonymous caller with 401', async () => {
    await expect(
      new TripsService(repoOf(theTrip)).mine(null),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('scopes the listing to the signed-in account', async () => {
    const repo = repoOf(theTrip);
    await new TripsService(repo).mine({ id: OWNER });
    expect((repo.find as jest.Mock).mock.calls[0][0].where).toEqual({
      userId: OWNER,
    });
  });
});
