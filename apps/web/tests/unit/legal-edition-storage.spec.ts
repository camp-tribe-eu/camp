import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { LEGAL_PAGES } from '@/lib/legal';
import { SEEDED } from './legal-cms';
import { WEB_SRC, pageText, paragraphs, readCode, sourceFiles } from './legal-claims';

/**
 * ДВІ ПРАВОВІ СТОРІНКИ КАЖУТЬ ОДНЕ ПРО ТЕ, ДЕ ЛЕЖАТЬ ПОПЕРЕДНІ РЕДАКЦІЇ.
 *
 * 🔴 ЧОМУ ЦЕ ТЕСТ, А НЕ ПРАВКА ОДНОГО РЕЧЕННЯ. «Terms» казали «the previous
 * wording is recorded in our public source repository», «Privacy» — «the
 * versions we have published so far were each shipped as code, so their full
 * text is in our public source repository; should a later version be edited
 * in our content system instead, that will no longer be true of it». Перше
 * речення об'єктивно правдиве для минулих редакцій і неправдиве для майбутніх;
 * друге каже обидві половини. Я «виправив» перше на «we keep every earlier
 * wording ourselves» — і дві сторінки зазвучали по-різному про одне й те саме,
 * хоча кожна окремо була б захищуваною. Рецензія #399 заміряла: репозиторій
 * публічний, і 11 із 16 редакцій у ньому лежать повним текстом.
 *
 * Тому звіряється СУТЬ, а не байти: з кожної ВІДРЕНДЕРЕНОЇ сторінки береться
 * набір тверджень («минулі редакції — повним текстом у публічному
 * репозиторії», «майбутні, зроблені в CMS, туди не потраплять», «їх зберігаємо
 * ми», «текст у базі», «на запит надішлемо чинну на день», «версія й дата
 * вгорі»), і ці набори мусять збігтися — і бути ІСТИННИМИ (не «обидві мовчать»).
 * Далі кожне з тверджень про механізм звіряється з кодом: текст справді
 * їде міграціями, а сторінка справді читається з бази (а не імпортується з
 * репозиторію — тому CMS-редакція в git не потрапить).
 */

const PAGES = ['terms', 'privacy'] as const;

/** Абзац, у якому сторінка каже, де лежать редакції. */
function editionsParagraph(slug: string): string {
  const para = paragraphs(slug).find((p) => p.text.includes('public source repository'));
  expect(para, `${slug}: немає абзацу про те, де лежать попередні редакції`).toBeTruthy();
  return para!.text;
}

function claims(slug: string) {
  const t = editionsParagraph(slug);
  return {
    textHeldInDatabase: /text itself is held in our database/.test(t),
    pastEditionsRecordedInPublicRepo: /shipped as code, so they are recorded in our public source repository/.test(t),
    // 🔴 І НЕ БІЛЬШЕ. «Their full text is in our public source repository»
    // стверджує, що текст можна ПРОЧИТАТИ файлом, а для редакцій, чия міграція
    // складає текст замінами з попередньої (terms 1.2, cookies 1.1, database 1.1,
    // notice 1.1, privacy 2.4), це неправда: його можна лише відтворити
    // виконанням. Сторінка описує механізм (приїхали кодом, записані), а не
    // читабельність. Слова «full text» чи «readable» повертають сильніше
    // твердження — і це червоніє.
    doesNotPromiseReadableFullText: !/\b(?:full text|in full|entire text|complete text|readable|can read|read (?:it|them|each|every|the))\b/i.test(t),
    laterCmsEditionsNotInRepo: /edited in our content system instead, that will no longer be true of it/.test(t),
    weKeepLaterOnesOurselves: /we will keep the earlier text ourselves/.test(t),
    sendsTheEditionForAGivenDay: /we will send you the text that was in force on (?:a given|any) day/.test(t),
    versionPrintedAtTop: /at the top of (?:this|the) page/.test(t),
  };
}

test.describe('де лежать попередні редакції: terms = privacy', () => {
  test('🔴 обидві сторінки роблять ті самі твердження про попередні редакції — і не сильніші, ніж правда', () => {
    const [terms, privacy] = PAGES.map(claims);
    // Не «обидві мовчать»: кожне твердження справді сказане.
    expect(Object.values(terms).every(Boolean), `terms: ${JSON.stringify(terms)}`).toBe(true);
    expect(Object.values(privacy).every(Boolean), `privacy: ${JSON.stringify(privacy)}`).toBe(true);
    expect(terms, 'terms і privacy розійшлись у твердженні про попередні редакції').toEqual(privacy);
  });

  test('🔴 «shipped as code»: кожна сторінка реєстру їде міграцією з непорожнім текстом, а не лежить лише в CMS', () => {
    expect(LEGAL_PAGES.length).toBeGreaterThan(0);
    expect(
      LEGAL_PAGES.filter((p) => (SEEDED.find((s) => s.slug === p.slug)?.body ?? '').trim() === '').map((p) => p.slug),
    ).toEqual([]);
  });

  test('🔴 «edited in our content system … will no longer be true of it»: сторінка читається з бази, текст не імпортується з репозиторію', () => {
    const code = readCode(join(WEB_SRC, 'lib', 'legal-content.ts'));
    // Текст береться запитом до API (CMS-редакція потрапить сюди, а не в git).
    expect(code).toMatch(/apiFetch\(\s*`\/legal\/\$\{encodeURIComponent\(slug\)\}`/);
    // І навпаки: жоден файл `apps/web/src` не містить самого тексту сторінки —
    // інакше «later edition is not in the repository» було б неправдою.
    const probe = SEEDED.find((s) => s.slug === 'terms')!.body.split('\n').find((l) => l.length > 80)!;
    expect(probe.length).toBeGreaterThan(80);
    expect(pageText('terms').length).toBeGreaterThan(1000);
    const offenders = sourceFiles(WEB_SRC).filter((f) => readCode(f).includes(probe.slice(0, 60)));
    expect(offenders).toEqual([]);
  });
});
