import { createHash, randomInt } from 'node:crypto';

/**
 * «Claim your listing» — доказ володіння кемпінгом. CAMP-51, CAMP-232.
 *
 * 🔴 ПРЕМІСА КАРТКИ ЗАМІРЯНА, А НЕ ПЕРЕКАЗАНА. Картка каже «~10 000 адрес
 * у нас уже є» з Overpass 19.09.2026. Власний запит до `camping_spots`
 * 03.11.2026 (база `camptribe_dev`, 63 159 рядків):
 *
 *   contact ? 'email'    →  11 628   (18,4 %)
 *   contact ? 'website'  →  28 518
 *   contact ? 'phone'    →  18 636
 *
 * Тобто канал існує й він навіть ширший, ніж обіцяла картка. Це єдина
 * підстава будувати потік: без адрес він не має входу.
 *
 * 🔴 КОД, А НЕ ПОСИЛАННЯ — І ЦЕ НЕ СТИЛЬ.
 *
 * Лист іде на ЧУЖУ адресу: публічний контакт кемпінгу з тегів OSM.
 * Посилання в такому листі віддало б доступ тому, хто натисне, — тобто
 * власник кемпінгу, клікнувши в незнайомому листі, подарував би листинг
 * невідомо кому. Код працює навпаки: його треба ВВЕСТИ в нас, уже
 * будучи в акаунті. Це доводить, що одна людина і отримала лист, і
 * тримає акаунт, — рівно те, що ми хочемо довести.
 *
 * 🔴 АДРЕСА НАЗОВНІ НЕ ВИХОДИТЬ. Відповідь показує лише маску
 * (`i***@c***.de`), бо інакше кінцева точка стає зручним способом
 * витягти 11 628 робочих адрес підприємств по одній.
 */

/** Публічні контакти кемпінгу, як вони лежать у `camping_spots.contact`. */
export type SpotContact = Record<string, unknown> | null | undefined;

/**
 * Адреса з тегів OSM, або `null`.
 *
 * 🔴 ЖОДНОГО ІНШОГО ДЖЕРЕЛА. Не з тіла запиту, не з профілю користувача,
 * не з форми. Умова картки дослівна: «Код підтвердження йде ТІЛЬКИ на
 * адресу з тегів OSM, а не на введену користувачем». Якби функція вміла
 * брати адресу звідкись іще, це перестало б бути доказом володіння.
 */
export function osmEmail(contact: SpotContact): string | null {
  const raw = contact?.['email'];
  if (typeof raw !== 'string') return null;
  // В OSM трапляється `a@b.de;c@d.de` — беремо першу й лише її.
  const first = raw.split(';')[0].trim();
  return looksLikeEmail(first) ? first.toLowerCase() : null;
}

/**
 * Найпростіша перевірка, яка нас цікавить: один `@`, щось до нього, і
 * домен із крапкою. Повну граматику RFC тут ловити нема сенсу — лист або
 * дійде, або ні, і це видно з доставки.
 */
