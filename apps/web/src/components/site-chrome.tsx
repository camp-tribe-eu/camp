import Link from "next/link";
import { COMPANY, LEGAL_PAGES, legalPath } from "@/lib/legal";
import { CookieSettingsLink } from "./cookie-consent";
import { CurrentYear } from "./current-year";
import { SiteNavDrawer } from "./site-nav-drawer";
import type { NavItem } from "@/lib/navigation";

// CAMP-41: the header and footer every page wears.
//
// 🔴 CAMP-365: ПЕРЕЛІК ПУНКТІВ БІЛЬШЕ НЕ ЖИВЕ ТУТ.
//
// Доти в цьому файлі стояв масив `NAV`, і поруч — пояснення, чому в
// ньому лише ті сторінки, що вже існують: «список це дані, і сторінка
// приєднується до нього в день, коли виходить». Думка була правильна,
// а місце — ні. Щоб додати пункт, власникові треба було попросити мене
// змінити код.
//
// Тепер меню приходить із бази. Та властивість, заради якої масив і
// жив у коді — **мертве посилання в меню неможливе**, бо файл читає
// рецензія й CI, — переїздом губиться. Її відновлює сторож
// `tests/e2e/navigation.spec.ts`, який бере КОЖЕН пункт із бази й
// доводить, що той відкривається і що читач до нього дістанеться.
//
// 🔴 ШАПКА НЕ ХОДИТЬ ПО ДАНІ САМА, І ЦЕ НАВМИСНО. Вона отримує їх
// пропом, лишаючись чистою: тоді юніт-тест малює її без мережі й без
// бази, а єдине місце, яке знає про API, — макет. Запит там один на
// весь сайт, бо шапка одна.
export function SiteHeader({ nav }: { nav: NavItem[] }) {
  return (
    /* 🔴 CAMP-374 — `sticky`, А НЕ `fixed`, І ЦЕ СВІДОМО ІНАКШЕ, НІЖ У
       ТЕМІ.

       Демо-стор FUSE тримає шапку `fixed` (заміряно 20.10.2026:
       `position: fixed`, `z-index: 13`, десктоп `top: 48px`, мобайл
       `top: 0`, висота 89px). Там це виправдано: їхня шапка лежить над
       героєм і має бути прозорою поверх нього.

       У нас `fixed` купив би те саме — бургер завжди під рукою — але
       разом із пасткою, яку називає сама картка: фіксована шапка
       ВИХОДИТЬ ІЗ ПОТОКУ, тож перший елемент кожної сторінки сховався б
       під нею, і це довелося б компенсувати відступом на `body`,
       окремо на iOS через `env(safe-area-inset-top)`, і стежити, щоб
       компенсація не розʼїхалась із висотою шапки, яка на вузькому
       екрані переноситься в два рядки.

       `sticky top-0` дає ту саму властивість — читач будь-де має меню —
       і НЕ виходить із потоку: місце під шапку резервується саме,
       компенсувати нема чого, ламати нема чого. Висота може мінятись
       вільно.

       Скло — з теми: `.ct-glass` бере `blur(8px)` звідти, а
       непрозорість таку, за якої підпис лишається читабельним на
       світлому тлі (пояснено в globals.css). */
    <header
      data-testid="site-header"
      className="sticky top-0 border-b border-line-2"
      style={{ zIndex: "var(--layer-sticky)" }}
    >
      {/* 🔴 СКЛО — НА ОКРЕМОМУ ШАРІ, А НЕ НА САМІЙ `<header>`, І ЦЕ НЕ
          стиль, а виправлення регресії, яку я ж і завіз.

          `backdrop-filter` робить елемент КОНТЕЙНЕРОМ для нащадків із
          `position: fixed`. Шухляда меню — `fixed inset-0` усередині
          цієї шапки. Заміряно в браузері:

            без backdrop-filter → fixed-нащадок 1024×768 (усе вікно)
            з  backdrop-filter → fixed-нащадок 1024×64  (коробка шапки)

          Тобто затемнення й панель стискались у смужку 64 px, і клік по
          пункту меню не доходив. Упало в ТРЬОХ браузерах одразу, і
          зʼявилось лише тепер: доки скло не працювало в Chromium,
          контейнера не виникало.

          Шар лежить ПІД вмістом і НЕ містить шухляди, тож вікно знову
          є вікном. */}
      <div
        aria-hidden="true"
        data-testid="site-glass"
        className="ct-glass pointer-events-none absolute inset-0"
      />
      {/* 🔴 Wraps below `sm`, and the height grows with it.

          The fixed 62px row fitted three links by luck, not by design.
          Adding Guides (CAMP-66) pushed it 26px past a 375px screen and
          11px past an iPhone 14 — measured, and caught by the
          no-horizontal-scroll test rather than by anyone looking. The
          list above names four more links still to come, so this was
          going to happen regardless of which card added the fourth.

          Wrapping rather than hiding: a link a reader cannot see is a
          section that does not exist for them, and a horizontally
          scrolling nav with no affordance hides links just as
          effectively. Two short rows on a phone costs 30px and keeps
          every destination visible.

          ⚠️ This is the honest minimum, not a mobile header. Seven
          links will need a real one — that belongs to the design card
          CAMP-81, not here. From `sm` up nothing changes at all, so the
          visual baselines are untouched. */}
      {/* 🔴 `relative` обовʼязковий: шар скла позиційований, а
          позиційовані елементи малюються ПОВЕРХ непозиційованого
          вмісту. Без цього скло лягло б на самі пункти меню. */}
      <div className="relative mx-auto flex min-h-[62px] max-w-wrap flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:h-[62px] sm:flex-nowrap sm:py-0 xl:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-narrow text-[19px] font-bold text-heading"
        >
          <span
            aria-hidden="true"
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-amber text-[13px]"
          >
            ⛺
          </span>
          CampTribe
        </Link>

        {/* 🔴 ВІД 1200 px І ВИЩЕ — горизонтальне меню; нижче його немає
            зовсім, там працює шухляда. Межа взята з архіву теми, де
            `.header__burger-menu-button--desktop` живе під
            `(max-width: 1199.98px)`, а `--mobile` під
            `(min-width: 1200px)`. У нас це `--breakpoint-xl`.

            Коментар вище казав: «⚠️ This is the honest minimum, not a
            mobile header. Seven links will need a real one». Саме це й
            відбувається — CAMP-350. */}
        {/* 🔴 БЕЗ JS НИЖЧЕ 1200 px НАВІГАЦІЯ БУЛА НЕДОСЯЖНА — знайдено
            рецензією. Посилання лишаються в HTML (тож пошуковик їх
            бачить і ходить ними), але `display: none` ховає їх від
            людини, а кнопка бургера без скрипта нічого не відкриває.

            `<noscript>` повертає горизонтальне меню на всіх ширинах і
            прибирає кнопку, яка однаково не працює. Два рядки замість
            «ну, без JS сайт і так не той»: шість посилань — це вся
            навігація, а не прикраса. */}
        {/* 🔴 ЧОМУ `dangerouslySetInnerHTML`, А НЕ `<style>` ДИТИНОЮ.
            CAMP-383. Коли скрипт УВІМКНЕНО, браузер розбирає вміст
            `<noscript>` як ОДИН ТЕКСТОВИЙ ВУЗОЛ, а не як розмітку.
            Заміряно на живій сторінці, однаково в firefox і chromium:

              childElementCount 0, childNodes.length 1, nodeType 3,
              а текст цього вузла — літеральний рядок «<style>…</style>»

            React же віддавав там ЕЛЕМЕНТ. Два різні дерева в одному
            місці — і це рівно та розбіжність, яку він звітує як
            помилку #418 «server rendered HTML didn't match the client».
            Вона мигтіла в CI на /login, /plan, /routes/…, /account і
            /camping — тобто на кожній сторінці, бо каркас спільний.

            Доказ зняв свідок із цієї ж картки: у серверному HTML
            `<noscript><style>…</style></noscript>` є, у DOM після
            гідратації його немає.

            Рядком React віддає те саме, що бачить браузер, і дерева
            збігаються. Вміст CSS НЕ змінився — отже поведінка без JS
            та сама. */}
        <noscript
          dangerouslySetInnerHTML={{
            __html:
              "<style>\n" +
              "            header nav[aria-label='Main'] { display: block !important }\n" +
              "            header [data-testid='burger-open'] { display: none !important }\n" +
              "          </style>",
          }}
        />

        {/* 🔴 `flex-wrap` ТУТ НЕ ПРИКРАСА, А ЄДИНЕ, ЩО ТРИМАЄ МЕНЮ БЕЗ JS.
            Нижче `xl` цей ряд схований — але `<noscript>` вище повертає
            його НА ВСІХ ширинах, бо без JS кнопка бургера не працює.
            Тобто на телефоні без JS тут малюється весь перелік.

            Заміряно 26.10.2026 на знімку падіння з CI (mobile-chrome,
            ≈360 px CSS, `javaScriptEnabled: false` — hubs.spec.ts:66):
            без переносу десять пунктів ішли за правий край, останнім
            видимим був «Tools», а решта не діставалась ніяк. Із шістьма
            пунктами воно вміщалось, тож дефект спав, поки ця картка не
            додала чотири посилання.

            🔴 На `xl` і ширше перенос не змінює нічого: там увесь ряд
            однаково в один рядок. Ціна нуль — тому межі в `@media` тут
            немає. */}
        <nav aria-label="Main" className="ml-auto hidden xl:block">
          <ul className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm font-medium text-ink-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:text-heading">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <SiteNavDrawer items={nav} />
      </div>
    </header>
  );
}

