import { createHash, randomBytes } from 'node:crypto';
import { getDomain } from 'tldts';
import { looksLikeEmail, maskEmail } from './spot-claim';

/**
 * Самоверифікація власника по домену пошти. CAMP-505, CAMP-232.
 *
 * 🔴 ПИТАННЯ, НА ЯКЕ ЦЕЙ ФАЙЛ ВІДПОВІДАЄ: «чи може ЦЯ людина, що ввела ЦЮ
 * адресу, читати пошту кемпінгу ЦЕЙ?». Не «чи схожа адреса на сайт».
 * Відповідь «так» дає право на листинг без жодної людини в ланцюзі, тож
 * кожне правило нижче — це місце, де хибне «так» віддало б чужий кемпінг.
 *
 * 🔴 ДОМЕН ПОРІВНЮЄТЬСЯ ЗА ЗАРЕЄСТРОВАНИМ ДОМЕНОМ (eTLD+1), З ПРИВАТНОЮ
 * ЧАСТИНОЮ PUBLIC SUFFIX LIST. Не за підрядком і не за «останні дві
 * мітки»:
 *
 *  · підрядок: `evil-camping.de` містить `camping.de`;
 *  · дві мітки: `camping.co.uk` → `co.uk`, і будь-який `*.co.uk` збігся б
 *    з будь-яким іншим;
 *  · ЛИШЕ ICANN-частина списку (її дає `tldts-icann`, що вже лежить у
 *    lock-файлі як залежність lighthouse): `a.blogspot.com` і
 *    `b.blogspot.com` обидва стають `blogspot.com`. Власник одного
 *    блогу «підтвердив» би кожен кемпінг, чий сайт стоїть на blogspot.
 *    `allowPrivateDomains` тримає їх різними: `a.blogspot.com` ≠
 *    `b.blogspot.com`.
 */

/** Чому адреса дала право. Лишається в базі в `spot_claims.method`. */
export type OwnerBasis = 'website-domain' | 'listed-email';

/** Метод запису в `spot_claims.method` для цього шляху. */
export const METHOD_LINK = 'link';

/**
 * Зареєстрований домен хоста, або `null`, коли хост не годиться: IP-адреса,
 * невідомий суфікс, порожній рядок.
 */
/**
 * Що вважається хостом: літери, цифри, крапки й дефіси, без крайніх крапок і
 * дефісів, і більше нічого.
 *
 * 🔴 ЦЕ ВХІДНА ПЕРЕВІРКА ДЛЯ `getDomain`, І ВОНА НЕ ПРИКРАСА. `tldts`
 * розбирає ВХІД ЯК URL і відрізає все після `/`, `?` чи `#`: рядок
 * `slashcamp.de/.evil.example` повертає `slashcamp.de`. Адреса
 * `a@slashcamp.de/.evil.example` тоді «збігалась» із сайтом кемпінгу, а лист
 * пішов би на скриньку під чужим доменом (знайдено рецензією PR #586).
 * Хост, у якому є хоч один символ поза цим алфавітом, домену не має.
 * Той самий вираз, що `HOST` у `auth/mail-smtp.ts`, але лише малі літери:
 * вхід тут уже приведено до нижнього регістру.
 */
export const HOST_LC = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export function registrable(host: string): string | null {
  const clean = host.trim().toLowerCase().replace(/\.$/, '');
  if (clean === '' || !HOST_LC.test(clean) || clean.includes('..')) return null;
  const d = getDomain(clean, { allowPrivateDomains: true });
  return d === null || d === undefined || d === '' ? null : d;
}

/** Домен із адреси пошти, або `null`. */
export function emailDomain(email: string): string | null {
  if (!looksLikeEmail(email)) return null;
  return registrable(email.slice(email.lastIndexOf('@') + 1));
}

