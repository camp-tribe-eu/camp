import { ADMIN, DENIED, denyReason, holds, statusFor } from './ownership';

// CAMP-50 — "an attempt to open someone else's trip by direct ID
// returns 403, not data". Checked without booting Nest.
describe('ownership', () => {
  const me = { id: 'user-a' };
  const mine = { userId: 'user-a' };
  const theirs = { userId: 'user-b' };

  it('lets the owner through', () => {
    expect(denyReason(me, mine)).toBeNull();
    expect(statusFor(denyReason(me, mine))).toBe(200);
  });

  it('🔴 refuses someone else’s trip with 403, not data', () => {
    expect(denyReason(me, theirs)).toBe('not-yours');
    expect(statusFor(denyReason(me, theirs))).toBe(403);
  });

  it('refuses an anonymous caller with 401, because signing in might help', () => {
    expect(denyReason(null, mine)).toBe('anonymous');
    expect(statusFor(denyReason(null, mine))).toBe(401);
  });

  it('treats a viewer with no id as anonymous', () => {
    expect(denyReason({ id: '' }, mine)).toBe('anonymous');
  });

  // 🔴 A missing row must answer exactly like someone else's row.
  it('answers 403 for a trip that does not exist, like one that is not yours', () => {
    expect(statusFor(denyReason(me, null))).toBe(403);
    expect(statusFor(denyReason(me, undefined))).toBe(403);
    expect(statusFor(denyReason(me, {}))).toBe(403);
    expect(statusFor(denyReason(me, theirs))).toBe(403);
  });

  it('…and says the same sentence either way', () => {
    expect(DENIED).not.toMatch(/exist|yours only|owner/i);
  });

  // 🔴 A role is a grant over an ordinary account, not a second kind of
  // user.
  it('lets an admin through on someone else’s trip', () => {
    expect(denyReason({ id: 'user-a', roles: [ADMIN] }, theirs)).toBeNull();
  });

  it('…but an unrelated role grants nothing', () => {
    expect(denyReason({ id: 'user-a', roles: ['owner'] }, theirs)).toBe(
      'not-yours',
    );
  });

  it('…and an anonymous caller cannot hold one', () => {
    expect(holds(null, ADMIN)).toBe(false);
    expect(denyReason({ id: '', roles: [ADMIN] }, theirs)).toBe('anonymous');
  });

  it('…nor can a roles field that is not a list', () => {
    expect(holds({ id: 'x', roles: 'admin' as never }, ADMIN)).toBe(false);
  });

  it('does not match a role by prefix', () => {
    expect(holds({ id: 'x', roles: ['administrator'] }, ADMIN)).toBe(false);
  });

  // 🔴 A resource whose `userId` lives on the PROTOTYPE must not pass.
  // `Object.create({userId})` answers the plain read, and a polluted
  // `Object.prototype` would turn every 403 into 200-plus-data.
  it('🔴 refuses a userId that comes from the prototype chain', () => {
    expect(statusFor(denyReason(me, Object.create({ userId: 'user-a' })))).toBe(
      403,
    );
  });

  it('…while an own property of the same name is read normally', () => {
    expect(denyReason(me, JSON.parse('{"userId":"user-a"}'))).toBeNull();
  });

  it('…and a JSON __proto__ payload is still a miss', () => {
    expect(
      denyReason(me, JSON.parse('{"__proto__":{"userId":"user-a"}}')),
    ).toBe('missing');
  });

  // The two type guards no mutation reached.
  it('a non-string userId is not an owner, however it compares', () => {
    expect(denyReason(me, { userId: 1 as never })).toBe('missing');
    expect(denyReason(me, { userId: ['user-a'] as never })).toBe('missing');
  });

  it('a non-string viewer id is anonymous', () => {
    expect(denyReason({ id: 1 as never }, mine)).toBe('anonymous');
  });
});
