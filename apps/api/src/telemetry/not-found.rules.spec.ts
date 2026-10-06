import { LIMITS, cleanPath, cleanReferrer, toRow } from './not-found.rules';

describe('cleanReferrer', () => {
  it('keeps scheme, host and path', () => {
    expect(cleanReferrer('https://example.org/a/b')).toBe(
      'https://example.org/a/b',
    );
  });

  // 🔴 The whole reason this function exists. Each case is its own test:
  // one `return` covering all of them is the line a mutation deletes.
  it('drops the query, which is somebody else’s business', () => {
    expect(cleanReferrer('https://example.org/a?q=who+is+bob')).toBe(
      'https://example.org/a',
    );
  });

  it('drops a fragment even though a server should never see one', () => {
    expect(cleanReferrer('https://example.org/a#section')).toBe(
      'https://example.org/a',
    );
  });

  it('drops credentials in the authority', () => {
    expect(cleanReferrer('https://user:pw@example.org/a')).toBe(
      'https://example.org/a',
    );
  });

  it('keeps the port, because it is part of which site this is', () => {
    expect(cleanReferrer('http://example.org:8080/a')).toBe(
      'http://example.org:8080/a',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd'])(
    'refuses %s, which is a payload and not a referrer',
    (raw) => {
      expect(cleanReferrer(raw)).toBeNull();
    },
  );

  it.each([
    ['not a url', 'not a url'],
    ['empty', ''],
    ['blank', '   '],
  ])('refuses an unreadable referrer (%s)', (_name, raw) => {
    expect(cleanReferrer(raw)).toBeNull();
  });

  it('refuses a non-string', () => {
    expect(cleanReferrer(['https://example.org/'])).toBeNull();
  });

  it('caps the length', () => {
    const long = `https://example.org/${'a'.repeat(LIMITS.referrer)}`;
    expect(cleanReferrer(long)!.length).toBe(LIMITS.referrer);
  });
});

describe('cleanPath', () => {
  it('keeps our path', () => {
    expect(cleanPath('/camping/fr/paca/les-pins')).toBe(
      '/camping/fr/paca/les-pins',
    );
  });

  // 🔴 The less obvious half: a 404 log is not a place to keep what
  // people typed into our own search box.
  it('drops our own query too', () => {
    expect(cleanPath('/search?q=what+the+reader+typed')).toBe('/search');
  });

  it('drops a fragment', () => {
    expect(cleanPath('/a#b')).toBe('/a');
  });

  it.each(['', 'camping/fr', 'https://example.org/x'])(
    'refuses %s, which is not one of our paths',
    (raw) => {
      expect(cleanPath(raw)).toBeNull();
    },
  );

  it('caps the length', () => {
    expect(cleanPath(`/${'a'.repeat(LIMITS.path)}`)!.length).toBe(LIMITS.path);
  });
});

describe('toRow', () => {
  it('records the hit', () => {
    expect(toRow('/a', 'https://example.org/b?x=1')).toEqual({
      path: '/a',
      referrer: 'https://example.org/b',
    });
  });

  // 🔴 "Arrived with no usable referrer" is worth counting: that is what
  // a crawler and a typed URL look like, and they are most of the traffic
  // this report is about.
  it('keeps the hit when the referrer is unusable', () => {
    expect(toRow('/a', 'nonsense')).toEqual({ path: '/a', referrer: null });
  });

  it('keeps the hit when there is no referrer at all', () => {
    expect(toRow('/a', undefined)).toEqual({ path: '/a', referrer: null });
  });

  // …but without a path there is nothing to redirect and nothing to count.
  it('records nothing without a usable path', () => {
    expect(toRow('nonsense', 'https://example.org/')).toBeNull();
  });
});

/**
 * 🔴 The promise on the consent banner, asserted rather than intended.
 *
 * The banner says "no analytics or advertising cookies" and that is true
 * today. This module is the thing most likely to make it untrue by
 * accident, so the shape of what it can emit is checked here: a row has
 * exactly two fields, and neither can carry an identifier.
 */
describe('🔴 a row cannot identify anybody', () => {
  it('has exactly path and referrer, and nothing else', () => {
    expect(Object.keys(toRow('/a', 'https://example.org/b')!).sort()).toEqual([
      'path',
      'referrer',
    ]);
  });

  it('cannot smuggle an identifier through the referrer query', () => {
    const row = toRow('/a', 'https://example.org/b?uid=123&email=a@b.c');
    expect(row!.referrer).toBe('https://example.org/b');
    expect(JSON.stringify(row)).not.toContain('a@b.c');
    expect(JSON.stringify(row)).not.toContain('123');
  });

  it('cannot smuggle one through our own query either', () => {
    const row = toRow('/x?session=abc123', null);
    expect(JSON.stringify(row)).not.toContain('abc123');
  });
});
