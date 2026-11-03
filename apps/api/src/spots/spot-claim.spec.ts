import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_ATTEMPTS,
  PER_SPOT_PER_DAY,
  PER_USER_PER_DAY,
  codeHash,
  confirmRefusal,
  maskEmail,
  newCode,
  normaliseCode,
  osmEmail,
  startRefusal,
  updatedRowCount,
} from './spot-claim';

// CAMP-51 / CAMP-232 — доказ володіння кемпінгом, перевірений без Nest.
describe('spot-claim: адреса приходить лише з тегів OSM', () => {
  it('бере email із contact', () => {
    expect(osmEmail({ email: 'Info@Camping.De' })).toBe('info@camping.de');
  });

  it('із списку через крапку з комою бере ПЕРШУ, і лише її', () => {
    expect(osmEmail({ email: 'a@b.de;c@d.de' })).toBe('a@b.de');
  });

  it('🔴 не бере нічого, крім ключа email', () => {
    // Якби функція вміла читати ще якесь поле, лист пішов би не туди,
    // куди обіцяє картка, — і доказ володіння перестав би бути доказом.
    expect(osmEmail({ website: 'https://c.de', phone: '+49 1' })).toBeNull();
    expect(osmEmail({ Email: 'a@b.de' })).toBeNull();
    expect(osmEmail({})).toBeNull();
    expect(osmEmail(null)).toBeNull();
    expect(osmEmail(undefined)).toBeNull();
  });

  it('сміття замість адреси — це відсутність адреси', () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.de', '@c.de', 'a@.de'])
      expect(osmEmail({ email: bad })).toBeNull();
  });
});

describe('spot-claim: маска', () => {
  it('лишає стільки, щоб власник упізнав', () => {
    expect(maskEmail('info@camping-alpenblick.de')).toBe('i***@c***.de');
  });

  it('🔴 і замало, щоб адресу відновити', () => {
    const masked = maskEmail('reservierung@huttopia.co.uk');
    expect(masked).toBe('r***@h***.uk');
    expect(masked).not.toContain('reservierung');
    expect(masked).not.toContain('huttopia');
  });

  it('дві різні адреси з однаковими першими літерами дають одну маску', () => {
    // Тобто маска не є ідентифікатором — а якби була, вона б видавала
    // адресу так само, як сама адреса.
    expect(maskEmail('info@camping-a.de')).toBe(maskEmail('info@camping-b.de'));
  });

  it('🔴 з неадреси ніколи не робить щось, схоже на адресу', () => {
    for (const bad of ['', 'nope', 'a@b', '@c.de'])
      expect(maskEmail(bad)).toBeNull();
  });
});

