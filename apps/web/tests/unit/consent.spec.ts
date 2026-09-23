import { expect, test } from '@playwright/test';
import {
  CONSENT_KEY,
  consentVersion,
  mayLoadOptional,
  readConsent,
  writeConsent,
} from '../../src/lib/consent';

// CAMP-56 — the consent decision, checked without a browser.
//
// 🔴 Every case here exists to prove the same thing from a different
// angle: there is exactly ONE path to "yes", and it is the reader
// clicking Accept. No record, an unreadable record, an answer to an older
// policy, storage that throws — all of them are "no". That default is the
// whole compliance position, and a default is precisely the kind of thing
// that gets inverted by an innocent-looking refactor.

/** A localStorage stand-in whose behaviour each test can choose. */
function fakeStore(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    removeItem: () => {
      value = null;
    },
    read: () => value,
  };
}

const throwingStore = {
  getItem: () => {
    throw new DOMException('blocked');
  },
  setItem: () => {
    throw new DOMException('blocked');
  },
  removeItem: () => {
    throw new DOMException('blocked');
  },
};

test.describe('there is one path to yes', () => {
  test('no record is not consent', () => {
    expect(readConsent(fakeStore())).toBeNull();
    expect(mayLoadOptional(null)).toBe(false);
  });

  test('a refusal is remembered, and is still not consent', () => {
    const store = fakeStore();
    writeConsent('rejected', store);
    const back = readConsent(store);
    expect(back?.choice).toBe('rejected');
    expect(mayLoadOptional(back)).toBe(false);
  });

  test('acceptance is the only thing that opens the door', () => {
    const store = fakeStore();
    writeConsent('accepted', store);
    expect(mayLoadOptional(readConsent(store))).toBe(true);
  });

  // 🔴 "You consented" only means something if we can say to WHAT. An
  // answer given to an earlier cookie policy is not an answer to this
  // one, so it reads as no decision and the banner asks again.
  test('an answer to an older policy version is not an answer to this one', () => {
    const stale = fakeStore(
      JSON.stringify({
        choice: 'accepted',
        at: '2020-01-01T00:00:00.000Z',
        version: '0.1-old',
      }),
    );
    expect(readConsent(stale)).toBeNull();
    expect(mayLoadOptional(readConsent(stale))).toBe(false);
  });

  test('a corrupt or half-written record is not consent', () => {
    for (const raw of [
      'not json at all',
      '{}',
      '{"choice":"maybe"}',
      JSON.stringify({ choice: 'accepted' }),
      JSON.stringify({ choice: 'accepted', at: 5, version: '1.0' }),
    ]) {
      expect(
        mayLoadOptional(readConsent(fakeStore(raw))),
        `"${raw}" must not read as consent`,
      ).toBe(false);
    }
  });

  // A private window, or a reader who blocked site data. The feature
  // degrades to asking again — never to assuming yes.
  test('storage that throws is not consent, and does not crash', () => {
    expect(readConsent(throwingStore)).toBeNull();
    expect(() => writeConsent('accepted', throwingStore)).not.toThrow();
    expect(mayLoadOptional(readConsent(throwingStore))).toBe(false);
  });

  test('undefined storage — a server render — is not consent', () => {
    expect(readConsent(undefined)).toBeNull();
  });
});

test.describe('what is written down', () => {
  test('records the choice, when, and which policy it answered', () => {
    const store = fakeStore();
    const at = new Date('2026-09-23T10:30:00.000Z');
    const record = writeConsent('accepted', store, at);

    expect(record).toEqual({
      choice: 'accepted',
      at: '2026-09-23T10:30:00.000Z',
      version: consentVersion(),
    });
    // And it is what actually lands in storage, not just what is returned.
    expect(JSON.parse(store.read()!)).toEqual(record);
  });

  test('uses one key, so clearing site data really clears it', () => {
    const store = fakeStore();
    writeConsent('rejected', store);
    expect(store.read()).not.toBeNull();
    expect(CONSENT_KEY).toBe('camptribe.consent');
  });

  test('the version asked about is the cookie policy’s own version', () => {
    // Bumping the policy must re-ask; this is the link that makes it so.
    expect(consentVersion()).toBe('1.0');
  });
});
