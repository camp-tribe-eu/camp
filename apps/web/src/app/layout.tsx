import type { Metadata } from "next";
import "./globals.css";
import { isPublic } from "@/lib/environment";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { footerNav, headerNav } from "@/lib/navigation";
import { siteSettings } from "@/lib/site-settings";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import CookieConsent from "@/components/cookie-consent";
import ErrorReporter from "@/components/error-reporter";
import { BOOTSTRAP } from "@/lib/error-bootstrap";
import { THEME_BOOTSTRAP } from "@/lib/theme-bootstrap";
import { BRAND_TITLE } from "@/lib/brand";

// Canonical domain from Facts/project-identity.md in the Camping brain.
// Overridable via env so staging/preview deploys don't claim the production URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

/**
 * 🔴 МЕТАДАНІ СТАЛИ АСИНХРОННИМИ — CAMP-481.
 *
 * Опис сайту був рядком у коді (`BRAND_DESCRIPTION`) і стояв у трьох
 * місцях голови документа. Власник не міг його змінити. Тепер він
 * приходить із CMS, тому статичного `metadata` замало: Next дозволяє
 * асинхронність лише через `generateMetadata`.
 *
 * Ціна заміряна й невелика: один запит, кешований на ту саму витримку,
 * що й меню, яке макет і так тягне.
 *
 * 🔴 НЕМАЄ ПІДПИСУ — НЕМАЄ ПОЛЯ `description`, а не порожній рядок.
 * `<meta name="description" content="">` гірший за відсутній тег: він
 * стверджує, що опису немає, замість промовчати.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { tagline } = await siteSettings();
  const description = tagline ?? undefined;
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: BRAND_TITLE,
      template: "%s | CampTribe",
    },
    description,
    // CAMP-90. Site-wide, from the one flag. A page may still narrow this
    // further (a thin hub, a campsite OSM has dropped) — it can never
    // widen it, because Next merges child metadata over the root and the
    // children only ever say noindex.
    robots: isPublic
      ? { index: true, follow: true, googleBot: { index: true, follow: true } }
      : {
          index: false,
          follow: false,
          googleBot: { index: false, follow: false },
        },
    openGraph: {
      type: "website",
      siteName: "CampTribe",
      title: BRAND_TITLE,
      description,
      url: siteUrl,
    },
    twitter: {
      card: "summary_large_image",
      title: BRAND_TITLE,
      description,
    },
  };
}

// 🔴 CAMP-365: МАКЕТ — ЄДИНЕ МІСЦЕ, ЯКЕ ХОДИТЬ ПО МЕНЮ.
//
// Шапка одна на весь сайт, тож і запит один: `headerNav()` кешується на
// 60 секунд (`NAV_REVALIDATE_SECONDS`), і скільки б сторінок не
// віддавалось, у базу йде один запит на хвилину. Якби по дані ходила
// сама шапка, вона перестала б бути чистою, і юніт-тест не намалював би
// її без мережі.
//
// 🔴 ЗАПАСНОГО МЕНЮ В КОДІ НЕМАЄ: `headerNav()` кидає, якщо база
// недосяжна або пунктів нема. Збірка тоді падає гучно замість викласти
// сайт без навігації, а на живому сервері Next лишає попередню справну
// сторінку — читач бачить старе меню, не порожнє.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Один запис кешу на обидва: та сама адреса й ті самі параметри.
  // Один запит на налаштування поруч із двома на меню: усі троє живуть
  // у кореневому макеті, тож ходити по них послідовно означало б додати
  // їхні затримки одна до одної на КОЖНІЙ сторінці сайту.
  const [nav, footerLinks, settings] = await Promise.all([
    headerNav(),
    footerNav(),
    siteSettings(),
  ]);
  // 🔴 CAMP-40: the language comes from the registry, not from a string
  // written here. This attribute and the `hreflang` on every page have to
  // agree about what language the document is in, and two hand-written
  // copies of that fact are two chances to disagree — silently, because
  // nothing validates it.
  return (
    <html lang={DEFAULT_LOCALE}>
      <head>
        {/* CAMP-88: only the `latin` cuts are preloaded — every visitor needs
            them, so waiting for the CSS to be parsed first costs visible text
            delay. `latin-ext` is deliberately not preloaded: most readers
            never need ą, ř or ț, and preloading it would download 49 KB that
            most of them throw away. */}
        <link
          rel="preload"
          href="/fonts/archivo-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/archivo-narrow-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* CAMP-92. The error listeners, installed before anything else
            can run. They used to be attached in a React effect, which
            runs after hydration — CI proved that too late: a hydration
            mismatch or a chunk that 404s throws before any effect, and
            those are the failures most likely to leave a blank page.
            This queues; components/error-reporter.tsx decides and sends,
            so the privacy rules exist in one language only. */}
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
        {/* 🔴 ВИБІР ТЕМИ СТАВИТЬСЯ ДО ПЕРШОГО МАЛЮВАННЯ (CAMP-448).
            React поставив би атрибут після гідратації — тобто читач,
            який обрав темну тему, встиг би побачити білу сторінку.
            Скрипт синхронний і крихітний; він нічого не вирішує сам,
            лише переносить збережений вибір на `<html>`. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      {/* 🔴 `id="top"` — ціль посилання «Back to top» у підвалі (CAMP-448).
          Якір, а не кнопка з JS: підвал опиняється під читачем після
          довгої сторінки, і найдешевший спосіб повернутись угору не
          повинен залежати від того, чи доїхав скрипт. */}
      <body id="top" className="flex min-h-screen flex-col antialiased">
        {/* Drains what the head script caught. Renders null. */}
        <ErrorReporter />
        <SiteHeader nav={nav} />
        <div className="flex-1">{children}</div>
        <SiteFooter nav={footerLinks} footerNote={settings.footerNote} />
        {/* 🔴 Last in the document, and it blocks nothing above it. The
            banner must never be a gate: a reader who ignores it keeps the
            whole site, which is what makes any consent given freely
            given. */}
        <CookieConsent />
      </body>
    </html>
  );
}