/**
 * Безкоштовні й провайдерські поштовики: скриньку на них заводить будь-хто,
 * тож збіг з ними нічого не доводить.
 *
 * 🔴 ПОВНИЙ СПИСОК НЕМОЖЛИВИЙ, І ЦЕ НЕ ПРИМХА, А ЧЕСНА МЕЖА. Це відомі нам
 * ЄС-27 і найбільші світові. Дірка в списку — це скринька, яку хтось
 * може завести собі і назвати доказом. Тому поруч стоїть друга лінія:
 * збіг мусить бути з доменом КЕМПІНГУ, а не просто «не з цього списку».
 * Кемпінг, чий сайт стоїть на невідомому нам поштовику, потрапить сюди
 * лише тоді, коли його власник — одна людина на весь той поштовик.
 */
const FREE_MAIL = new Set<string>([
  // глобальні
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'protonmail.ch',
  'mail.com',
  'email.com',
  'zoho.com',
  'zohomail.eu',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'tutanota.com',
  'tuta.com',
  'tuta.io',
  'tutamail.com',
  'tutanota.de',
  'keemail.me',
  'mailfence.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'gmx.at',
  'gmx.ch',
  'gmx.fr',
  'gmx.es',
  'gmx.eu',
  'web.de',
  'mailbox.org',
  'posteo.de',
  'posteo.net',
  'runbox.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'bk.ru',
  'inbox.ru',
  'list.ru',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  // DE / AT / CH
  't-online.de',
  'freenet.de',
  'arcor.de',
  'online.de',
  'vodafone.de',
  '1und1.de',
  'ionos.de',
  'aol.de',
  'live.de',
  'hotmail.de',
  'yahoo.de',
  'outlook.de',
  'icloud.de',
  'chello.at',
  'aon.at',
  'a1.net',
  'drei.at',
  'bluewin.ch',
  'sunrise.ch',
  'hispeed.ch',
  'gmx.li',
  'swissonline.ch',
  // FR
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'neuf.fr',
  'laposte.net',
  'bbox.fr',
  'numericable.fr',
  'club-internet.fr',
  'aliceadsl.fr',
  'hotmail.fr',
  'yahoo.fr',
  'outlook.fr',
  'live.fr',
  'icloud.fr',
  'gmail.fr',
  // IT
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'alice.it',
  'tin.it',
  'email.it',
  'fastwebnet.it',
  'hotmail.it',
  'yahoo.it',
  'outlook.it',
  'live.it',
  'icloud.it',
  'pec.it',
  // ES / PT
  'terra.es',
  'telefonica.net',
  'movistar.es',
  'ono.com',
  'hotmail.es',
  'yahoo.es',
  'outlook.es',
  'live.es',
  'icloud.es',
  'sapo.pt',
  'iol.pt',
  'zon.pt',
  'netcabo.pt',
  'hotmail.pt',
  'outlook.pt',
  // NL / BE / LU
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'hetnet.nl',
  'xs4all.nl',
  'home.nl',
  'chello.nl',
  'upcmail.nl',
  'hotmail.nl',
  'outlook.nl',
  'live.nl',
  'telenet.be',
  'skynet.be',
  'proximus.be',
  'scarlet.be',
  'belgacom.net',
  'pt.lu',
  'luxembourg.lu',
  // Nordic / Baltic
  'telia.com',
  'tele2.se',
  'bredband.net',
  'comhem.se',
  'swipnet.se',
  'hotmail.se',
  'outlook.dk',
  'tdc.dk',
  'telia.dk',
  'sol.dk',
  'mail.dk',
  'luukku.com',
  'elisa.fi',
  'saunalahti.fi',
  'kolumbus.fi',
  'suomi24.fi',
  'inbox.lv',
  'apollo.lv',
  'one.lv',
  'inbox.lt',
  'one.lt',
  'takas.lt',
  'mail.ee',
  'online.ee',
  'hot.ee',
  'neti.ee',
  'tele2.ee',
  // CZ / SK / PL / HU / RO / BG / HR / SI / GR / CY / MT / IE
  'seznam.cz',
  'email.cz',
  'centrum.cz',
  'volny.cz',
  'atlas.cz',
  'post.cz',
  'zoznam.sk',
  'centrum.sk',
  'azet.sk',
  'post.sk',
  'wp.pl',
  'o2.pl',
  'onet.pl',
  'onet.eu',
  'op.pl',
  'interia.pl',
  'interia.eu',
  'poczta.fm',
  'gazeta.pl',
  'tlen.pl',
  'vp.pl',
  'freemail.hu',
  'citromail.hu',
  't-online.hu',
  'indamail.hu',
  'vipmail.hu',
  'yahoo.ro',
  'rdslink.ro',
  'abv.bg',
  'mail.bg',
  'dir.bg',
  'gbg.bg',
  'inet.hr',
  'net.hr',
  't-com.hr',
  'siol.net',
  'amis.net',
  'telemach.net',
  'otenet.gr',
  'forthnet.gr',
  'cytanet.com.cy',
  'melita.com',
  'go.com.mt',
  'eircom.net',
  'indigo.ie',
  'iol.ie',
  'hotmail.ie',
  'yahoo.ie',
  'outlook.ie',
  'gmail.ie',
  // UK (не ЄС, але лист туди теж пише власник)
  'btinternet.com',
  'btopenworld.com',
  'sky.com',
  'virginmedia.com',
  'talktalk.net',
  'ntlworld.com',
  'blueyonder.co.uk',
  'tiscali.co.uk',
  'hotmail.co.uk',
  'yahoo.co.uk',
  'live.co.uk',
  'outlook.co.uk',
  'aol.co.uk',
  'googlemail.co.uk',
  'icloud.co.uk',
]);

