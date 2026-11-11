// CAMP-463: правила сторожа `check-no-internal-disclosure.mjs` — ЧИСТІ,
// без читання файлів, мережі й `import.meta`.
//
// 🔴 ЧОМУ ОКРЕМИЙ ФАЙЛ. Сам сторож ходить по збірці або по мережі й
// запускає себе; юніт-тест `apps/web/tests/unit/public-disclosure-formats.spec.tsx`
// мусить спитати те саме питання про розмітку компонента, яку щойно
// відрендерив. Один читач видимого тексту, два викликачі: тест, що
// носить власну копію правила, погоджувався б сам із собою і ні з чим
// іншим (так само влаштовано `scripts/seo/page-text.mjs`).
//
// Перелік заборонених шаблонів — ТУТ, в одному місці, кожен із причиною.

/**
 * Представницькі адреси для режиму `--base`. Не вичерпні — вичерпний
 * прохід робить збірка. Кожна тут тому, що на ній колись знайшли
 * заборонене.
 */
export const REPRESENTATIVE = [
  '/',
  '/routes',
  '/routes/france-atlantic-coast',
  '/camper-rental',
  '/camper-rental/fr',
  '/camper-rental/providers',
  '/camper-rental/providers/auto-grupp-2000',
  '/tools',
  '/guides/topic/water',
  '/camping/fr/vendee/aire-aiguillon-sur-mer-le-port',
  '/legal/database',
  '/legal/attribution',
];

// ── ПЕРЕЛІК ЗАБОРОНЕНОГО — ЄДИНЕ МІСЦЕ ───────────────────────────────────
//
// Кожен рядок: `re` (що ловить), `why` (чому заборонено — читає той, у
// кого сторож позеленів і хто хоче його «послабити»), `example` (рядок,
// який це правило МУСИТЬ зловити; самотест проганяє кожне правило по
// його ж прикладу, тож правило, що перестало кусатись, червоніє).
//
// Додаткові поля:
//   notOn        — шлях сторінки, де правило не діє (причина в `why`);
//   maxPerPage   — скільки разів фраза законна на ОДНІЙ сторінці: один
//                  раз над переліком — так, у кожній картці — ні.

