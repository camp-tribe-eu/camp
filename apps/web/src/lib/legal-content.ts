import { apiFetch } from "./api";
import { LEGAL_PAGES, legalPage, type LegalPage } from "./legal";
import { PAGE_REVALIDATE_SECONDS, PAGE_TAG } from "./page-content";

// CAMP-365 — текст правових документів приходить із нашого API.
//
// 🔴 ЧИТАЄТЬСЯ ПІД ЧАС ЗБІРКИ, РЕНДЕРИТЬСЯ СТАТИЧНО. Це розвʼязка
// конфлікту двох рішень, і вона записана тут, бо інакше її переграють
// мовчки:
//
//   • CAMP-56: ці сторінки мусять читатись, коли база чи CMS лежать, бо
//     момент, коли вони потрібні, часто збігається з моментом аварії;
//   • CAMP-365: власник керує текстом із CMS.
//
// Обидва виконано. Власник правит у CMS → перезбірка (або ISR) віддає
// нову сторінку. База лягла в рантаймі → читач бачить останню добру
// статичну сторінку, бо до бази він не ходить узагалі.
//
// 🔴 А ПРОТИЛЕЖНИЙ БІК — НЕ ВІДДАТИ ПОРОЖНЄ — ТРИМАЄТЬСЯ ТУТ. Правовий
// документ, якого немає або чиє тіло порожнє, на правовій адресі
// читається як «у них немає умов». Це гірше, ніж відсутня адреса, тож
// збірка ПАДАЄ з іменем документа: не порожня сторінка, не мовчазний
// пропуск. На живому сервері те саме означає, що невдала перебудова
// лишає читачеві попередню (справну) сторінку.
//
// 🔴 ЦЕ СВІДОМИЙ ВИНЯТОК із правила «один зіпсований запис коштує одного
// запису». Для решти контенту збірка пропускає запис; для правових
// документів власник сказав прямо: падати.
//
// ЗАПАСНОГО ТЕКСТУ В КОДІ НЕМАЄ НАВМИСНО. Він повернув би той самий
// хардкод, який картка прибирає, і зробив би збій невидимим: сторінка
// малювалась би «правильно» й тоді, коли база віддала порожнє.

/** Документ, який сторінка може малювати: кожне поле — непорожній рядок. */
export interface LegalDocument {
  slug: string;
  title: string;
  /** «Якщо коротко» (GDPR ст. 12). */
  summary: string;
  version: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Розмітка CMS із якорями заголовків. */
  body: string;
}

/**
 * Поля, які сторінка ДРУКУЄ, у порядку, в якому вона їх друкує.
 *
 * 🔴 Порожнє не малюємо: кожне з них або є, або збірка падає. Опис
 * (`summary`) теж: схема називає його обовʼязком (GDPR ст. 12), а
 * абзац, що мовчки зник із правової сторінки, читач не помітить.
 */
const PRINTED = ["title", "summary", "version", "effectiveFrom", "body"] as const;

/**
 * Перевірка однієї відповіді API. Чиста: без мережі, тож її можна
 * довести мутаціями, не піднімаючи ні базу, ні сервер.
 *
 * 🔴 ВЕРСІЯ Й ДАТА МУСЯТЬ ЗБІГАТИСЬ ІЗ РЕЄСТРОМ. Версію політики cookies
 * читає синхронний клієнтський `consent.ts` із `LEGAL_PAGES`, і від неї
 * залежить, чи збережена згода читача лишається чинною. Якщо база скаже
 * «2.0», а реєстр «1.0», сторінка стверджуватиме одну версію, а згода
 * ключуватиметься іншою — найгірший стан для правового документа.
 * Тому розбіжність валить збірку, а не мовчки малюється.
 *
 * Ціна названа чесно: власник не може підняти версію в CMS, не піднявши
 * її в реєстрі. Збірка тоді стоїть, а сайт віддає попередню сторінку.
 * Це і є обіцянка — версія їде РАЗОМ із тим, що від неї залежить.
 *
 * Назва й опис із реєстром НЕ звіряються: реєстр годує підвал, і назва
 * в базі, відмінна від підвальної, — вигляд, а не неправда.
 */
