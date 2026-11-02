import { expect, test } from '@playwright/test';

import { ConsentBannerView } from '@/components/cookie-consent';
import { SignupForm } from '@/components/account-forms';
import { RETURN_TTL_MS } from '@/lib/return-path';
import { seededHtml } from './legal-cms';
import { storageWrites } from './legal-claims';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * ТРИ ПОВЕРХНІ, ЩО КАЖУТЬ ПРО СХОВИЩЕ БРАУЗЕРА, — І ВОНИ МУСЯТЬ КАЗАТИ ОДНЕ.
 *
 * 🔴 ЧОМУ ЦЕЙ ТЕСТ ІСНУЄ. 02.11.2026 сторінка «Cookies» казала «that is
 * currently the only thing» (ключів три), політика приватності — «only that
 * answer» (так само), банер — «We store nothing until you choose» (так само),
 * і ніхто не помітив, бо кожна поверхня мала власну копію однієї правди, і
 * жоден тест не читав їх разом. Виправлення першої з них (PR #399) лишило
 * дві інші неправдою, і поверхні розійшлись: читач, який звірить сторінки,
 * бачив би розбіжність.
 *
 * Тут вони читаються РАЗОМ і порівнюються з ОДНИМ свідком — кодом:
 *
 *   · перелік ключів на сторінці кукі, на сторінці приватності й у коді —
 *     одна множина (`storageWrites()` читає всі `.setItem(` у `apps/web/src`,
 *     а не перелік, переписаний тут чи в міграціях);
 *   · сховище кожного ключа (local / session) — те, в яке пише код;
 *   · вступне речення про «три записи, не кукі» в політиці — ті самі слова,
 *     що в кукі (береться з відрендереної сторінки кукі, не з літерала тут);
 *   · перше речення банера — ті самі слова, що перше речення кукі;
 *   · підтвердження віку в політиці — те саме речення, що в умовах, і те саме
 *     слово віку, що стверджує форма реєстрації.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДРЕНДЕРЕНИЙ HTML: сторінки — крізь `LegalProse`, банер —
 * `ConsentBannerView` (його винесено з компонента, який віддає `null`, доки не
 * спрацює ефект: непрочитаний банер був би непідтвердженим твердженням).
 */

type Block = { text: string; html: string };

/** Абзаци й пункти списків сторінки — одиниці, у яких стоять ключі. */
function blocks(slug: string): Block[] {
  return [...seededHtml(slug).matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({
    html: m[2],
    text: visibleText(m[2]),
  }));
}

/** Ключі, названі на сторінці: `camptribe.xxx`, окрім домену `camptribe.eu` з пошти. */
const keysOn = (slug: string): string[] =>
  [...new Set(blocks(slug).flatMap((b) => b.text.match(/\bcamptribe\.(?!eu\b)[a-z]+\b/g) ?? []))].sort();

const NUMBER_WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 15: 'fifteen', 20: 'twenty', 30: 'thirty' };

const PAGES = ['cookies', 'privacy'] as const;

const bannerHtml = () => renderComponent(ConsentBannerView, { onAnswer: () => undefined });
const signupHtml = () => renderComponent(() => <SignupForm />, {});