export const FORBIDDEN = [
  // ── A. переговорна позиція й плани ─────────────────────────────────────
  {
    id: 'A-fastest-way',
    re: /fastest way to make a site/i,
    why: 'Розмова про те, як ми НЕ хочемо виглядати для пошуковика; читач прийшов по маршрут.',
    example: 'which is the fastest way to make a site that nobody has any reason to trust',
  },
  {
    id: 'A-routing-engine',
    re: /routing engine/i,
    why: 'Наша інфраструктура й те, що вона «не працює». Читачеві — що саме не показано, а не чому.',
    example: 'Each needs our own routing engine, which is not running.',
  },
  {
    id: 'A-pays-for-itself',
    re: /pay(s)? for itself|meant to pay/i,
    why: 'Як сайт має заробляти — не справа читача. Розкриття звʼязку стоїть там, де звʼязок Є (UCPD ст. 7(2)).',
    example: 'Camper rental commission is how this site is meant to pay for itself',
  },
  {
    id: 'A-no-affiliate-links',
    re: /no affiliate links on this page/i,
    why: 'Оголошення відсутності комерційного звʼязку нічого не розкриває, а розповідає про наші перемовини.',
    example: 'There are no affiliate links on this page yet.',
  },
  {
    id: 'A-no-partner',
    re: /\bwe have no (rental |affiliate )?partners?\b|\bno rental partner\b/i,
    why: 'Стан наших перемовин із партнерами: читачеві не потрібно знати, що їх немає і чому.',
    example: 'We have no rental partner for France, so there is nothing here to click.',
  },
  {
    id: 'A-no-prices-no-vehicles',
    re: /no prices and no vehicles/i,
    why: 'Перше, що бачить відвідувач сторінки оренди, мусить бути про сторінку, а не про те, чого на ній немає.',
    example: 'There are no prices and no vehicles here.',
  },
  {
    id: 'A-not-integrated',
    re: /not integrated (yet)?|have not integrated/i,
    why: 'План інтеграції з партнерами, яких немає.',
    example: 'It needs prices from partners we have not integrated yet',
  },
  {
    id: 'A-planned-alongside',
    re: /planned alongside/i,
    why: 'Обіцянка інструмента, якого немає, без дати, яку ми знаємо.',
    example: 'A camper comparison tool was planned alongside these.',
  },
  {
    id: 'A-phoned-ahead',
    re: /\bphoned ahead\b/i,
    why: 'Розповідь про наші дії (не телефонували) замість меж даних (не перевірено на місці).',
    example: 'We have not phoned ahead, and we hold no ratings.',
  },
  {
    id: 'A-model-invented',
    re: /a (sentence )?(a )?model invented/i,
    why: 'Захист від звинувачення, якого читач не висував.',
    example: 'Nothing here is an opinion, an estimate or a sentence a model invented.',
  },

  // ── B. машинний формат, показаний читачеві ────────────────────────────
  {
    id: 'B-iso-datetime',
    // 🔴 ФОРМАТ, а не дата: інакше позеленіє завтра.
    re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    why: 'ISO-мітка часу у видимому тексті. Читачеві — «3 November 2026»; машині — атрибут `datetime`.',
    example: 'bike rack — included in the price · read 2026-11-03T00:00:00.000Z',
  },
  {
    id: 'B-osm-tag',
    re: /\b(?:motorhome|caravan|access|fee|backrest|opening_hours|drinking_water|toilets|shower|internet_access|capacity)=[A-Za-z0-9_;:.-]+/,
    // Правова сторінка про базу ОБОВʼЯЗАНА назвати теги, з яких побудовано
    // поля (ODbL §4.6: опис наших змін). Там тег — предмет тексту, а не
    // витік.
    notOn: /^\/legal\//,
    why: 'Сирий тег OpenStreetMap у тілі сторінки. Читачеві — речення: «OpenStreetMap records this site as signposted for motorhomes».',
    example: 'according to OpenStreetMap ( motorhome=designated ), read on 10 November 2026',
  },
  {
    id: 'B-osm-hours',
    re: /\b(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su))* \d{1,2}:\d{2}-\d{1,2}:\d{2}/,
    why: 'Сирий синтаксис годин OSM. Читачеві — «Mon–Sat 08:30–13:00»; що не розібралось — під спойлером «Opening hours as recorded».',
    example: 'Mo 15:30-19:45; Tu-Sa 08:30-13:00,15:30-19:45',
  },
  {
    id: 'B-program-name',
    re: /\bregion-facts@\d+/,
    why: 'Внутрішня назва програми. Читач питає «хто це написав» — відповідь словами, не іменем скрипта.',
    example: 'The program is region-facts@2.',
  },
  {
    id: 'B-assembled-in-every-card',
    re: /assembled from our database/i,
    // Один раз над переліком — законно (позначка походження сторінки).
    // У кожній картці — ні: на сторінці про воду їх було 463.
    maxPerPage: 1,
    why: 'Позначка походження — один раз на сторінку, над переліком; у кожній картці вона лише розповідає про наш спосіб виробництва.',
    example: 'Assembled from our database Campsites by the water in Como Assembled from our database Campsites by the water in Fermo',
  },
  {
    id: 'B-plain-html',
    re: /served as plain html|reads without javascript|without javascript/i,
    why: 'Технологія, якою зроблено сторінку, — не те, по що читач прийшов.',
    example: 'its table of all 27 countries is served as plain HTML, so it reads without JavaScript',
  },
  {
    id: 'B-own-figure',
    // 🔴 ОБИДВІ форми апострофа: `'` і `’`. Сторінка друкує `’`.
    re: /company['’]s own figure/i,
    why: 'Повтор позначки «заявлено компанією» після кожного числа; одного разу над переліком досить.',
    example: 'depots: 1 (company’s own figure) · fleet: 3 (company\'s own figure)',
  },
  {
    id: 'B-dangling-separator',
    // Рядок (блок) закінчується роздільником, починається з нього, або
    // два роздільники поспіль: «depots: 1 · fleet: 3 ·» — крапка є,
    // значення немає. Блоки розділені \n при витягуванні тексту.
    re: /[ \t][·•][ \t]*(?:\n|$)|(?:^|\n)[ \t]*[·•][ \t]|[·•][ \t]+[·•]/,
    why: 'Обірваний роздільник: крапка стоїть, значення немає.',
    example: 'depots: 1 · fleet: 3 ·\nservices listed: 4',
  },

  // ── C. сирі URL джерела на місці назви ─────────────────────────────────
  {
    id: 'C-datatourisme-url',
    re: /https?:\/\/data\.datatourisme\.fr\/\S+|\bdata\.datatourisme\.fr\/\d+\/[0-9a-f-]{20,}/i,
    why: 'Сирий URL запису джерела на місці назви кемпінгу. Читачеві — назва, джерело, ліцензія й дата; посилання лишається посиланням, але не текстом.',
    example: 'https://data.datatourisme.fr/23/e437c815-500c-375e-9720-84692c3a214a — 17 November 2024',
  },
];

