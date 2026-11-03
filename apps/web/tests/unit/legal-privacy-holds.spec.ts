import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { API_SRC, apiRoutes, pageText, readCode } from './legal-claims';

/**
 * Політика приватності каже, ЩО МИ ТРИМАЄМО, — і не називає того, чого сайт не
 * приймає.
 *
 * 🔴 ЦЕ БУЛО НАЙГІРШЕ РЕЧЕННЯ ПОЛІТИКИ. «We hold the following, and nothing
 * else» стояло над переліком, що закінчувався «what you saved: trips and
 * their stops, saved places, photos you submitted, reviews you wrote» — а
 * сайт не вміє нічого з цього зберегти: write-маршрутів про поїздки, місця,
 * фото чи відгуки в контролерах нуль, у `trips.controller.ts` лише `GET`,
 * експорт даних сам пише «there is no photo upload yet». Це речення читають,
 * щоб зрозуміти ОБСЯГ, тож неправда в ньому коштує дорожче за будь-яку іншу
 * в документі.
 *
 * Той самий клас, що й «photograph, review» у терміні §4 (#399): правка, що
 * виправляє одне місце, лишає ту саму обіцянку в сусідніх. Тому тут не
 * перелік заборонених слів, а ПРАВИЛО, виведене з коду: кожне речення
 * політики, що називає поїздку, збережене місце, фото чи відгук, мусить бути
 * умовним («does not yet», «would», «once they are published»), ПОКИ код не
 * вміє це приймати; і навпаки — щойно код навчиться, політика не сміє далі
 * казати «does not yet».
 */

/** Що сайт уміє ПРИЙНЯТИ від читача — з write-маршрутів контролерів API. */
function capabilities(): Record<'trip' | 'place' | 'photo' | 'review' | 'save', boolean> {
  const writing = apiRoutes().filter((r) => ['Post', 'Put', 'Patch'].includes(r.method));
  // Якір: розбір бачить write-маршрути (інакше «нічого немає» — це сліпота).
  expect(writing.length, 'жодного write-маршруту — розбір сліпий').toBeGreaterThan(5);
  const any = (re: RegExp) => writing.some((r) => re.test(r.label));
  const trip = any(/trip/i);
  // 🔴 ЗАЯВКА НА ВОЛОДІННЯ — НЕ «ЗБЕРЕЖЕНЕ МІСЦЕ», І ПРАВИЛО ЦЕ ЗНАЄ.
  //
  // CAMP-51 додав `POST /spot-claims`, і слово `spot` у назві маршруту
  // змусило це правило вирішити, що сайт навчився зберігати місця — а
  // отже змусило б політику написати, що читач може зберегти місце.
  // Він не може: заявка не кладе місце в список, вона кладе ГРАНТ на
  // акаунт. Політика каже про неї окремо (реєстр §11), і саме тому тут
  // маршрути заявки виключені, а не враховані «про всяк випадок».
  const savesPlace = (r: { label: string }) =>
    /place|spot|favou?rite|saved/i.test(r.label) && !/claim/i.test(r.label);
  const place = writing.some(savesPlace);
  const photo = any(/photo|upload|image|picture/i);
  const review = any(/review|rating/i);
  return {
    trip,
    place,
    photo,
    review,
    // 🔴 «Зберегти» як ДІЄСЛОВО: читач може щось зберегти, лише якщо сайт уміє
    // прийняти хоч одне з цього. Перелік іменників не ловив зворот «what you
    // save is shown back to you» — він обіцяє збереження так само, як «photos».
    save: trip || place || photo || review,
  };
}

const NOUNS: Record<keyof ReturnType<typeof capabilities>, RegExp> = {
  trip: /\b(?:saved? |saving |a )?trips? and their stops\b|\bsave (?:a )?trips?\b|\bsaved trips?\b/i,
  place: /\bsaved places?\b|\bsave (?:a )?places?\b/i,
  photo: /\bphoto(?:graph)?s?\b/i,
  review: /\breviews?\b/i,
  // Дієслово в усіх формах (save, saves, saved, saving), а не лише іменники:
  // «What you save is shown back to you» не називає жодного іменника зі списку.
  //
  // Єдиний виняток — «saved link»: адреса сторінки, яку ЛЮДИНА зберегла в себе
  // («because you or somebody else opened a saved link», розділ про журнал
  // безпеки). Це не дані, які тримаємо ми, і перша редакція цього правила
  // хибно червоніла саме на ньому.
  save: /\bsav(?:e|es|ed|ing)\b(?!\s+links?\b)/i,
};

