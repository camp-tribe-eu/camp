import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { ConsentRecord } from '../entities/consent-record.entity';
import { appendConsent } from './consent-journal';
import {
  CONSENT_KINDS,
  CONSENT_SOURCES,
  WORDINGS,
  WORDING_KEYS,
  checkOffer,
  currentWording,
  latestOf,
  versionSeenOrCurrent,
  wordingAt,
  type Wording,
} from './wordings';

// CAMP-390 — реєстр формулювань згод, без бази й без сервера.
//
// 🔴 ЩО ТУТ СТЕРЕЖЕТЬСЯ. Рядок журналу посилається на (ключ, версію), і
// доказом «людина погодилась на ЦЕ» він є лише доти, доки текст цієї версії —
// той самий, що вона бачила. Два способи його втратити:
//
//   1. текст у вебі змінили, а в реєстрі ні (чи навпаки) — це стереже
//      `apps/web/tests/unit/consent-wording.spec.tsx`, бо воно мусить віддати
//      компонент у HTML;
//   2. текст змінили ВСЮДИ, а версію не підняли — журнал далі пише «версія 1»
//      за текстом, якого версія 1 ніколи не містила. Це стереже ПЕРЕЛІК нижче.
//
// 🔴 ПЕРЕЛІК — ЦЕ ВІДБИТКИ, НЕ ТЕКСТИ. Дописаний тут повторно текст був би ще
// однією копією, що розходиться. Відбиток каже лише «ця опублікована версія
// мала саме ці байти»: виправлена «на місці» червоніє, а нова редакція — це
// новий рядок у реєстрі й новий рядок тут, тобто свідоме рішення.

/** sha256 тексту кожної ОПУБЛІКОВАНОЇ версії. Дописується, не редагується. */
const PUBLISHED: ReadonlyArray<{
  key: string;
  version: number;
  sha256: string;
}> = [
  {
    key: 'newsletter.signup',
    version: 1,
    sha256: 'ac2cc06ac1b792f0ebade6a67f7238d44f7d5652c8e6f2d151f6e6e6e4f54c6a',
  },
  {
    key: 'newsletter.settings',
    version: 1,
    sha256: '9204f69d4bd27d405d120baff38c9019f35d6e5499a2e0d5afac54101fa26418',
  },
];

/** Падіння з поясненням: у `jest` `expect(x, message)` повідомлення не приймає. */
const must = (ok: boolean, message: string): void => {
  if (!ok) throw new Error(message);
};

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

