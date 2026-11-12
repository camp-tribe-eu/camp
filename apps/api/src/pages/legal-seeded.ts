import { SeedLegalPages1792800000000 } from '../migrations/1792800000000-SeedLegalPages';
import { PrivacyProblemReports1793400000000 } from '../migrations/1793400000000-PrivacyProblemReports';
import { PrivacyProcessors1793500000000 } from '../migrations/1793500000000-PrivacyProcessors';
import { PrivacyRetentionLogs1793600000000 } from '../migrations/1793600000000-PrivacyRetentionLogs';
import { AttributionSources1793700000000 } from '../migrations/1793700000000-AttributionSources';
import { TermsHonestClaims1793800000000 } from '../migrations/1793800000000-TermsHonestClaims';
import { CookiesHonestClaims1793801000000 } from '../migrations/1793801000000-CookiesHonestClaims';
import { DatabaseHonestClaims1793802000000 } from '../migrations/1793802000000-DatabaseHonestClaims';
import { NoticeAllPages1793803000000 } from '../migrations/1793803000000-NoticeAllPages';
import { PrivacyBrowserStorage1793900000000 } from '../migrations/1793900000000-PrivacyBrowserStorage';
import { PrivacySpotClaims1794400000000 } from '../migrations/1794400000000-PrivacySpotClaims';
import { AttributionFlags1794800000000 } from '../migrations/1794800000000-AttributionFlags';
import { DatabaseUndatedPrices1794900000000 } from '../migrations/1794900000000-DatabaseUndatedPrices';
import { ThemeChoiceCookies1795100000000 } from '../migrations/1795100000000-ThemeChoiceCookies';
import { ThemeChoicePrivacy1795200000000 } from '../migrations/1795200000000-ThemeChoicePrivacy';
import { AttributionElevationFromBucket1796000000000 } from '../migrations/1796000000000-AttributionElevationFromBucket';
import { AttributionBannerImages1796600000000 } from '../migrations/1796600000000-AttributionBannerImages';

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
  new AttributionSources1793700000000().page,
  new TermsHonestClaims1793800000000().page,
  new CookiesHonestClaims1793801000000().page,
  new DatabaseHonestClaims1793802000000().page,
  new NoticeAllPages1793803000000().page,
  new PrivacyBrowserStorage1793900000000().page,
  // CAMP-436: заявка на володіння кемпінгом.
  new PrivacySpotClaims1794400000000().page,
  // CAMP-450: прапори країн на /camping (flag-icons, MIT).
  new AttributionFlags1794800000000().page,
  // CAMP-475: недатована ціна показується, застаріла — ні.
  new DatabaseUndatedPrices1794900000000().page,
  // CAMP-448: четвертий запис у сховищі браузера — вибір теми.
  new ThemeChoiceCookies1795100000000().page,
  new ThemeChoicePrivacy1795200000000().page,
  // CAMP-484: висота приходить із відра AWS Open Data, а не через API.
  new AttributionElevationFromBucket1796000000000().page,
  // CAMP-469: декоративні банери згенеровані ШІ; названо модель і сервіс.
  new AttributionBannerImages1796600000000().page,
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
