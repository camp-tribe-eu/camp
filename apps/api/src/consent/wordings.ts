// CAMP-390 — реєстр формулювань згод. Чисті дані: жодних імпортів, щоб його
// міг прочитати й веб-тест (`apps/web/tests/unit/consent-wording.spec.tsx`).
//
// 🔴 ЧОМУ ЦЕ Є. Ст. 7(1) GDPR: контролер мусить бути здатним ДОВЕСТИ, що
// людина погодилась. Позначка часу каже «колись погодився»; журнал із цим
// реєстром каже «погодився ось на ЦЕ». Рядок журналу несе (ключ, версію), а
// текст, який людина бачила, дістається звідси.
//
// 🔴 ТЕКСТ БЕРЕ СЕРВЕР. Клієнт не надсилає ні тексту, ні виду, ні джерела:
// `appendConsent` приймає ключ формулювання й НОМЕР версії, а текст, вид і
// джерело читає з цього файла. Зловмисний клієнт, що надіслав би «я прочитав
// усе і згоден», не має чим цього записати.
//
// 🔴 НОМЕР ВЕРСІЇ НАЗИВАЄ КЛІЄНТ — ТОЙ, ЩО ВІН ВІДРЕНДЕРИВ, — І СЕРВЕР
// ПРИЙМАЄ ЙОГО ЛИШЕ ЯКЩО ВІН ЗБІГАЄТЬСЯ З ЧИННИМ (`checkOffer`). Перша
// редакція писала `currentWording()` на момент запиту, а це не те саме, що
// людина бачила: вкладка, відкрита ДО зміни тексту й надіслана ПІСЛЯ, записала
// б нову версію, а вікно між відкриттям і натисканням не має межі. Застарілий
// номер — 409 «перезавантажте сторінку», бо людина дивиться на текст, який
// більше не чинний. Підробити версію, якої в реєстрі немає, теж не вийде.
//
// 🔴 ВІДКЛИКАННЯ НЕ ПРОХОДИТЬ ЦІЄЮ ПЕРЕВІРКОЮ. Знімати згоду мусить бути так
// само легко, як давати (ст. 7(3)), тож «ваша сторінка застаріла» на знятті
// галочки — це перешкода відкликанню. Воно завжди проходить; запис несе
// версію, яку клієнт назвав, якщо вона є в реєстрі, а інакше — чинну (див.
// `versionSeenOrCurrent`).
//
// 🔴 ВЕРСІЇ ДОПИСУЮТЬСЯ, НЕ ПЕРЕПИСУЮТЬСЯ. Змінити слово у формулюванні —
// значить додати наступну версію під тим самим ключем і лишити попередню на
// місці: рядки журналу, записані за версією 1, посилаються на текст версії 1,
// і він мусить лишитись тим, що людина бачила. `consent-wordings.spec.ts`
// тримає відбиток кожної опублікованої версії, тож виправлена «на місці»
// версія червоніє.
//
// 🔴 КОЖЕН ТЕКСТ ТУТ — ДРУГА КОПІЯ ТОГО, ЩО ПОКАЗУЄ ВЕБ. Перша лежить у
// компоненті; вони розійдуться мовчки, і журнал записуватиме версію тексту,
// якого людина не бачила. Це стереже `consent-wording.spec.tsx` у вебі: він
// ВІДДАЄ компонент у HTML, читає підпис галочки й порівнює з цим файлом.
// Він же червоніє, коли тут зʼявляється ключ, якого він не вміє знайти на
// сторінці, — формулювання без перевірки не додається тихо.
//
// 🔴 ЧОГО ТУТ НЕМАЄ — ТРЬОХ ФОТО-ЗГОД. `licence_publish`,
// `licence_sublicense` і `licence_attribution_name` у `photo_submissions` —
// булеві без тексту, і тексту цих галочок немає ніде в репозиторії: ні
// інтерфейсу подачі фото (CAMP-86; `no-upload-routes.spec.ts` стверджує, що
// маршрутів завантаження в API немає), ні затвердженого формулювання.
// Вигадувати правовий текст, який потім доведеться «показати людині», — гірше,
// ніж записати, що його немає. Види `photo_*` і джерело `moderation` у
// схемі вже є (картка їх називає), тож коли зʼявиться інтерфейс, він додасть
// сюди три записи, три рядки в сторожа веба й один виклик `appendConsent`.