export function checkLegalDocument(
  slug: string,
  raw: unknown,
  registered: LegalPage | undefined = legalPage(slug),
): LegalDocument {
  if (!registered) {
    throw new Error(
      `правовий документ «${slug}»: його немає в реєстрі lib/legal.ts, ` +
        "тож підвал, карта сайту й згода його не знають.",
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `правовий документ «${slug}»: API віддав не обʼєкт, а ` +
        `${raw === null ? "null" : typeof raw}.`,
    );
  }
  const r = raw as Record<string, unknown>;

  // 🔴 ЧУЖИЙ ДОКУМЕНТ ПІД ТИМ САМИМ СЛАГОМ. Міграція вже раз мовчки
  // пропускала чужий правовий текст (рецензія #315); сторінка, що
  // друкує тіло «privacy» під адресою «terms», гірша за 404.
  if (r.slug !== slug) {
    throw new Error(
      `правовий документ «${slug}»: GET /legal/${slug} віддав документ ` +
        `«${String(r.slug)}».`,
    );
  }

  for (const field of PRINTED) {
    const v = r[field];
    if (typeof v === "string" && v.trim() !== "") continue;
    const state = v === undefined || v === null ? "відсутнє" : "порожнє";
    throw new Error(
      field === "body"
        ? `правовий документ «${slug}»: тіло ${state}. Порожній правовий ` +
            "документ на правовій адресі читається як «у них немає умов» — " +
            "це гірше за відсутню адресу, тож збірка зупиняється."
        : `правовий документ «${slug}»: поле «${field}» ${state}. ` +
            "Сторінка друкує його, тож без нього її не зібрати.",
    );
  }

  const doc = r as unknown as LegalDocument;
  if (doc.version !== registered.version) {
    throw new Error(
      `правовий документ «${slug}»: версія в базі «${doc.version}», у ` +
        `реєстрі lib/legal.ts «${registered.version}». Згоду на cookies ` +
        "ключує реєстр, тож версія мусить рухатись разом із ним.",
    );
  }
  if (doc.effectiveFrom !== registered.effectiveFrom) {
    throw new Error(
      `правовий документ «${slug}»: дата набуття чинності в базі ` +
        `«${doc.effectiveFrom}», у реєстрі lib/legal.ts ` +
        `«${registered.effectiveFrom}».`,
    );
  }

  return {
    slug,
    title: doc.title,
    summary: doc.summary,
    version: doc.version,
    effectiveFrom: doc.effectiveFrom,
    body: doc.body,
  };
}

/**
 * Опубліковані слаги проти реєстру: множини мусять збігатись у ОБИДВА
 * боки.
 *
 * 🔴 ЗНИКЛИЙ — ЦЕ ТЕ САМЕ, ЩО Й ПОРОЖНІЙ. Якби `generateStaticParams`
 * брав слаги лише з API, документ, якого база не віддала (знятий із
 * публікації, без перекладу), просто не отримав би сторінки — і
 * `/legal/terms` стало б звичайним 404 без жодного слова в збірці.
 * Очікуваний перелік береться з реєстру, а не з відповіді.
 *
 * 🔴 ЗАЙВИЙ — ТЕЖ ПОМИЛКА: сторінка була б, а підвала, карти сайту й
 * версії для згоди в неї не було б.
 */
export function checkPublishedSet(
  published: readonly string[],
  registered: readonly string[] = LEGAL_PAGES.map((p) => p.slug),
): void {
  const problems = [
    ...registered
      .filter((s) => !published.includes(s))
      .map(
        (s) =>
          `«${s}» є в реєстрі lib/legal.ts, але CMS його не віддає ` +
          "(немає рядка зі status = published і англійського перекладу)",
      ),
    ...published
      .filter((s) => !registered.includes(s))
      .map(
        (s) =>
          `«${s}» опубліковано в CMS, але його немає в реєстрі lib/legal.ts`,
      ),
  ];
  if (problems.length > 0) {
    throw new Error(
      "правові документи розійшлись із реєстром:\n  " + problems.join("\n  "),
    );
  }
}

/**
 * Слаги правових документів для `generateStaticParams`.
 *
 * Недосяжний API — помилка, а не порожній перелік: порожній перелік дав
 * би збірку без жодної правової сторінки, яка вийшла б зеленою.
 */
export async function legalSlugs(): Promise<string[]> {
  const res = await apiFetch("/legal", {
    next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [PAGE_TAG] },
  });
  if (!res.ok) {
    throw new Error(
      `правові документи недосяжні: GET /legal → ${res.status}. ` +
        "Їхній текст живе в CMS, тож без відповіді сторінок нема з чого зібрати.",
    );
  }
  const body = (await res.json()) as { documents?: unknown };
  if (!Array.isArray(body.documents)) {
    throw new Error(
      "правові документи: у відповіді GET /legal немає масиву `documents`, а " +
        `${body.documents === null ? "null" : typeof body.documents}.`,
    );
  }
  const published = body.documents.map((d: unknown) =>
    d !== null && typeof d === "object"
      ? String((d as { slug?: unknown }).slug)
      : String(d),
  );
  checkPublishedSet(published);
  return published;
}

/**
 * Один правовий документ, перевірений.
 *
 * 🔴 404 ТУТ — ПОМИЛКА, А НЕ `null`. Викликач уже відсіяв слаги, яких
 * немає в реєстрі, тож 404 на слаг із реєстру означає «документ зняли з
 * публікації», а не «такої сторінки немає».
 */
export async function legalDocument(slug: string): Promise<LegalDocument> {
  const res = await apiFetch(`/legal/${encodeURIComponent(slug)}`, {
    next: { revalidate: PAGE_REVALIDATE_SECONDS, tags: [PAGE_TAG] },
  });
  if (res.status === 404) {
    throw new Error(
      `правовий документ «${slug}»: GET /legal/${slug} → 404. Він є в ` +
        "реєстрі, а CMS його не віддає — знятий із публікації чи без " +
        "англійського перекладу. Сторінки без нього не буде.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `правовий документ «${slug}» недосяжний: GET /legal/${slug} → ${res.status}.`,
    );
  }
  return checkLegalDocument(slug, await res.json());
}