/**
 * Мітка перед першою крапкою, яка у БУДЬ-ЯКОГО поштовика сім'ї означає
 * «скриньку заводить хто завгодно»: `yahoo.*`, `hotmail.*`, `outlook.*`,
 * `live.*`, `gmx.*`, `yandex.*`, `aol.*`, `msn.*`, `icloud.*`, `mail.*`.
 * Закриває десятки національних доменів, яких немає в списку вище.
 */
const FREE_MAIL_LABELS = new Set<string>([
  'yahoo',
  'hotmail',
  'outlook',
  'live',
  'gmx',
  'yandex',
  'aol',
  'msn',
  'icloud',
  'mail',
  'gmail',
  'googlemail',
  'protonmail',
  'proton',
  'tutanota',
  'ymail',
  'rocketmail',
]);

/**
 * Спільні майданчики: на них стоїть сторінка кемпінгу, але пошти там не
 * дають, а якщо й дають, то власник майданчика — не власник кемпінгу.
 * `facebook.com` як «домен кемпінгу» означав би, що кожен, хто має
 * `x@facebook.com`, — власник усіх кемпінгів з посиланням на Facebook.
 *
 * Так само бронювання й каталоги, куди кемпінг дає посилання на свою
 * картку.
 */
const SHARED_PLATFORMS = new Set<string>([
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'google.com',
  'goo.gl',
  'g.page',
  'linktr.ee',
  'wix.com',
  'wixsite.com',
  'wordpress.com',
  'weebly.com',
  'squarespace.com',
  'webnode.com',
  'jimdo.com',
  'jimdofree.com',
  'strikingly.com',
  'godaddysites.com',
  'business.site',
  'booking.com',
  'airbnb.com',
  'tripadvisor.com',
  'expedia.com',
  'campingcard.com',
  'acsi.eu',
  'eurocampings.eu',
  'park4night.com',
  'camping.info',
  'pitchup.com',
  'cosycamp.com',
  'hipcamp.com',
  'campsy.de',
  'openstreetmap.org',
  'wikipedia.org',
  'wikidata.org',
  'wikimedia.org',
]);

/** Це поштовик, на якому скриньку заводить будь-хто? */
export function isFreeMail(registrableDomain: string): boolean {
  const d = registrableDomain.toLowerCase();
  if (FREE_MAIL.has(d)) return true;
  return FREE_MAIL_LABELS.has(d.split('.')[0]);
}