export function looksLikeEmail(value: string): boolean {
  if (value.length < 6 || value.length > 320) return false;
  if (/\s/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  return true;
}

/**
 * `info@camping-alpenblick.de` → `i***@c***.de`.
 *
 * Досить, щоб справжній власник упізнав свою адресу, і замало, щоб її
 * відновити. Повертає `null`, якщо маскувати нічого: функція ніколи не
 * має віддати щось, що виглядає як адреса, з неадреси.
 */
export function maskEmail(value: string): string | null {
  if (!looksLikeEmail(value)) return null;
  const [local, domain] = value.split('@');
  const dot = domain.lastIndexOf('.');
  const name = domain.slice(0, dot);
  const tld = domain.slice(dot + 1);
  return `${local[0]}***@${name[0]}***.${tld}`;
}

/**
 * Алфавіт коду без `0/O/1/I/L` — їх плутають, коли переписують з листа,
 * а кожна зайва невдала спроба тут коштує рахунка спроб, не часу.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;

/**
 * Код із CSPRNG. `randomInt` без модуля — рівномірний розподіл; `% 31`
 * від випадкового байта дав би перші символи алфавіту частіше.
 */
export function newCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * 🔴 У БАЗІ ЛЕЖИТЬ ХЕШ, НІКОЛИ КОД — те саме правило, що й для
 * `auth_tokens.token_hash` і `sessions`, з тієї ж причини: дамп цієї
 * таблиці не має бути набором готових «забрати чужий кемпінг».
 *
 * Код — 8 символів із CSPRNG, тож швидкий хеш тут доречний: повільний
 * KDF захищає СЛАБКІ секрети, а цей слабким не є.
 */
export function codeHash(code: string): string {
  return createHash('sha256').update(normaliseCode(code)).digest('hex');
}

/**
 * Те, що людина переписала з листа, зводиться до того, що ми згенерували:
 * пробіли й дефіси між групами, нижній регістр — усе це та сама спроба.
 */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** Скільки живе код. Довше за лист у дорозі, коротше за забутий лист. */
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 🔴 ДВІ МЕЖІ, І ВОНИ СТЕРЕЖУТЬ РІЗНЕ.
 *
 * `PER_SPOT` захищає ЧУЖИЙ бізнес: без неї будь-хто надсилає листи на
 * 11 628 адрес підприємств, і зворотною адресою стоїмо ми.
 * `PER_USER` захищає нас: один акаунт не має права розсилати каталог.
 */
export const PER_SPOT_PER_DAY = 3;
export const PER_USER_PER_DAY = 10;

/** Скільки разів можна помилитись кодом, перш ніж заявку спалено. */
export const MAX_ATTEMPTS = 5;

export type StartRefusal =
  | 'anonymous'
  | 'no-email'
  | 'already-claimed'
  | 'spot-flooded'
  | 'user-flooded';

export type StartInput = {
  viewerId: string | null;
  contact: SpotContact;
  /** Чи вже хтось підтвердив цей кемпінг. */
  confirmedOwnerId: string | null;
  sentForSpotToday: number;
  sentByUserToday: number;
};

/**
 * Чому цю заявку не почати, або `null`.
 *
 * Причина, а не булеве: виклик мусить розрізняти «увійди» (401) від
 * «тут нема куди слати» (422) і від «зачекай» (429). Булеве злило б їх
 * в одну відповідь, і перша ж людина застрягла б, не знаючи чому.
 */
export function startRefusal(input: StartInput): StartRefusal | null {
  if (typeof input.viewerId !== 'string' || input.viewerId === '')
    return 'anonymous';
  // 🔴 Уже підтверджений кемпінг не шле листів НІКОМУ, навіть власнику:
  // інакше заявка стає способом турбувати адресу нескінченно.
  if (input.confirmedOwnerId !== null) return 'already-claimed';
  if (osmEmail(input.contact) === null) return 'no-email';
  if (input.sentForSpotToday >= PER_SPOT_PER_DAY) return 'spot-flooded';
  if (input.sentByUserToday >= PER_USER_PER_DAY) return 'user-flooded';
  return null;
}

export type ConfirmRefusal =
  'anonymous' | 'no-pending' | 'expired' | 'burned' | 'wrong-code';

export type PendingClaim = {
  userId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
} | null;

/**
 * Чому цю спробу підтвердження не прийняти, або `null`.
 *
 * 🔴 ЧУЖА ЗАЯВКА ВІДПОВІДАЄ ТАК САМО, ЯК ВІДСУТНЯ. Інакше «no-pending»
 * проти «wrong-code» розповідає, чи хтось уже claim'ить цей кемпінг, —
 * і кінцева точка стає довідником про те, за які листинги вже взялись.
 */
export function confirmRefusal(
  viewerId: string | null,
  pending: PendingClaim,
  code: string,
  now: Date,
): ConfirmRefusal | null {
  if (typeof viewerId !== 'string' || viewerId === '') return 'anonymous';
  if (!pending || pending.userId !== viewerId) return 'no-pending';
  if (pending.usedAt !== null) return 'no-pending';
  if (pending.attempts >= MAX_ATTEMPTS) return 'burned';
  if (pending.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (codeHash(code) !== pending.codeHash) return 'wrong-code';
  return null;
}

/**
 * Скільки рядків змінив `UPDATE … RETURNING`, поданий через
 * `DataSource.query`.
 *
 * 🔴 ЗАМІРЯНО, А НЕ ПРИПУЩЕНО, І ЦЕ ВЖЕ КОШТУВАЛО ПОМИЛКИ.
 *
 * Того самого дня в міграції я написав `(await query('UPDATE … RETURNING
 * 1')).length` і надрукував **2** там, де рядків було **30**. Замір:
 *
 *   ds.query('UPDATE spot_claims … RETURNING id')
 *   →  [[{"id":"d392a922-…"}], 1]
 *
 * Тобто пара `[рядки, кількість]`, і `.length` зовнішнього масиву — це
 * завжди 2. Драйвер може віддати й просто масив рядків, тож функція
 * розрізняє обидві форми, а не вірить одній.
 */
export function updatedRowCount(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  const [first, second] = result as unknown[];
  if (Array.isArray(first) && typeof second === 'number') return second;
  if (Array.isArray(first)) return first.length;
  return result.length;
}
