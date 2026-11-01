import { seededLegalPages } from "../../../api/src/pages/legal-seeded";
import { LegalProse } from "@/components/legal-prose";
import { renderComponent } from "./render-component";

/**
 * Правові документи так, як їх засіяла міграція, — для тестів, що читають
 * їхній ЗМІСТ.
 *
 * 🔴 ЦЕ ТЕКСТ ІЗ МІГРАЦІЙ, А НЕ ТЕКСТ ІЗ КОДУ. До CAMP-365 політику
 * приватності в юніт-тестах малював компонент `privacy.tsx`. Тепер
 * компонента немає: текст живе в базі, а в репозиторії лишається його
 * відбиток у міграціях — посів `SeedLegalPages` і кожна пізніша міграція,
 * що міняє документ (перша — `PrivacyProblemReports`, політика 2.1).
 * Що саме лежить у базі після ВСІХ міграцій, складає
 * `apps/api/src/pages/legal-seeded.ts`; тести, яким потрібні слова
 * документа, беруть їх звідти — те саме місце, з якого читає
 * `legal-seed.spec.ts` на справжньому Postgres.
 *
 * 🔴 ЧОГО ЦЕ НЕ БАЧИТЬ, І ЦЕ НАЗВАНО. Правка, зроблена ПОТІМ у CMS, цим
 * тестам невидима: вони про засіяний текст. Що засіяне й подане читачеві —
 * одне й те саме, доводить `tests/e2e/legal-content.spec.ts` на збірці з фікстури
 * (подана сторінка дослівно дорівнює цьому рендеру). Чи збігається з
 * конфігом ТЕКСТ, який власник відредагував у CMS, не перевіряє ніхто, —
 * див. опис PR до CAMP-365.
 *
 * 🔴 ВИТЯГНУТО ВИКОНАННЯМ, А НЕ РОЗБОРОМ ФАЙЛА. Тіло в міграції — шаблонний
 * рядок із екрануванням; регулярка по ньому мусила б самотужки повторити
 * правила мови, а інстанція класу віддає саме той рядок, який піде в базу.
 * Поле `pages` приватне, тож читається крізь приведення типу — тест
 * свідомо лізе туди, куди код не пускає.
 */
interface Seeded {
  slug: string;
  title: string;
  summary: string;
  version: string;
  effectiveFrom: string;
  body: string;
}

export const SEEDED: readonly Seeded[] = seededLegalPages();

/** Розмітка одного документа, або падіння з назвою, якщо його немає. */
export function seededBody(slug: string): string {
  const doc = SEEDED.find((d) => d.slug === slug);
  if (!doc) {
    throw new Error(
      `legal-cms: міграція не засіває «${slug}». Засіває: ` +
        `${SEEDED.map((d) => d.slug).join(", ") || "—"}.`,
    );
  }
  if (doc.body.trim() === "") throw new Error(`legal-cms: «${slug}» порожній.`);
  return doc.body;
}

/** HTML тіла документа — тим самим рендером, що й справжня сторінка. */
export function seededHtml(slug: string): string {
  return renderComponent(LegalProse, { text: seededBody(slug) });
}
