import {
  DELETION_WINDOW_DAYS,
  DELETION_WINDOW_MS,
  EXPORT_STALE_MS,
  EXPORT_TTL_MS,
  PHOTO_CHOICES,
  isPhotoChoice,
  isRestorable,
  parseDeleteRequest,
  restorableUntil,
} from './account-deletion';

// CAMP-229 (3/3) — the rules of deleting an account, with no database.
//
// 🔴 THE NUMBERS ARE WRITTEN OUT. `expect(WINDOW_MS).toBe(DAYS * 86_400_000)`
// would restate the definition and stay green when both halves were changed
// together. The screen says "30 days" and "24 hours"; these are those words as
// milliseconds, typed by hand.

describe('the numbers the screen quotes', () => {
  it('thirty days, to the millisecond', () => {
    expect(DELETION_WINDOW_DAYS).toBe(30);
    expect(DELETION_WINDOW_MS).toBe(2_592_000_000);
  });

  it('an archive lasts 24 hours', () => {
    expect(EXPORT_TTL_MS).toBe(86_400_000);
  });

  it('a build nobody is working on is failed after ten minutes', () => {
    expect(EXPORT_STALE_MS).toBe(600_000);
  });
});

describe('the window', () => {
  const at = new Date('2026-10-16T12:00:00.000Z');

  it('ends exactly 30 days after the request', () => {
    expect(restorableUntil(at).toISOString()).toBe('2026-11-15T12:00:00.000Z');
  });

  it('is open one millisecond before the end and shut at it', () => {
    const end = restorableUntil(at).getTime();
    expect(isRestorable(at, new Date(end - 1))).toBe(true);
    expect(isRestorable(at, new Date(end))).toBe(false);
    expect(isRestorable(at, new Date(end + 1))).toBe(false);
  });

  it('is open the moment after the request', () => {
    expect(isRestorable(at, at)).toBe(true);
  });
});

describe('🔴 the only two answers about photos', () => {
  it('are exactly delete and keep-anonymous, in that order, written out', () => {
    expect([...PHOTO_CHOICES]).toEqual(['delete', 'keep-anonymous']);
  });

  it.each(['delete', 'keep-anonymous'])('%s is one', (v) => {
    expect(isPhotoChoice(v)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    ' delete',
    'Delete',
    'keep',
    'both',
    'keep-anonymous ',
    true,
    1,
    ['delete'],
    {},
  ])('%j is not', (v) => {
    expect(isPhotoChoice(v)).toBe(false);
  });
});

describe('🔴 the request body', () => {
  const good = { password: 'x', photos: 'delete', understood: true };

  it('accepts a complete body and returns exactly the two things it needs', () => {
    expect(parseDeleteRequest(good)).toEqual({
      kind: 'ok',
      value: { photos: 'delete', password: 'x' },
    });
    expect(parseDeleteRequest({ ...good, photos: 'keep-anonymous' })).toEqual({
      kind: 'ok',
      value: { photos: 'keep-anonymous', password: 'x' },
    });
  });

  it('has NO default for the photos: a missing choice is refused, never filled in', () => {
    expect(
      parseDeleteRequest({ password: good.password, understood: true }),
    ).toEqual({
      kind: 'refused',
      why: 'photo_choice_required',
    });
  });

  it('asks about the choice first, then the confirmation, then the password', () => {
    expect(parseDeleteRequest({})).toEqual({
      kind: 'refused',
      why: 'photo_choice_required',
    });
    expect(parseDeleteRequest({ photos: 'delete' })).toEqual({
      kind: 'refused',
      why: 'confirmation_required',
    });
    expect(parseDeleteRequest({ photos: 'delete', understood: true })).toEqual({
      kind: 'refused',
      why: 'password_required',
    });
  });

  it.each(['true', 1, 'on', 'yes', false, null, undefined, {}, [true]])(
    '%j is not "I understand"',
    (understood) => {
      expect(parseDeleteRequest({ ...good, understood })).toEqual({
        kind: 'refused',
        why: 'confirmation_required',
      });
    },
  );

  it.each(['', undefined, null, 0, 123, {}, ['x']])(
    '%j is not a password',
    (password) => {
      expect(parseDeleteRequest({ ...good, password })).toEqual({
        kind: 'refused',
        why: 'password_required',
      });
    },
  );

  it.each([undefined, null, 'text', 5, true, []])(
    'a body of %j is refused, not read as a default',
    (body) => {
      expect(parseDeleteRequest(body)).toEqual({
        kind: 'refused',
        why: 'photo_choice_required',
      });
    },
  );
});