/** Умовність: речення не стверджує, що ми це приймаємо чи тримаємо. */
const CONDITIONAL = /\b(?:does not yet|not yet|would|once they are|nothing of that kind|when it does)\b/i;

const sentences = (slug: string): string[] =>
  pageText(slug)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

test.describe('privacy 2.4: обсяг того, що ми тримаємо, — з коду', () => {
  test('🔴 речення, що називає поїздки, місця, фото чи відгуки, умовне рівно тоді, коли код цього не приймає', () => {
    const caps = capabilities();
    const all = sentences('privacy');
    expect(all.length, 'політику не прочитано').toBeGreaterThan(50);

    const offenders: string[] = [];
    let conditionalNaming = 0;
    for (const [noun, re] of Object.entries(NOUNS) as Array<[keyof typeof caps, RegExp]>) {
      for (const s of all.filter((x) => re.test(x))) {
        const conditional = CONDITIONAL.test(s);
        if (!caps[noun] && !conditional) offenders.push(`«${noun}» названо як наявне, а код цього не приймає: ${s.slice(0, 120)}`);
        if (caps[noun] && /\b(?:does not yet|not yet)\b/i.test(s)) {
          offenders.push(`«${noun}» код уже приймає, а політика каже «not yet»: ${s.slice(0, 120)}`);
        }
        if (conditional) conditionalNaming++;
      }
    }
    expect(offenders, 'політика обіцяє те, чого сайт не робить (або заперечує те, що вже робить)').toEqual([]);
    // Якір: правило справді щось зачепило — інакше воно зелене над порожнечею.
    expect(conditionalNaming, 'жодного умовного речення про фото/відгуки — розбір сліпий').toBeGreaterThan(2);
  });

  test('🔴 «we hold … and nothing else» не веде до переліку збереженого читачем', () => {
    const text = pageText('privacy');
    const at = text.indexOf('We hold the following, and nothing else');
    expect(at, 'у політиці немає «We hold the following, and nothing else»').toBeGreaterThan(-1);
    const list = text.slice(at, text.indexOf('Legal basis', at));
    expect(list, 'перелік триманого знову містить «what you saved»').not.toMatch(/what you saved|photos you submitted|reviews you wrote|saved places/i);
    // Те, що справді є: пошта, хеш пароля, згода на листи, сесії.
    for (const held of ['email address', 'hash', 'agreed to receive our emails', 'sessions']) {
      expect(list, `у переліку немає «${held}»`).toContain(held);
    }
    expect(capabilities().trip || capabilities().photo || capabilities().review).toBe(false);
  });

  test('🔴 «the account deletion described below already cover them»: видалення й експорт справді мають ці правила', () => {
    const code = readCode(join(API_SRC, 'auth', 'account-rights.service.ts'));
    // Експорт читає поїздки, фото й відгуки автора — САМЕ вибіркою «його», а не
    // згадкою таблиці деінде (видалення теж називає `reviews`).
    for (const [table, who] of [['trips', 'user_id'], ['photo_submissions', 'submitted_by_id'], ['reviews', 'author_id']]) {
      expect(code, `експорт не читає ${table} автора`).toMatch(new RegExp(`FROM ${table} WHERE ${who} = \\$1 ORDER BY`));
    }
    // Видалення лишає знеособлений запис про ВІДХИЛЕНЕ фото чи відгук — саме
    // вставкою в `moderation_log`, а не будь-якою згадкою слова «rejected».
    for (const kind of ['photo', 'review']) {
      expect(code, `видалення не лишає запису про відхилений ${kind}`).toMatch(
        new RegExp(`INSERT INTO moderation_log[^\`]*SELECT '${kind}', camping_spot_id, 'rejected'`),
      );
    }
    const text = pageText('privacy');
    expect(text).toContain('the data file and the account deletion described below already cover them');
    expect(text).toContain('The rule is already part of account deletion');
  });
});
