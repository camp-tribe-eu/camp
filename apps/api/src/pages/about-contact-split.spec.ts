import {
  ABOUT_PROSE,
  CONTACT_PROSE,
  splitAbout,
  splitContact,
} from './about-contact-split';

/**
 * CAMP-464 — розрізання оригінальних текстів на секції не губить і не
 * переписує жодного слова.
 *
 * 🔴 «ЗБИРАЄТЬСЯ НАЗАД» ПЕРЕВІРЯЄ САМА ФУНКЦІЯ, І ТУТ ДОВОДИТЬСЯ, ЩО ВОНА
 * ЦЕ РОБИТЬ: змінений оригінал або змінене місце розрізу мають давати
 * ВИНЯТОК, а не мовчки інший текст.
 */
describe('splitAbout', () => {
  it('усі речення оригіналу лишаються в частинах, слово в слово', () => {
    const p = splitAbout(ABOUT_PROSE);
    const all = [
      p.intro,
      p.uncertainText,
      p.liveText,
      p.staleText,
      p.operator,
    ].join(' ');
    for (const sentence of ABOUT_PROSE.replace(/\*\*/g, '').split(
      /(?<=[.])\s+/,
    )) {
      if (sentence.startsWith('What we do not know, we say.')) continue; // зачин став назвою
      expect(all).toContain(sentence.replace(/\n\n/g, ' '));
    }
    expect(p.uncertainTitle).toBe('What we do not know, we say');
    expect(p.operator).toContain('[Legal notice](/legal/notice)');
  });

  it('🔴 п’ять частин різні й непорожні', () => {
    const p = splitAbout(ABOUT_PROSE);
    const parts = [
      p.intro,
      p.uncertainText,
      p.liveText,
      p.staleText,
      p.operator,
    ];
    expect(new Set(parts).size).toBe(parts.length);
    for (const x of parts) expect(x.trim().length).toBeGreaterThan(20);
  });

  it('🔴 переписаний оригінал дає виняток, а не інший текст', () => {
    expect(() =>
      splitAbout(
        ABOUT_PROSE.replace('Where a reading is older', 'Old readings'),
      ),
    ).toThrow(/місця розрізу/);
    expect(() =>
      splitAbout(
        ABOUT_PROSE.replace('**What we do not know, we say.**', 'Unknown.'),
      ),
    ).toThrow(/виділеного зачину/);
    expect(() => splitAbout(`${ABOUT_PROSE}\n\nextra`)).toThrow(/4 абзаци/);
  });
});

describe('splitContact', () => {
  it('частини дають оригінал, картка несе обидва середні абзаци', () => {
    const p = splitContact(CONTACT_PROSE);
    expect(`${p.intro}\n\n${p.card}\n\n${p.operator}`).toBe(CONTACT_PROSE);
    expect(p.card).toContain('**Two things we cannot do.**');
    expect(p.card).toContain('**If you run a campsite');
    expect(p.intro).toContain('{{contact.email}}');
    expect(p.operator).toContain('/legal/privacy');
  });

  it('🔴 чужа кількість абзаців — виняток', () => {
    expect(() => splitContact('one\n\ntwo')).toThrow(/4 абзаци/);
  });
});
