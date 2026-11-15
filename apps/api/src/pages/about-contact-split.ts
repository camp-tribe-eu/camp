import { SeedAboutPage1792400000000 } from '../migrations/1792400000000-SeedAboutPage';
import { SeedContactPage1792500000000 } from '../migrations/1792500000000-SeedContactPage';

/**
 * Розрізання оригінальних текстів /about і /contact на секції — CAMP-464.
 *
 * 🔴 ЦЕ НЕ ФАЙЛ МІГРАЦІЇ, І ЦЕ НАВМИСНО. TypeORM вантажить КОЖЕН експорт-
 * функцію з `src/migrations/*.ts` як клас міграції; експортована звичайна
 * функція поруч із класом стала б «міграцією» без позначки часу й
 * завалила б `migration:run`. Чисті функції живуть тут, а міграція їх
 * імпортує — і тест (`about-contact-split.spec.ts`) перевіряє їх без бази.
 */

export const ABOUT_PROSE = (
  new SeedAboutPage1792400000000() as unknown as { prose: string }
).prose;
export const CONTACT_PROSE = (
  new SeedContactPage1792500000000() as unknown as { prose: string }
).prose;

/** Кінець першого речення третього абзацу «про нас»; тут його розрізаємо. */
const ABOUT_P3_SPLIT = ' Where a reading is older than its source allows';
const ABOUT_P2_LEAD = '**What we do not know, we say.** ';

export interface AboutParts {
  intro: string;
  uncertainTitle: string;
  uncertainText: string;
  liveText: string;
  staleText: string;
  operator: string;
}

/**
 * Розрізає чотири абзаци «про нас» на частини секцій і ПЕРЕВІРЯЄ, що
 * з частин збирається оригінал. Експортовано заради тесту.
 */
export function splitAbout(prose: string): AboutParts {
  const paras = prose.split('\n\n');
  if (paras.length !== 4) {
    throw new Error(`about: очікувалось 4 абзаци, є ${paras.length}`);
  }
  const [p1, p2, p3, p4] = paras;
  if (!p2.startsWith(ABOUT_P2_LEAD)) {
    throw new Error('about: другий абзац не починається з виділеного зачину');
  }
  const cut = p3.indexOf(ABOUT_P3_SPLIT);
  if (cut < 1) {
    throw new Error('about: у третьому абзаці немає місця розрізу');
  }
  const parts: AboutParts = {
    intro: p1,
    uncertainTitle: ABOUT_P2_LEAD.replace(/\*\*/g, '')
      .trim()
      .replace(/\.$/, ''),
    uncertainText: p2.slice(ABOUT_P2_LEAD.length),
    liveText: p3.slice(0, cut),
    staleText: p3.slice(cut + 1),
    operator: p4,
  };
  // 🔴 Збирання назад: це й є доказ «нічого не втрачено й не переписано».
  const rebuilt = [
    parts.intro,
    `${ABOUT_P2_LEAD}${parts.uncertainText}`,
    `${parts.liveText} ${parts.staleText}`,
    parts.operator,
  ].join('\n\n');
  if (rebuilt !== prose) {
    throw new Error('about: розріз не збирається назад в оригінал');
  }
  return parts;
}

export interface ContactParts {
  intro: string;
  /** Абзаци 2 і 3: чого ми не можемо й що вислати від власника кемпінгу. */
  card: string;
  operator: string;
}

export function splitContact(prose: string): ContactParts {
  const paras = prose.split('\n\n');
  if (paras.length !== 4) {
    throw new Error(`contact: очікувалось 4 абзаци, є ${paras.length}`);
  }
  const parts: ContactParts = {
    intro: paras[0],
    card: `${paras[1]}\n\n${paras[2]}`,
    operator: paras[3],
  };
  const rebuilt = [parts.intro, parts.card, parts.operator].join('\n\n');
  if (rebuilt !== prose) {
    throw new Error('contact: розріз не збирається назад в оригінал');
  }
  return parts;
}

/**
 * Речення про вивантаження фото — внутрішня кухня («ще не існує» говорить про
 * наш беклог, а не про те, що робити читачеві). Власник це відзначив.
 */
export const CONTACT_OLD_UPLOADS =
  'Uploads through the site do not exist yet, so email is the whole of it.';
export const CONTACT_NEW_UPLOADS =
  'Email is all it takes — there is nothing else to fill in.';

/**
 * Текст картки для читача: оригінальні абзаци, але без речення про те, чого
 * «ще немає». Падає, якщо речення в оригіналі не знайшлось: мовчазна
 * заміна нічого не змінила б і виглядала б як зроблена.
 */
export function publicContactCard(card: string): string {
  if (!card.includes(CONTACT_OLD_UPLOADS)) {
    throw new Error('contact: речення про вивантаження не знайдено в картці');
  }
  return card.replace(CONTACT_OLD_UPLOADS, CONTACT_NEW_UPLOADS);
}
