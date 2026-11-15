import Link from "next/link";
import {
  COMPANY,
  DATA_LEGAL_SLUGS,
  LEGAL_PAGES,
  legalPath,
} from "@/lib/legal";
import { liveLocales, type Locale } from "@/lib/i18n";
import type { NavItem } from "@/lib/navigation";
import type { SocialLink } from "@/lib/site-settings";
import { Block } from "@/components/layout";
import { CookieSettingsLink } from "./cookie-consent";
import { CurrentYear } from "./current-year";
import { LanguageSwitch } from "./language-switch";

/**
 * Підвал за взірцем теми Fuse — CAMP-448.
 *
 * 🔴 ЩО ТЕМА МАЄ І ЩО МИ ВІДТВОРЮЄМО (знімки ревю 441/25–441/26, розділ
 * «Футер Fuse» у `docs/owner-review-2026-11-05.md`):
 *   • колонки навігації              → колонки з CMS (`navigation`, location
 *                                      footer): корінь — заголовок-посилання,
 *                                      діти — список;
 *   • соцкнопки у склі               → `SocialButtons`, лише вписані
 *                                      редактором; жодної — блоку немає;
 *   • гігантський напис із фото в
 *     літерах                        → `.ct-wordmark` (текст як маска);
 *   • мова                           → `LanguageSwitch`, лише живі мови;
 *   • кнопка «вгору»                 → якір `#top`.
 *   Іконок оплати не маємо: ми нічого не продаємо.
 *
 * 🔴 ПРАВОВІ ПОСИЛАННЯ — КОЖНЕ ОДИН РАЗ. До цієї картки сторінка джерел
 * (`/legal/attribution`) стояла двічі: у переліку «Legal» і ще раз у тексті
 * про дані. Тепер їх два списки з різним призначенням і без перетину:
 *   Legal  — правила (terms, privacy, cookies, disclaimer, notice) і
 *            налаштування cookie;
 *   Data   — звідки дані (attribution, database), поруч із атрибуцією ODbL.
 * Розподіл тримає `DATA_LEGAL_SLUGS`, а тест читає відданий HTML і доводить, що
 * жодна адреса не повторюється.
 *
 * 🔴 ПРАВОВІ СТОРІНКИ — З `LEGAL_PAGES`, а не з CMS: обовʼязкове
 * посилання не можна випадково видалити з бази (CAMP-56).
 */

const NETWORK_LABEL: Record<SocialLink["network"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

/** Прості контурні знаки 24×24; кольору не мають — його дає `currentColor`. */
const NETWORK_ICON: Record<SocialLink["network"], React.ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: <path d="M14 8.5h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3.5h2.5V21H14v-6.5h2.5L17 11h-3V8.5Z" />,
  youtube: (
    <>
      <rect x="2.8" y="5.5" width="18.4" height="13" rx="4" />
      <path d="M10 9.2v5.6l4.8-2.8L10 9.2Z" fill="currentColor" stroke="none" />
    </>
  ),
  tiktok: <path d="M14 4v10.2a3.2 3.2 0 1 1-3.2-3.2M14 4c.3 2.3 1.9 3.9 4.2 4.1" />,
  x: <path d="M5 5l14 14M19 5L5 19" />,
  linkedin: (
    <>
      <path d="M6 10v8M6 6.2v.1M10.5 18v-8M10.5 13c0-2 1.4-3 3-3s3 1 3 3v5" />
    </>
  ),
  pinterest: <path d="M12 3.5a8.5 8.5 0 0 0-3.1 16.4c-.1-.7-.1-1.8.1-2.6l1-4.2s-.3-.5-.3-1.3c0-1.2.7-2.1 1.6-2.1.8 0 1.1.6 1.1 1.2 0 .8-.5 1.9-.7 2.9-.2.9.4 1.6 1.3 1.6 1.6 0 2.9-1.7 2.9-4.2 0-2.2-1.6-3.7-3.8-3.7a4 4 0 0 0-4.2 4c0 .8.3 1.6.7 2.1" />,
};