/** Це спільний майданчик, а не домен самого кемпінгу? */
export function isSharedPlatform(registrableDomain: string): boolean {
  return SHARED_PLATFORMS.has(registrableDomain.toLowerCase());
}

/**
 * Чи може цей домен свідчити про кемпінг. Ні для поштовиків і майданчиків.
 */
export function usableDomain(domain: string | null): domain is string {
  return domain !== null && !isFreeMail(domain) && !isSharedPlatform(domain);
}

/** `;`-розділені значення з тегів OSM, кожне окремо й нормалізоване. */
function parts(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[;,\s]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** Хост з адреси сайту. Адреса без схеми (`www.camp.de`) теж трапляється. */
export function hostOfUrl(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  try {
    // Схема є, коли за двокрапкою НЕ порт: `mailto:a@b.de` і `javascript:…`
    // мають схему й відхиляються нижче; `camp.de:8080/x` — це хост із портом.
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text);
    const url = new URL(hasScheme ? text : `http://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.replace(/\.$/, '');
    return host === '' || !HOST_LC.test(host) ? null : host;
  } catch {
    return null;
  }
}

/** Що ми знаємо про кемпінг і з чим можна порівнювати. */
export type SpotFacts = {
  /** Колонка `camping_spots.website` (DATAtourisme й частина OSM). */
  website?: string | null;
  /** `camping_spots.contact` як є: `website`, `email`, … */
  contact?: Record<string, unknown> | null;
};

/** Один сайт кемпінгу з наших даних: хост і його зареєстрований домен. */
export type SiteHost = {
  /** Хост без початкового `www.`. */
  host: string;
  /** Зареєстрований домен (eTLD+1). */
  domain: string;
  /** Хост і є зареєстрованим доменом (`camp.de`, а не `camping.stadt.de`). */
  apex: boolean;
};

/**
 * Сайти кемпінгу (колонка `website` і `contact.website`), без поштовиків і
 * майданчиків.
 *
 * 🔴 ДОМЕН З АДРЕСИ ПОШТИ ТУТ НЕ БЕРЕТЬСЯ. Адреса `info@agency-x.com` у
 * тегах — це контакт, а не доказ, що весь `agency-x.com` належить
 * кемпінгу: так виглядає посередник, бронювальна агенція, провайдер.
 * Така адреса дає право лише сама, дослівно (`listedEmails`).
 */
export function siteHosts(facts: SpotFacts): SiteHost[] {
  const out = new Map<string, SiteHost>();
  for (const raw of [
    ...parts(facts.website),
    ...parts(facts.contact?.['website']),
  ]) {
    const full = hostOfUrl(raw);
    if (full === null) continue;
    const host = full.replace(/^www\./, '');
    const domain = registrable(host);
    if (!usableDomain(domain)) continue;
    out.set(host, { host, domain, apex: host === domain });
  }
  return [...out.values()];
}

/** Зареєстровані домени сайтів кемпінгу. */
export function spotDomains(facts: SpotFacts): Set<string> {
  return new Set(siteHosts(facts).map((h) => h.domain));
}

/** Зареєстровані домени пошт, які кемпінг сам оголосив (без поштовиків). */
export function listedEmailDomains(facts: SpotFacts): Set<string> {
  const out = new Set<string>();
  for (const e of listedEmails(facts)) {
    const d = emailDomain(e);
    if (usableDomain(d)) out.add(d);
  }
  return out;
}

/**
 * Чи згадує цей кемпінг цей зареєстрований домен — сайтом або поштою. Це те,
 * що рахує «домен спільний»: див. `ownerBasis`.
 */
export function mentionsDomain(facts: SpotFacts, domain: string): boolean {
  return (
    spotDomains(facts).has(domain) || listedEmailDomains(facts).has(domain)
  );
}

/** Адреси, які кемпінг сам оголосив, у нижньому регістрі. */
export function listedEmails(facts: SpotFacts): Set<string> {
  const out = new Set<string>();
  for (const raw of parts(facts.contact?.['email'])) {
    const e = raw.toLowerCase();
    if (looksLikeEmail(e)) out.add(e);
  }
  return out;
}

/**
 * Адреса, як її вводить людина: обрізана, нижній регістр, без лапок і
 * службових символів. `null` — це не адреса, і лист на неї не йде.
 *
 * 🔴 Строгіше за `looksLikeEmail`: те приймає все, що має `@` і крапку, а
 * тут адреса йде в заголовок `To:`. Символи `<>,;:"'()\` і керівні
 * відсікаються, щоб одне поле не стало двома одержувачами.
 */
export function typedEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (e.length > 254) return null;
  if (/[\u0000-\u001f\u007f<>,;:"'()\\[\]]/.test(e)) return null;
  if (!looksLikeEmail(e)) return null;
  // 🔴 Домен — лише літери, цифри, крапки й дефіси; локальна частина — без
  // `/ ? # %` та інших знаків, яким URL-розбір дає значення. Див. `HOST_LC`.
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!/^[a-z0-9._+-]+$/.test(local)) return null;
  if (!HOST_LC.test(domain) || domain.includes('..')) return null;
  return e;
}

/**
 * Чому ця адреса дає право на цей кемпінг, або `null`.
 *
 * Порядок має значення тільки для назви підстави; дозволяє будь-яка.
 *
 * 🔴 ПОШТОВИК НЕ ДАЄ ПРАВА ЗА ЖОДНОЇ ПІДСТАВИ — навіть коли адреса
 * дослівно стоїть у контактах кемпінгу. Картка вимагає цього прямо:
 * «пошта на публічному домені НЕ дає автоматичних прав, навіть якщо
 * збігається з контактом у базі». Скринька на gmail у тегах OSM
 * доводить, що хтось колись її вказав, а не що той, хто ввів її зараз,
 * нею володіє: адресу бачить кожен, хто відкрив сторінку.
 */
export function ownerBasis(
  facts: SpotFacts,
  typed: unknown,
  /**
   * Зареєстровані домени, які згадує БІЛЬШЕ ніж один кемпінг (див. нижче).
   * За ними автопідтвердження по домену не дається, лише дослівна адреса.
   */
  sharedDomains: ReadonlySet<string> = new Set(),
): OwnerBasis | null {
  const email = typedEmail(typed);
  if (email === null) return null;
  const host = email.slice(email.lastIndexOf('@') + 1);
  const domain = emailDomain(email);
  if (!usableDomain(domain)) return null;
  for (const site of siteHosts(facts)) {
    if (site.domain !== domain || sharedDomains.has(domain)) continue;
    // 🔴 ХОСТ САЙТУ ВИРІШУЄ, ЧИ ВЕСЬ ДОМЕН НАШ.
    //
    // `camp.de` (або `www.camp.de`) — власник тримає весь домен, і пошта на
    // будь-якому його піддомені (`mail.camp.de`) — його. А `camping.bayern.de`,
    // `home.kpn.nl/camp`, `camp.kabelbw.de` — це кімната в чужому домені:
    // решта домену належить регіону, провайдеру, каталогу, а скриньку під
    // `bayern.de` може мати будь-хто з них. Тут збігається лише ТОЧНИЙ хост
    // (`x@camping.bayern.de`), а не eTLD+1. Це загальне правило замість
    // списку провайдерів, яких нам не перелічити (рецензія PR #586).
    if (site.apex ? true : host === site.host) return 'website-domain';
  }
  if (listedEmails(facts).has(email)) return 'listed-email';
  return null;
}

/**
 * Маска, яку приймає `spot_claims_masked_is_masked`, або `null`.
 *
 * База вимагає, щоб після останньої крапки йшли лише букви a-z (2+). Адреса
 * на `xn--p1ai` чи з цифрою в суфіксі пройшла б усе вище й впала б на
 * INSERT-і — тобто людина отримала б 500 замість відповіді. Тут це
 * відсікається ДО запису.
 */
export function maskForClaim(email: string): string | null {
  const m = maskEmail(email);
  if (m === null) return null;
  return /\.[a-z]{2,}$/.test(m) ? m : null;
}

/**
 * Одноразове посилання. 32 байти з CSPRNG, base64url: 256 біт, тож швидкий
 * sha256 доречний (повільний KDF захищає слабкі секрети, а цей не слабкий).
 */
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Що лежить у базі замість токена. */
export function linkTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Скільки живе посилання. Той самий строк, що й в усіх листах з посиланням. */
export const LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Скільки днів значення сайту чи пошти мусить стояти в наших даних
 * НЕЗМІННИМ, щоб за ним можна було підтвердити власника автоматично.
 *
 * 🔴 ЦЕ ЗАХИСТ ВІД ОДНОГО ПРЯМОГО ОБХОДУ: будь-хто може вписати власний
 * `website` чи `contact:email` в OpenStreetMap, дочекатись імпорту й
 * підтвердити себе власником. Імпорт кладе `content_changed_at` у день, коли
 * побачив ЗМІНУ в будь-якому видимому полі (назва, тип, зручності,
 * `contact` ЦІЛКОМ, розташування) — тож це верхня межа віку значення, а не
 * точний вік: зміна ЧОГОСЬ ІНШОГО теж обнуляє відлік, і це помилка в
 * безпечний бік. Чого це НЕ ловить: мапера, що змінив тег і повернув старе
 * значення між двома імпортами; і того, хто чекає 30 днів. Місяць — час,
 * за який спільнота OSM звичайно бачить правку й повертає її; число
 * обране, а не заміряне.
 */
export const MIN_STABLE_DAYS = 30;

/** Скільки листів на ОДНУ адресу за добу, коли їх рахує пам'ять процесу. */
export const PER_ADDRESS_PER_DAY = 3;

/**
 * Лічильник листів на адресу — лише в пам'яті процесу.
 *
 * 🔴 НЕ В БАЗІ, І ЦЕ РІШЕННЯ ПРО ДАНІ, А НЕ ЛІНЬ. Щоб рахувати за адресою
 * в базі, довелося б зберігати адресу або її хеш. Хеш пошти — це
 * псевдонімізований персональний ідентифікатор, який угадує словник.
 * Політика приватності вже каже «адреси ми не зберігаємо»; ця межа
 * не мусить цього ламати. Ключ тут — sha256 адреси, живе до кінця
 * вікна й нікуди не пишеться; клас не імпортує ані файлів, ані мережі.
 *
 * Ціна, названа прямо: перезапуск процесу обнуляє лічильник, і на двох
 * вузлах межа подвоюється. Поруч стоять межі, що переживають перезапуск
 * (3 на кемпінг і 10 на акаунт за добу в базі, і ліміт на IP).
 */
export class AddressLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly limit = PER_ADDRESS_PER_DAY,
    private readonly windowMs = 24 * 60 * 60 * 1000,
    private readonly maxKeys = 50_000,
  ) {}

  /** Записати спробу. `true` — можна слати, `false` — ліміт вичерпано. */
  take(address: string, now = Date.now()): boolean {
    const key = createHash('sha256')
      .update(address.toLowerCase())
      .digest('hex');
    const fresh = (this.seen.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (fresh.length >= this.limit) {
      this.seen.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.seen.set(key, fresh);
    if (this.seen.size > this.maxKeys) this.sweep(now);
    return true;
  }

  /** Викинути вікна, що закінчились; якщо й так забагато — найстаріші. */
  private sweep(now: number): void {
    for (const [k, v] of this.seen) {
      if (v.every((t) => now - t >= this.windowMs)) this.seen.delete(k);
    }
    while (this.seen.size > this.maxKeys) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  /** Скільки ключів тримається. Для тесту, що пам'ять обмежена. */
  size(): number {
    return this.seen.size;
  }
}
