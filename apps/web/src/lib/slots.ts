import type { SectionView } from "@/lib/page-content";

// CAMP-461 — сторінка, яка сама розкладає секції за слотами.
//
// 🔴 СЕКЦІЯ, ЯКУ МАКЕТ НЕ ЗАБРАВ, НЕ СМІЄ ЗНИКНУТИ МОВЧКИ.
//
// Хаб оренди, сторінка країни й сторінка компаній тримають у CMS не
// суцільний документ, а набір СЛОТІВ: банер, віджет, блок компаній,
// рядки «текст + фото». Макет кожного слота вирішує сторінка. Тому
// власник, який додав у адмінці секцію в слот, якого сторінка не знає
// (або забув слот узагалі), побачить дірку на сайті й вирішить, що
// зламалась CMS. Те саме, що `assertAllSectionsUsed` каже про ТИПИ, тут
// сказано про СЛОТИ.
//
// Падіння тут — на збірці, і воно зупиняє викладку; на живому сервері
// Next лишає попередню справну сторінку. Обидва наслідки кращі за
// мовчазну дірку.

export interface SlotSpec {
  /** Слоти, що мусять бути рівно по одному. */
  one: readonly string[];
  /** Слоти-повтори (`story:0`, `story:1` …), у порядку бази. */
  many?: RegExp;
}

export interface Claimed {
  one: Record<string, SectionView>;
  many: SectionView[];
}

export function claimSlots(
  sections: readonly SectionView[],
  spec: SlotSpec,
  where: string,
): Claimed {
  const one: Record<string, SectionView> = {};
  const many: SectionView[] = [];
  for (const s of sections) {
    if (s.slot === null || s.slot === "") {
      throw new Error(
        `slots: ${where} — секція «${s.type}» без слота. Макет цієї ` +
          "сторінки розкладає секції за слотами, тож безслотова секція " +
          "нікуди не потрапить.",
      );
    }
    if (spec.one.includes(s.slot)) {
      if (one[s.slot]) {
        throw new Error(`slots: ${where} — слот «${s.slot}» двічі.`);
      }
      one[s.slot] = s;
    } else if (spec.many && spec.many.test(s.slot)) {
      many.push(s);
    } else {
      throw new Error(
        `slots: ${where} — слот «${s.slot}» сторінці невідомий. Відомі: ` +
          `${[...spec.one, ...(spec.many ? [String(spec.many)] : [])].join(", ")}.`,
      );
    }
  }
  const missing = spec.one.filter((k) => !one[k]);
  if (missing.length > 0) {
    throw new Error(
      `slots: ${where} — немає слотів: ${missing.join(", ")}. Порожнє ` +
        "місце на сторінці читається як дефект, а не як вибір.",
    );
  }
  return { one, many };
}

/** Слот, у якому ОБОВʼЯЗКОВІ заголовок і кнопка; інакше — гучно. */
export function withButton(
  s: SectionView,
  where: string,
): SectionView & { heading: string; ctaHref: string; ctaLabel: string } {
  if (!s.heading || !s.ctaHref || !s.ctaLabel) {
    throw new Error(
      `slots: ${where} — слот «${s.slot}» мусить мати заголовок, адресу ` +
        "і підпис кнопки.",
    );
  }
  return s as SectionView & {
    heading: string;
    ctaHref: string;
    ctaLabel: string;
  };
}