/**
 * Речення, що ЗАКОННІ і мусять пройти. Це друга половина «ціни хибного
 * спрацювання»: ми свідомо пишемо читачеві, чого НЕ знаємо, і це
 * чесність про дані, а не кухня. Самотест гарантує, що жодне правило не
 * зачепить жодне з них — інакше його «виправлять» послабленням.
 */
export const LEGITIMATE = [
  'Because we hold none. We link to the companies that rent campers rather than mirroring their prices.',
  'Facilities not recorded. Nobody has recorded it. That is a gap in the data, not a no.',
  'Allowed — according to OpenStreetMap, which records this site as signposted for motorhomes. Read on 10 November 2026.',
  'Mon–Fri 09:00–18:00; Sat 09:00–13:00; Sun closed',
  'Opening hours as recorded',
  'Source dates — all 5 dates. 17 November 2024 · 5 December 2025',
  '2 depots · fleet of 14 · trading since 2005',
  'Road distance is not shown: the only distance on this page is the straight line between the stops.',
  'Weekly extract from OpenStreetMap, shop=supermarket, railway=station, tourism=camp_site',
];

// ── витягування видимого тексту ───────────────────────────────────────

const INLINE = 'a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  middot: '·', hellip: '…', times: '×', deg: '°',
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/**
 * Що читач бачить на сторінці, як текст з розривами рядків між блоками.
 *
 * 🔴 ЩО НАВМИСНО НЕ ВХОДИТЬ: `<script>`, `<style>`, коментарі, атрибути
 * (там живе `datetime`), і спойлер `<details data-hours="as-recorded">` —
 * єдине місце, де сирий рядок годин законний, бо там він і названий
 * «as recorded».
 */
export function visibleText(html) {
  let h = html;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(h);
  if (body) h = body[1];
  h = h
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<details\b[^>]*\bdata-hours="as-recorded"[^>]*>[\s\S]*?<\/details>/gi, ' ')
    .replace(new RegExp(`</?(?:${INLINE})\\b[^>]*>`, 'gi'), '')
    .replace(/<[^>]+>/g, '\n');
  return decode(h)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Усі збіги всіх правил на одній сторінці. */
export function scanText(route, text) {
  const out = [];
  for (const rule of FORBIDDEN) {
    if (rule.notOn?.test(route)) continue;
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ phrase: m[0], at: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    const limit = rule.maxPerPage ?? 0;
    if (hits.length > limit) {
      const h = hits[limit];
      out.push({
        id: rule.id,
        route,
        phrase: h.phrase,
        count: hits.length,
        why: rule.why,
        context: text.slice(Math.max(0, h.at - 60), h.at + h.phrase.length + 60).replace(/\s+/g, ' '),
      });
    }
  }
  return out;
}

export const scanPage = (route, html) => scanText(route, visibleText(html));