/** Що саме людина дозволила. Те саме перелічено в `consent_record_kind`. */
export const CONSENT_KINDS = [
  'newsletter',
  'photo_publish',
  'photo_sublicense',
  'photo_attribution',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** З якого екрана прийшла відповідь. Те саме — у `consent_record_source`. */
export const CONSENT_SOURCES = ['signup', 'settings', 'moderation'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type Wording = {
  /** Стабільне імʼя формулювання; версії одного ключа — один і той самий екран. */
  readonly key: string;
  /** З 1, без пропусків. Нова редакція тексту — наступне число. */
  readonly version: number;
  readonly lang: 'en';
  readonly kind: ConsentKind;
  /** Екран, на якому цей текст стоїть, — і тому джерело рядка журналу. */
  readonly source: ConsentSource;
  /** Дослівно те, що людина бачить біля галочки. */
  readonly text: string;
};

/**
 * 🔴 ДВА ТЕКСТИ РОЗСИЛКИ, А НЕ ОДИН, І ЦЕ НЕ ПОМИЛКА. Біля галочки при
 * реєстрації стоїть одна фраза (з обіцянкою «не частіше разу на місяць»), біля
 * перемикача в налаштуваннях — інша (без частоти). Людина, що погодилась при
 * реєстрації, бачила першу; та, що ввімкнула в налаштуваннях, — другу. Звести
 * їх до одного рядка означало б змінити обіцянку, яку дав інтерфейс, а це не
 * рішення цієї картки.
 */
export const WORDINGS = [
  {
    key: 'newsletter.signup',
    version: 1,
    lang: 'en',
    kind: 'newsletter',
    source: 'signup',
    text: 'I want emails about new routes and guides. No more than once a month.',
  },
  {
    key: 'newsletter.settings',
    version: 1,
    lang: 'en',
    kind: 'newsletter',
    source: 'settings',
    text: 'Send me letters about new guides and features. Nothing about your account depends on this, and you can turn it off here at any time.',
  },
] as const satisfies readonly Wording[];

export type WordingKey = (typeof WORDINGS)[number]['key'];

/** Ключі реєстру, по одному разу кожен. */
export const WORDING_KEYS: readonly WordingKey[] = [
  ...new Set(WORDINGS.map((w) => w.key)),
];

/**
 * Найбільша версія ключа в переліку, або `undefined`. Окремо від реєстру, щоб
 * правило «чинна — найбільша» перевірялось на переліку з пропусками й
 * переставленим порядком, а не лише на двох записах, що лежать як лежать.
 */
export function latestOf<T extends { key: string; version: number }>(
  list: readonly T[],
  key: string,
): T | undefined {
  let best: T | undefined;
  for (const w of list)
    if (w.key === key && (!best || w.version > best.version)) best = w;
  return best;
}

/**
 * Чинна редакція: найбільша версія ключа. Саме її сервер записує — «та, що
 * діяла на момент запиту».
 */
export function currentWording(key: WordingKey): Wording {
  const best = latestOf<Wording>(WORDINGS, key);
  // 🔴 Ключ типізований, тож сюди не дійти з коду; але порожній результат
  // не мовчить — рядок журналу без формулювання нічого б не доводив.
  if (!best) throw new Error(`no wording registered for "${key}"`);
  return best;
}

/**
 * Редакція, на яку посилається рядок журналу, або `undefined`. Приймає
 * звичайні рядок і число: так вони приходять із бази.
 */
export function wordingAt(key: string, version: number): Wording | undefined {
  return (WORDINGS as readonly Wording[]).find(
    (w) => w.key === key && w.version === version,
  );
}

/** Чому запропонований клієнтом номер версії не прийнято. */
export type OfferRefusal = 'missing' | 'unknown' | 'stale';

export type Offer =
  { ok: true; wording: Wording } | { ok: false; why: OfferRefusal };

/**
 * 🔴 ЧИ МОЖНА ЗАПИСАТИ НАДАННЯ ЗГОДИ ПІД НОМЕРОМ, ЯКИЙ НАЗВАВ КЛІЄНТ.
 *
 * Приймається лише справжнє ціле число, що (1) є в реєстрі для цього ключа й
 * (2) збігається з чинним. Усе інше — відмова з причиною:
 *
 *   missing   поля немає або воно не число: клієнт, що нічого не відрендерив
 *             (старий бандл до цього релізу, скрипт). `"1"`, `1.5`, `true` —
 *             теж сюди: рядок не було б чого порівнювати з реєстром;
 *   unknown   такої версії в реєстрі немає: вигадана або з майбутнього;
 *   stale     така є, але вже не чинна: вкладка відкрита до зміни тексту.
 *
 * Сервер на всі три відповідає одним 409, і це навмисно: людині треба одне —
 * перезавантажити сторінку; а тому, хто підбирає номери, нічого розрізняти.
 * Причина лишається для тесту й для журналу, не для відповіді.
 */
export function checkOffer(key: WordingKey, offered: unknown): Offer {
  if (typeof offered !== 'number' || !Number.isInteger(offered))
    return { ok: false, why: 'missing' };
  const seen = wordingAt(key, offered);
  if (!seen) return { ok: false, why: 'unknown' };
  if (seen.version !== currentWording(key).version)
    return { ok: false, why: 'stale' };
  return { ok: true, wording: seen };
}

/**
 * Версія для запису ВІДКЛИКАННЯ: та, яку клієнт назвав, якщо вона є в реєстрі
 * (людина зняла галочку під цим текстом), а інакше — чинна. Відкликання не
 * відхиляється за версією ніколи: див. шапку файла.
 */
export function versionSeenOrCurrent(
  key: WordingKey,
  offered: unknown,
): Wording {
  if (typeof offered === 'number' && Number.isInteger(offered)) {
    const seen = wordingAt(key, offered);
    if (seen) return seen;
  }
  return currentWording(key);
}