test.describe('сховище браузера: кукі, приватність і код називають один і той самий перелік', () => {
  test('🔴 ключі на обох сторінках = ключі в коді (пропущений, зайвий, розбіжність між сторінками)', () => {
    const inCode = [...new Set(storageWrites().map((w) => w.key))].sort();
    expect(inCode.length, 'у коді жодного ключа — розбір сліпий').toBeGreaterThan(0);
    const named = Object.fromEntries(PAGES.map((p) => [p, keysOn(p)]));
    for (const p of PAGES) expect(named[p].length, `${p}: жодного ключа — розбір сліпий`).toBeGreaterThan(0);
    expect({ code: inCode, ...named }).toEqual({ code: inCode, cookies: inCode, privacy: inCode });
  });

  test('🔴 кожен ключ названо в тому сховищі, куди його пише код — на обох сторінках', () => {
    const writes = storageWrites();
    expect(writes.length).toBeGreaterThan(0);
    for (const slug of PAGES) {
      const bl = blocks(slug);
      for (const w of writes) {
        const block = bl.find((b) => b.text.includes(w.key));
        expect(block, `${slug}: немає абзацу чи пункту про ${w.key}`).toBeTruthy();
        expect(
          { local: /\bin local storage\b/.test(block!.text), session: /\bin session storage\b/.test(block!.text) },
          `${slug}: ${w.key} пишеться в ${w.storage}Storage (${w.file}), сторінка каже інакше`,
        ).toEqual({ local: w.storage === 'local', session: w.storage === 'session' });
      }
    }
  });

  test('🔴 число записів («three entries») і строк («ignored after fifteen minutes») — з коду, на обох сторінках', () => {
    const n = new Set(storageWrites().map((w) => w.key)).size;
    const minutes = RETURN_TTL_MS / 60_000;
    expect(NUMBER_WORDS[n], `у коді ${n} ключів; додай слово`).toBeTruthy();
    expect(NUMBER_WORDS[minutes], `RETURN_TTL_MS = ${minutes} хв; додай слово`).toBeTruthy();
    for (const slug of PAGES) {
      const text = blocks(slug).map((b) => b.text).join('\n');
      expect(text, `${slug}: число записів`).toContain(`${NUMBER_WORDS[n]} entries`);
      expect(text, `${slug}: строк адреси повернення`).toContain(`ignored after ${NUMBER_WORDS[minutes]} minutes`);
    }
  });

  test('🔴 вступ у політиці — ті самі слова, що в кукі (береться зі сторінки кукі, не з літерала)', () => {
    const intro = (slug: string) => {
      const p = blocks(slug).find((b) => b.text.startsWith('Our own code writes'));
      expect(p, `${slug}: немає вступу «Our own code writes …»`).toBeTruthy();
      // Перші два речення — спільна тверджувальна частина; далі кожна сторінка веде своє.
      return p!.text.split('. ').slice(0, 2).join('. ');
    };
    expect(intro('privacy')).toBe(intro('cookies'));
    expect(intro('cookies')).toContain('the code of this site sets no cookies');
  });

  test('🔴 жодна поверхня не повертає стару неправду', () => {
    const everything = [
      ...PAGES.map((p) => blocks(p).map((b) => b.text).join('\n')),
      visibleText(bannerHtml()),
    ].join('\n');
    expect(everything).not.toMatch(/only that answer|and only that|store nothing|only thing/i);
  });
});

test.describe('банер говорить те саме, що сторінка кукі', () => {
  const bannerTitle = () => {
    const m = /<p\b[^>]*id="cookie-title"[^>]*>([\s\S]*?)<\/p>/.exec(bannerHtml());
    expect(m, 'у банері немає заголовка #cookie-title').toBeTruthy();
    return visibleText(m![1]);
  };

  test('🔴 перше речення банера = перше речення сторінки кукі', () => {
    const html = seededHtml('cookies');
    const lead = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/.exec(html);
    expect(lead, 'на сторінці кукі немає виділеного першого речення').toBeTruthy();
    const sentence = visibleText(lead![1]).replace(/\.$/, '');
    // Це справді ПЕРШЕ, що читач бачить на сторінці, а не випадкове місце.
    expect(visibleText(html).startsWith(sentence)).toBe(true);
    expect(bannerTitle()).toBe(sentence);
  });

  test('🔴 банер веде на сторінку кукі й не обіцяє «нічого» без застереження', () => {
    expect(bannerHtml()).toMatch(/<a\b[^>]*href="\/legal\/cookies"/);
    expect(bannerTitle()).not.toMatch(/nothing(?! optional)/i);
  });
});

test.describe('вік: політика, умови й форма реєстрації кажуть одне', () => {
  test('🔴 політика містить те саме речення про підтвердження, що умови, і вік зі форми', () => {
    const sentenceIn = (slug: string) =>
      /Creating an account is your confirmation that you are \w+ or older: the sign-up form says so in a sentence above the button, and there is no box to tick\./.exec(
        blocks(slug).map((b) => b.text).join('\n'),
      )?.[0];
    const terms = sentenceIn('terms');
    expect(terms, 'умови не містять речення про підтвердження віку').toBeTruthy();
    expect(sentenceIn('privacy'), 'політика каже про вік інакше, ніж умови').toBe(terms);

    const formAge = /confirm that you are (\w+) or older/.exec(visibleText(signupHtml()))?.[1];
    expect(formAge, 'форма реєстрації не стверджує віку').toBeTruthy();
    expect(terms).toContain(`you are ${formAge} or older`);
    expect(blocks('privacy').map((b) => b.text).join('\n')).not.toMatch(/we ask you to confirm/i);
  });
});