describe('spot-claim: код', () => {
  it('має названу довжину й лише символи зі свого алфавіту', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c.split('').every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('🔴 в алфавіті немає символів, які плутають, переписуючи з листа', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L'])
      expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('🔴 двічі поспіль не дає того самого коду', () => {
    // Нульова перевірка «код не порожній» лишилась би зеленою на
    // константі. Ця — ні.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newCode());
    expect(seen.size).toBe(500);
  });

  it('пробіли, дефіси й регістр — це та сама спроба', () => {
    expect(normaliseCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(codeHash('abcd-efgh')).toBe(codeHash('ABCDEFGH'));
  });

  it('🔴 хеш не є кодом і не містить його', () => {
    const c = newCode();
    const h = codeHash(c);
    expect(h).toHaveLength(64);
    expect(h).not.toContain(c);
    expect(codeHash(c)).toBe(h);
    expect(codeHash(newCode())).not.toBe(h);
  });
});

describe('spot-claim: кого не пускаємо починати', () => {
  const base = {
    viewerId: 'u1',
    contact: { email: 'info@c.de' } as Record<string, unknown>,
    confirmedOwnerId: null as string | null,
    sentForSpotToday: 0,
    sentByUserToday: 0,
  };

  it('нормальну заявку пропускає', () => {
    expect(startRefusal(base)).toBeNull();
  });

  it('анонім — 401, бо вхід допоможе', () => {
    expect(startRefusal({ ...base, viewerId: null })).toBe('anonymous');
    expect(startRefusal({ ...base, viewerId: '' })).toBe('anonymous');
  });

  it('немає адреси в тегах — слати нема куди', () => {
    expect(startRefusal({ ...base, contact: { phone: '+49' } })).toBe(
      'no-email',
    );
  });

  it('🔴 уже підтверджений кемпінг не шле листів НІКОМУ, навіть власнику', () => {
    expect(startRefusal({ ...base, confirmedOwnerId: 'u1' })).toBe(
      'already-claimed',
    );
    expect(startRefusal({ ...base, confirmedOwnerId: 'u2' })).toBe(
      'already-claimed',
    );
  });

  it('🔴 межа на кемпінг захищає ЧУЖУ адресу', () => {
    expect(
      startRefusal({ ...base, sentForSpotToday: PER_SPOT_PER_DAY - 1 }),
    ).toBeNull();
    expect(startRefusal({ ...base, sentForSpotToday: PER_SPOT_PER_DAY })).toBe(
      'spot-flooded',
    );
  });

  it('🔴 межа на акаунт захищає НАС від розсилки по каталогу', () => {
    expect(
      startRefusal({ ...base, sentByUserToday: PER_USER_PER_DAY - 1 }),
    ).toBeNull();
    expect(startRefusal({ ...base, sentByUserToday: PER_USER_PER_DAY })).toBe(
      'user-flooded',
    );
  });

  it('межі різні, інакше одна з них нічого не стерегла б', () => {
    expect(PER_SPOT_PER_DAY).toBeLessThan(PER_USER_PER_DAY);
  });
});

describe('spot-claim: підтвердження', () => {
  const now = new Date('2026-11-03T18:00:00Z');
  const code = 'ABCD2345';
  const pending = {
    userId: 'u1',
    codeHash: codeHash(code),
    expiresAt: new Date('2026-11-04T18:00:00Z'),
    usedAt: null as Date | null,
    attempts: 0,
  };

  it('правильний код проходить', () => {
    expect(confirmRefusal('u1', pending, code, now)).toBeNull();
  });

  it('його ж, переписаний з пробілами й у нижньому регістрі, теж', () => {
    expect(confirmRefusal('u1', pending, ' abcd-2345 ', now)).toBeNull();
  });

  it('анонім — 401', () => {
    expect(confirmRefusal(null, pending, code, now)).toBe('anonymous');
  });

  it('🔴 ЧУЖА заявка відповідає так само, як відсутня', () => {
    // Інакше різниця між «no-pending» і «wrong-code» розповідає, за які
    // листинги вже взялись.
    expect(confirmRefusal('u2', pending, code, now)).toBe('no-pending');
    expect(confirmRefusal('u2', null, code, now)).toBe('no-pending');
  });

  it('використану заявку не можна використати вдруге', () => {
    expect(confirmRefusal('u1', { ...pending, usedAt: now }, code, now)).toBe(
      'no-pending',
    );
  });

  it('протермінована — expired, і саме на межі', () => {
    const atExpiry = new Date(pending.expiresAt);
    expect(confirmRefusal('u1', pending, code, atExpiry)).toBe('expired');
    expect(
      confirmRefusal('u1', pending, code, new Date(atExpiry.getTime() - 1)),
    ).toBeNull();
  });

  it('🔴 спалена перебором — і це перевіряється ДО коду', () => {
    // Якби порядок був зворотний, перебір отримував би «wrong-code» й
    // міг тривати вічно, не натрапивши на стоп.
    const burned = { ...pending, attempts: MAX_ATTEMPTS };
    expect(confirmRefusal('u1', burned, code, now)).toBe('burned');
    expect(confirmRefusal('u1', burned, 'ZZZZZZZZ', now)).toBe('burned');
    expect(
      confirmRefusal(
        'u1',
        { ...pending, attempts: MAX_ATTEMPTS - 1 },
        code,
        now,
      ),
    ).toBeNull();
  });

  it('хибний код — wrong-code', () => {
    expect(confirmRefusal('u1', pending, 'ZZZZ9999', now)).toBe('wrong-code');
  });
});

describe('spot-claim: скільки рядків змінив UPDATE', () => {
  it('🔴 пара [рядки, кількість] — це НЕ довжина 2', () => {
    // Заміряно: ds.query('UPDATE … RETURNING id') → [[{id:…}], 1].
    // Саме на цьому я того самого дня надрукував 2 замість 30.
    expect(updatedRowCount([[{ id: 'a' }], 1])).toBe(1);
    expect(updatedRowCount([[{ id: 'a' }, { id: 'b' }], 2])).toBe(2);
    expect(updatedRowCount([[], 0])).toBe(0);
  });

  it('простий масив рядків теж рахується', () => {
    expect(updatedRowCount([{ id: 'a' }])).toBe(1);
    expect(updatedRowCount([])).toBe(0);
  });

  it('не масив — це нуль, а не виняток', () => {
    expect(updatedRowCount(null)).toBe(0);
    expect(updatedRowCount(undefined)).toBe(0);
    expect(updatedRowCount({ rowCount: 5 })).toBe(0);
  });
});
