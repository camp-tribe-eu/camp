import { SeedLegalPages1792800000000 } from '../migrations/1792800000000-SeedLegalPages';
import { PrivacyProblemReports1793400000000 } from '../migrations/1793400000000-PrivacyProblemReports';
import { PrivacyProcessors1793500000000 } from '../migrations/1793500000000-PrivacyProcessors';
import { PrivacyRetentionLogs1793600000000 } from '../migrations/1793600000000-PrivacyRetentionLogs';
import { TermsHonestClaims1793800000000 } from '../migrations/1793800000000-TermsHonestClaims';
import { CookiesHonestClaims1793801000000 } from '../migrations/1793801000000-CookiesHonestClaims';
import { DatabaseHonestClaims1793802000000 } from '../migrations/1793802000000-DatabaseHonestClaims';
import { NoticeAllPages1793803000000 } from '../migrations/1793803000000-NoticeAllPages';

/**
 * Правові документи такими, якими їх лишають у базі ВСІ міграції разом.
 *
 * 🔴 ЧОМУ НЕ ЛИШЕ ПОСІВ. До 30.10.2026 єдиним відбитком правового тексту в
 * репозиторії була посівна міграція `SeedLegalPages`, і тести — вірності
 * засівання (`legal-seed.spec.ts`) та змісту сторінок (`apps/web/tests/unit/
 * legal-cms.ts`) — читали її напряму. Перша ж зміна тексту після посіву
 * (політика приватності 2.1, `PrivacyProblemReports`) зробила б посів
 * неправдою про базу: вона несе 2.0, а база після міграцій — 2.1.
 *
 * Тому тут: посів, і поверх нього — кожна пізніша міграція, що міняє
 * документ. Одне місце, з якого читають обидва набори тестів; документ,
 * якого немає в посіві, оновити не можна — це падіння з назвою, а не тихе
 * додавання.
 *
 * 🔴 Кожна нова міграція правового тексту ДОДАЄТЬСЯ в `UPDATES`. Якщо її
 * забути, `legal-seed.spec.ts` упаде посимвольно на тому документі — тобто
 * забути не вийде тихо.
 */
export interface SeededLegalPage {
  slug: string;
  title: string;
  summary: string;
  version: string;
  effectiveFrom: string;
  body: string;
}

const UPDATES: ReadonlyArray<SeededLegalPage> = [
  new PrivacyProblemReports1793400000000().page,
  new PrivacyProcessors1793500000000().page,
  new PrivacyRetentionLogs1793600000000().page,
  new TermsHonestClaims1793800000000().page,
  new CookiesHonestClaims1793801000000().page,
  new DatabaseHonestClaims1793802000000().page,
  new NoticeAllPages1793803000000().page,
];

export function seededLegalPages(): SeededLegalPage[] {
  const pages = (
    new SeedLegalPages1792800000000() as unknown as { pages: SeededLegalPage[] }
  ).pages.map((p) => ({ ...p }));
  for (const u of UPDATES) {
    const i = pages.findIndex((p) => p.slug === u.slug);
    if (i < 0) {
      throw new Error(
        `legal-seeded: міграція оновлює «${u.slug}», якого посів не несе. ` +
          `Посіяно: ${pages.map((p) => p.slug).join(', ')}.`,
      );
    }
    pages[i] = { ...u };
  }
  return pages;
}