/**
 * ODbL requires attribution wherever the data is shown, so it belongs in
 * the footer of every page rather than being repeated per template and
 * eventually forgotten on one of them.
 */
export function SiteFooter({ nav = [] }: { nav?: NavItem[] }) {
  return (
    <footer className="mt-16 border-t border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-8 text-xs text-ink-2 xl:px-6">
        {/* 🔴 РОЗДІЛ `footer` ІЗ CMS, І ДО СЬОГОДНІ ЙОГО НЕ МАЛЮВАВ НІХТО.
            Поле `location` у таблиці є, API віддає три розділи, а каркас
            споживав лише `header`. Тобто рядок із `location='footer'`
            можна було додати в базу й не отримати нічого — мовчки
            (CAMP-397, знайшов власник).

            🔴 Правові посилання нижче сюди НЕ переїжджають: вони
            будуються з `LEGAL_PAGES` навмисно (CAMP-56), щоб жодне
            обовʼязкове посилання не можна було випадково видалити з CMS. */}
        {nav.length > 0 && (
          <nav aria-label="More" className="mb-4">
            <ul className="flex flex-wrap items-center gap-x-4">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-12 items-center underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <p className="max-w-prose">
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
          . Boundaries from Natural Earth. Elevation from the Copernicus DEM.
          Distances and terrain are calculated by CampTribe from that data —{" "}
          <Link href="/legal/attribution" className="underline">
            full sources and licences
          </Link>
          .
        </p>

        {/* 🔴 CAMP-56: on every page, because that is where a reader
            looks for them and because the E-Commerce Directive expects
            the operator to be identifiable without hunting. Built from
            LEGAL_PAGES, so a page added to that list cannot be one the
            footer forgets. */}
        {/* 🔴 ЦЕ РЯД НАВІГАЦІЇ, А НЕ ТЕКСТ У РЕЧЕННІ, тож під правило
            48 px він підпадає. Заміряно 19.10.2026 на 375 px: усі
            дванадцять посилань підвалу були нижчі за 48, здебільшого
            13 px — тобто висота самого рядка тексту.

            Посилання всередині абзаців вище лишаються як були:
            «OpenStreetMap contributors» у реченні — це текст, і робити
            його 48 px заввишки було б неправильно.

            `gap-y-1` (4 px) замінено на `gap-y-0`, бо висота тепер у
            самих пунктах: при `min-h-12` і проміжку 4 px зони не
            перекриваються, але й зайвий відступ між рядками вже не
            потрібен. */}
        <nav aria-label="Legal" className="mt-2">
          <ul className="flex flex-wrap items-center gap-x-4">
            {LEGAL_PAGES.map((p) => (
              <li key={p.slug}>
                <Link
                  href={legalPath(p.slug)}
                  className="flex min-h-12 items-center underline"
                >
                  {p.title}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsLink />
            </li>
          </ul>
        </nav>

        {/* 🔴 У ПІДВАЛІ — НАЗВА, РІК І ПРАВА. БІЛЬШЕ НІЧОГО.
            Рішення власника 20.10.2026: адреса й номер підприємства
            публікуються, але на правових сторінках, а не під кожною
            сторінкою сайту. Обовʼязок — опублікувати; показувати осідок
            під кожною фотографією обовʼязком не є, а осідок це його дім.
            Посилання на правову інформацію стоїть рядком вище, тож шлях
            до даних короткий і очевидний.

            Рік рахує `CurrentYear` у браузері, а не розмітка на збірці —
            чому саме так, пояснено в тому компоненті. */}
        <p className="mt-4">
          {/* Рік збірки йде пропом і служить запасним значенням для
              читача без JS; справжній рік ставить браузер. Чому саме
              так — у самому компоненті, і це не стиль, а виправлений
              дефект. */}
          © <CurrentYear fallback={new Date().getFullYear()} />. {COMPANY.name}.
          All rights reserved.
        </p>
      </div>
    </footer>
  );
}