/**
 * Кнопки соцмереж у склі, як у колонці Contact теми. Порожній перелік — не
 * малюється ЗОВСІМ: ні заголовка, ні порожнього ряду.
 */
export function SocialButtons({ links }: { links: readonly SocialLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul aria-label="Social media" data-testid="footer-social" className="mt-4 flex flex-wrap gap-2">
      {links.map((l) => (
        <li key={l.network}>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={NETWORK_LABEL[l.network]}
            className="ct-glass grid size-12 place-items-center rounded-card border border-line-2 text-heading ct-button-motion hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {NETWORK_ICON[l.network]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Фото-смуга: назва, літери якої залиті фотографією (`background-clip:
 * text`), — те, що тема робить зі своєю назвою. Не експортується навмисно:
 * тест має читати відданий HTML, а не цю константу.
 *
 * 🔴 ЗАПАСНИЙ КОЛІР — ПІД КАРТИНКОЮ, а не замість: `background-clip: text`
 * обрізає й колір, тож якщо фото не завантажилось, літери лишаються
 * видимими сірими, а не зникають.
 */
const WORDMARK_CSS = `
.ct-wordmark{margin:0;padding:8px 0 0;text-align:center;user-select:none;
font-family:var(--font-narrow);font-weight:800;text-transform:uppercase;
font-size:clamp(48px,15.5vw,240px);line-height:.88;letter-spacing:-.02em;
color:transparent;
background-color:var(--color-line-2);
background-image:url(/banners/lake.webp);background-size:cover;background-position:center 60%;
-webkit-background-clip:text;background-clip:text}
`;

function ColumnLinks({ items }: { items: NavItem[] }) {
  return (
    <ul className="mt-3">
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className="flex min-h-12 items-center underline">
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * ODbL requires attribution wherever the data is shown, so it belongs in
 * the footer of every page rather than being repeated per template and
 * eventually forgotten on one of them.
 */
export function SiteFooter({
  nav = [],
  footerNote = null,
  socialLinks = [],
  locales = liveLocales(),
}: {
  nav?: NavItem[];
  /**
   * Речення під назвою — з CMS (CAMP-481). `null` означає, що редактор
   * його не вписав або база недосяжна; тоді абзацу немає зовсім, бо
   * порожній абзац читається як поломка верстки, а не як порожнеча.
   */
  footerNote?: string | null;
  /** Соцмережі з CMS (CAMP-448); порожньо — блоку немає. */
  socialLinks?: readonly SocialLink[];
  /** Лише ЖИВІ мови; порожньо — перемикача мови немає. */
  locales?: readonly Locale[];
}) {
  // Корінь із дітьми — колонка. Корінь без дітей — не губиться, а йде в
  // спільну колонку «More»: пункт, який редактор додав, мусить бути видно.
  const columns = nav.filter((i) => i.children.length > 0);
  const loose = nav.filter((i) => i.children.length === 0);
  const policy = LEGAL_PAGES.filter((p) => !DATA_LEGAL_SLUGS.includes(p.slug));
  const dataPages = LEGAL_PAGES.filter((p) => DATA_LEGAL_SLUGS.includes(p.slug));
  const navCols = columns.length + (loose.length > 0 ? 1 : 0);

  return (
    <footer className="mt-16 border-t border-line-2 bg-surface">
      <style href="ct-wordmark" precedence="ct-components">
        {WORDMARK_CSS}
      </style>
      <div className="mx-auto max-w-wrap px-4 py-10 text-xs text-ink-2 xl:px-6">
        <div
          data-testid="footer-columns"
          className="grid gap-8 md:grid-cols-2 xl:[grid-template-columns:minmax(0,1.3fr)_repeat(var(--ct-f-cols),minmax(0,1fr))_minmax(0,1fr)]"
          style={{ ["--ct-f-cols" as string]: navCols }}
        >
          {/* 1. Хто ми, і де нас шукати. */}
          <div>
            <Link
              href="/"
              className="flex items-center gap-2 text-base font-bold text-heading"
            >
              <span aria-hidden="true">⛺</span>
              CampTribe
            </Link>
            {footerNote && <p className="mt-3 max-w-[32ch]">{footerNote}</p>}
            <SocialButtons links={socialLinks} />
          </div>

          {/* 2. Колонки навігації з CMS. Заголовок — справжня сторінка. */}
          {columns.map((col) => (
            <nav key={col.href} aria-label={col.label} data-footer-column={col.href}>
              <h2 className="text-xs text-heading">
                <Link href={col.href} className="underline">
                  {col.label}
                </Link>
              </h2>
              <ColumnLinks items={col.children} />
            </nav>
          ))}

          {loose.length > 0 && (
            <nav aria-label="More">
              <h2 className="text-xs text-heading">More</h2>
              <ColumnLinks items={loose} />
            </nav>
          )}

          {/* 3. Правила. */}
          <nav aria-label="Legal">
            <h2 className="text-xs text-heading">Legal</h2>
            <ul className="mt-3">
              {policy.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={legalPath(p.slug)}
                    className="flex min-h-12 items-center underline"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
              <li className="flex min-h-12 items-center">
                <CookieSettingsLink />
              </li>
            </ul>
          </nav>
        </div>

        {/* 4. Звідки дані. ODbL вимагає атрибуції там, де дані
             показують, тож вона в підвалі кожної сторінки. */}
        <div
          data-testid="footer-data"
          className="mt-8 grid gap-4 border-t border-line-2 pt-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
        >
          <div>
            <h2 className="text-xs text-heading">Where the data comes from</h2>
            <Block as="p" measure="read" className="mt-3">
              Campsite data ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                className="underline"
                rel="noopener"
              >
                OpenStreetMap contributors
              </a>
              , available under the{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/"
                className="underline"
                rel="noopener"
              >
                Open Database License
              </a>
              . Boundaries from Natural Earth. Elevation from the Copernicus
              DEM. Distances and terrain are calculated by CampTribe from that
              data.
            </Block>
          </div>
          <nav aria-label="Data and sources">
            <ul className="flex flex-wrap gap-x-6 md:flex-col">
              {dataPages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={legalPath(p.slug)}
                    className="flex min-h-12 items-center underline"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* 5. Фото-смуга: декоративна, назва вже є в колонці й у шапці. */}
        <p aria-hidden="true" data-testid="footer-wordmark" className="ct-wordmark mt-8">
          CampTribe
        </p>

        {/* 🔴 НИЗ: НАЗВА, РІК, ПРАВА, МОВА, «ДОГОРИ».
            Рішення власника 20.10.2026: адреса й номер підприємства
            публікуються на правових сторінках, а не під кожною
            сторінкою сайту. Обовʼязок — опублікувати; показувати осідок
            під кожною фотографією обовʼязком не є, а осідок це його дім.

            Рік рахує `CurrentYear` у браузері, а не розмітка на збірці —
            чому саме так, пояснено в тому компоненті. */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line-2 pt-6">
          <p>
            © <CurrentYear fallback={new Date().getFullYear()} />.{" "}
            {COMPANY.name}. All rights reserved.
          </p>
          <LanguageSwitch locales={locales} variant="footer" />
          {/* 🔴 «ДОГОРИ» — ЗВИЧАЙНЕ ПОСИЛАННЯ НА ЯКІР, А НЕ КНОПКА З JS.
              Підвал опиняється під читачем після довгої сторінки, і
              найдешевший спосіб повернути його вгору не повинен залежати
              від того, чи доїхав скрипт. `#top` стоїть на `<body>`
              макета.

              🔴 ПЛАВНОСТІ НЕ ДОДАЄМО НАВМИСНО. `scroll-behavior: smooth`
              на `html` — правило сайту, не цього посилання: воно зачепило б
              і решту якорів, і повносторінкові знімки, які Playwright
              робить прокручуванням. Стрибок угору миттєвий і цим чесний. */}
          <a
            href="#top"
            data-testid="to-top"
            className="flex min-h-12 items-center gap-2 underline"
          >
            Back to top
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