describe('реєстр формулювань: форма', () => {
  it('не порожній — інакше решта перевірок нічого не доводять', () => {
    expect(WORDINGS.length).toBeGreaterThan(0);
    expect(WORDING_KEYS.length).toBeGreaterThan(0);
  });

  it('(ключ, версія) — унікальні', () => {
    const seen = WORDINGS.map((w) => `${w.key}@${w.version}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('версії кожного ключа йдуть з 1 без пропусків', () => {
    for (const key of WORDING_KEYS) {
      const versions = WORDINGS.filter((w) => w.key === key)
        .map((w) => w.version)
        .sort((a, b) => a - b);
      expect(versions).toEqual(versions.map((_, i) => i + 1));
    }
  });

  it('вид і джерело — зі списків, які база тримає в CHECK', () => {
    for (const w of WORDINGS) {
      expect(CONSENT_KINDS).toContain(w.kind);
      expect(CONSENT_SOURCES).toContain(w.source);
      expect(w.lang).toBe('en');
    }
  });

  it('текст — одним рядком, без крайніх і подвійних пробілів', () => {
    // Те, що показує веб, проходить крізь HTML і схлопує пробіли; текст, що
    // їх містить, не мав би як збігтися зі своїм відображенням.
    for (const w of WORDINGS) {
      expect(w.text.length).toBeGreaterThan(10);
      expect(w.text).toBe(w.text.trim().replace(/\s+/g, ' '));
    }
  });

  it('екран і ключ не плутаються: один ключ — одне джерело й один вид', () => {
    for (const key of WORDING_KEYS) {
      const rows = WORDINGS.filter((w) => w.key === key);
      expect(new Set(rows.map((r) => r.source)).size).toBe(1);
      expect(new Set(rows.map((r) => r.kind)).size).toBe(1);
    }
  });
});

describe('🔴 опублікована версія не міняється на місці', () => {
  it('кожен запис реєстру має відбиток у переліку — нова версія без нього червоніє', () => {
    for (const w of WORDINGS) {
      const pinned = PUBLISHED.find(
        (p) => p.key === w.key && p.version === w.version,
      );
      must(
        pinned !== undefined,
        `${w.key}@${w.version} немає в PUBLISHED: додайте відбиток цієї версії`,
      );
    }
  });

  it('текст кожної версії дає той самий відбиток, що й у день публікації', () => {
    for (const p of PUBLISHED) {
      const w = wordingAt(p.key, p.version);
      must(
        w !== undefined,
        `${p.key}@${p.version} зникла з реєстру: версії лише дописуються`,
      );
      must(
        sha256(w!.text) === p.sha256,
        `текст ${p.key}@${p.version} змінено на місці: додайте версію ${
          p.version + 1
        }, а цю лишіть як була`,
      );
    }
  });

  it('відбиток відрізняє один символ — інакше порівняння нічого не бачить', () => {
    const w = currentWording('newsletter.signup');
    // Правки, що не залежать від того, які слова стоять у тексті сьогодні.
    expect(sha256(w.text.slice(0, -1))).not.toBe(sha256(w.text));
    expect(sha256(w.text + ' ')).not.toBe(sha256(w.text));
    expect(sha256(w.text.toUpperCase())).not.toBe(sha256(w.text));
  });
});

describe('«чинна» — це найбільша версія', () => {
  const list = [
    { key: 'a', version: 2, text: 'second' },
    { key: 'b', version: 9, text: 'other key' },
    { key: 'a', version: 3, text: 'third' },
    { key: 'a', version: 1, text: 'first' },
  ];

  it('не перша й не остання в переліку, а найбільша', () => {
    expect(latestOf(list, 'a')?.text).toBe('third');
    expect(latestOf(list, 'b')?.text).toBe('other key');
  });

  it('нема ключа — `undefined`, а не чужа версія', () => {
    expect(latestOf(list, 'c')).toBeUndefined();
  });

  it('`wordingAt` шукає за ВЕРСІЄЮ, і зниклу не підміняє чинною', () => {
    const now = currentWording('newsletter.signup');
    expect(wordingAt('newsletter.signup', now.version)).toEqual(now);
    expect(wordingAt('newsletter.signup', now.version + 100)).toBeUndefined();
    expect(wordingAt('nope', 1)).toBeUndefined();
  });
});

/** Піднімає версію ключа в реєстрі на час `run`, потім повертає як було. */
function withRaised<T>(
  key: 'newsletter.signup' | 'newsletter.settings',
  run: (v2: Wording) => T,
): T {
  const prev = currentWording(key);
  const v2: Wording = {
    ...prev,
    version: prev.version + 1,
    text: `${prev.text} (revised)`,
  };
  const list = WORDINGS as unknown as Wording[];
  list.push(v2);
  try {
    return run(v2);
  } finally {
    list.splice(list.indexOf(v2), 1);
  }
}

describe('🔴 номер версії, який назвала сторінка: приймається лише чинний', () => {
  it('чинний номер — прийнято, і запис формулювання той самий', () => {
    const w = currentWording('newsletter.signup');
    expect(checkOffer('newsletter.signup', w.version)).toEqual({
      ok: true,
      wording: w,
    });
  });

  it('🔴 застарілий номер — `stale`, а не мовчазний запис нової версії', () => {
    const v1 = currentWording('newsletter.signup');
    withRaised('newsletter.signup', (v2) => {
      // Реєстр уже на v2, а сторінка відрендерила v1.
      expect(currentWording('newsletter.signup').version).toBe(v2.version);
      expect(checkOffer('newsletter.signup', v1.version)).toEqual({
        ok: false,
        why: 'stale',
      });
      // …і саме v2 приймається.
      expect(checkOffer('newsletter.signup', v2.version)).toEqual({
        ok: true,
        wording: v2,
      });
    });
    // Після відкату чинна знову v1.
    expect(checkOffer('newsletter.signup', v1.version).ok).toBe(true);
  });

  it('номер із майбутнього чи вигаданий — `unknown`', () => {
    const w = currentWording('newsletter.signup');
    expect(checkOffer('newsletter.signup', w.version + 1)).toEqual({
      ok: false,
      why: 'unknown',
    });
    expect(checkOffer('newsletter.signup', 99)).toEqual({
      ok: false,
      why: 'unknown',
    });
    expect(checkOffer('newsletter.signup', 0)).toEqual({
      ok: false,
      why: 'unknown',
    });
    expect(checkOffer('newsletter.signup', -1)).toEqual({
      ok: false,
      why: 'unknown',
    });
  });

  it.each([
    undefined,
    null,
    '1',
    1.5,
    NaN,
    Infinity,
    true,
    [1],
    { version: 1 },
  ])('не число чи не ціле (%p) — `missing`', (offered) => {
    expect(checkOffer('newsletter.signup', offered)).toEqual({
      ok: false,
      why: 'missing',
    });
  });

  it('номер одного ключа не годиться для іншого, коли версії розійшлися', () => {
    withRaised('newsletter.settings', (v2) => {
      // v2 є лише в settings: для signup це «вигадана».
      expect(checkOffer('newsletter.signup', v2.version)).toEqual({
        ok: false,
        why: 'unknown',
      });
    });
  });
});

describe('🔴 відкликання: версія — та, яку назвала сторінка, якщо вона в реєстрі, інакше чинна', () => {
  it('названа й існує — вона', () => {
    const v1 = currentWording('newsletter.settings');
    withRaised('newsletter.settings', (v2) => {
      expect(versionSeenOrCurrent('newsletter.settings', v1.version)).toEqual(
        v1,
      );
      expect(versionSeenOrCurrent('newsletter.settings', v2.version)).toEqual(
        v2,
      );
    });
  });

  it.each([undefined, null, 99, 0, -3, '1', 1.5, NaN, true])(
    'названа неправильно або вигадана (%p) — чинна, а не вигадана',
    (offered) => {
      withRaised('newsletter.settings', (v2) => {
        expect(versionSeenOrCurrent('newsletter.settings', offered)).toEqual(
          v2,
        );
      });
    },
  );
});

describe('🔴 `appendConsent` пише лише те, що є в реєстрі', () => {
  const insertedBy = async (entry: Record<string, unknown>) => {
    const calls: Array<[unknown, Record<string, unknown>]> = [];
    const m = {
      insert: async (target: unknown, values: Record<string, unknown>) => {
        calls.push([target, values]);
      },
    } as unknown as EntityManager;
    await appendConsent(m, entry as never);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(ConsentRecord);
    return calls[0][1];
  };

  const NOW = new Date('2026-10-25T12:00:00Z');

  it('пише вид, версію й джерело із записаного формулювання', async () => {
    const w = currentWording('newsletter.settings');
    expect(
      await insertedBy({
        userId: 'u-1',
        wording: 'newsletter.settings',
        version: w.version,
        granted: false,
        now: NOW,
      }),
    ).toEqual({
      userId: 'u-1',
      kind: w.kind,
      granted: false,
      wordingKey: w.key,
      wordingVersion: w.version,
      source: w.source,
      recordedAt: NOW,
    });
  });

  it('вигадані вид, джерело й текст від виклику до рядка не доходять', async () => {
    const w = currentWording('newsletter.signup');
    const row = await insertedBy({
      userId: 'u-1',
      wording: 'newsletter.signup',
      version: w.version,
      granted: true,
      now: NOW,
      // усе, що міг би надіслати зловмисний клієнт, якби сервер його слухав
      kind: 'photo_publish',
      source: 'moderation',
      text: 'I agree to everything.',
      wordingText: 'I agree to everything.',
    });
    expect(row.kind).toBe(w.kind);
    expect(row.source).toBe(w.source);
    expect(JSON.stringify(row)).not.toContain('I agree to everything');
    expect(Object.keys(row).sort()).toEqual(
      [
        'granted',
        'kind',
        'recordedAt',
        'source',
        'userId',
        'wordingKey',
        'wordingVersion',
      ].sort(),
    );
  });

  it('🔴 версії, якої немає в реєстрі, не записує — навіть із валідним ключем', async () => {
    const w = currentWording('newsletter.signup');
    for (const version of [w.version + 1, 99, 0, -1, 1.5, undefined, '1'])
      await expect(
        insertedBy({
          userId: 'u-1',
          wording: 'newsletter.signup',
          version,
          granted: true,
          now: NOW,
        }),
      ).rejects.toThrow(/in the registry/);
  });

  it('ключа, якого немає в реєстрі, не записує', async () => {
    await expect(
      insertedBy({
        userId: 'u-1',
        wording: 'newsletter.invented',
        version: 1,
        granted: true,
        now: NOW,
      }),
    ).rejects.toThrow(/in the registry/);
  });
});

describe('міграція: `up()` лише додає', () => {
  // 🔴 ЦІНА ХИБНОГО СПРАЦЮВАННЯ — одне слово в `up()`, яке справді там не
  // мало б стояти. Тому тут плоский текст самого `up()`, без розбору
  // коментарів: у ньому їх немає, а розбір дав би протилежний дефект —
  // сторож, що сліпне там, де шукає. Власне доказ на даних — у
  // `consent.db.spec.ts` (рахунок рядків до й після).
  const source = readFileSync(
    join(__dirname, '..', 'migrations', '1792900000000-ConsentRecord.ts'),
    'utf8',
  );

  const upBody = (text: string): string => {
    const from = text.indexOf('public async up(');
    const to = text.indexOf('public async down(');
    must(from > -1, 'не знайшов up()');
    must(to > from, 'не знайшов down()');
    return text.slice(from, to);
  };

  const statements = (body: string): string[] =>
    [...body.matchAll(/queryRunner\.query\(\s*`([\s\S]*?)`\s*,?\s*\)/g)].map(
      (m) => m[1],
    );

  it('кожен вираз у up() починається з CREATE', () => {
    const list = statements(upBody(source));
    // Не менше чотирьох: таблиця, індекс, функція, тригер. Порожній перелік
    // «задовольнив» би кожне правило нижче.
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const sql of list) expect(sql.trimStart()).toMatch(/^CREATE\s/i);
  });

  // 🔴 `UPDATE` і `INSERT` тут НЕ в переліку, а `DELETE` — лише без `ON` перед
  // ним, і це не недогляд: `BEFORE UPDATE` і `ON DELETE CASCADE` — законні
  // частини `CREATE TRIGGER` і `CREATE TABLE`, тож ці слова стоять у самому
  // `up()`. Виразу, що ПОЧИНАЄТЬСЯ з `UPDATE`, `INSERT` чи `DELETE`, не
  // пропустить правило вище (він не `CREATE`).
  const TOUCHES_EXISTING =
    /\b(DROP|TRUNCATE|ALTER|RENAME)\b|(?<!\bON\s)\bDELETE\b/i;

  it('у up() немає слів, що чіпають наявне', () => {
    expect(upBody(source)).not.toMatch(TOUCHES_EXISTING);
  });

  it('сторож бачить те, про що каже: на прикладах, що мусять його спрацювати', () => {
    const bad = [
      'public async up(queryRunner) { await queryRunner.query(`ALTER TABLE users ALTER COLUMN email TYPE text`) } public async down(',
      'public async up(queryRunner) { await queryRunner.query(`DROP TABLE users`) } public async down(',
      'public async up(queryRunner) { await queryRunner.query(`DELETE FROM users`) } public async down(',
    ];
    // Законні слова всередині CREATE сторожа не повинні спрацьовувати.
    expect('ON DELETE CASCADE').not.toMatch(TOUCHES_EXISTING);
    expect('BEFORE UPDATE ON t').not.toMatch(TOUCHES_EXISTING);
    // Два, що не пройдуть саме правило про початок виразу.
    const notCreate = [
      'public async up(queryRunner) { await queryRunner.query(`UPDATE users SET email = email`) } public async down(',
      'public async up(queryRunner) { await queryRunner.query(`INSERT INTO users DEFAULT VALUES`) } public async down(',
    ];
    for (const text of notCreate)
      expect(
        statements(upBody(text)).every((s) => /^CREATE\s/i.test(s.trimStart())),
      ).toBe(false);
    for (const text of bad) {
      expect(upBody(text)).toMatch(TOUCHES_EXISTING);
      expect(
        statements(upBody(text)).every((s) => /^CREATE\s/i.test(s.trimStart())),
      ).toBe(false);
    }
  });
});
