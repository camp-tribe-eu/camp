import Link from "next/link";
import { SiteNavDrawer } from "./site-nav-drawer";
import ThemeToggle from "./theme-toggle";
import PersonaToggle, { type PersonaLabels } from "./persona-toggle";
import { NavDropdown } from "./site-nav-dropdown";
import { SiteHeaderFrame } from "./site-header-frame";
import type { NavItem } from "@/lib/navigation";
import { LanguageSwitch } from "./language-switch";
import { liveLocales, type Locale } from "@/lib/i18n";

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
export function SiteHeader({
  nav,
  persona = null,
  locales = liveLocales(),
}: {
  nav: NavItem[];
  /** Підписи перемикача із CMS; `null` — перемикач не малюється. */
  persona?: PersonaLabels | null;
  /** Лише ЖИВІ мови (CAMP-448); порожньо — перемикача мови немає. */
  locales?: readonly Locale[];
}) {
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
       світлому тлі (пояснено в globals.css).

       🔴 CAMP-448 (2/2): ОСТРІВ. На прокручуванні шапка стискається в
       пігулку 480px по центру — і робиться це ВСЕРЕДИНІ `sticky`:
       `<header>` лишається в потоці тієї самої висоти, стискається
       внутрішній контейнер. Сам `<header>`, шар скла й ряд тепер малює
       `SiteHeaderFrame` (site-header-frame.tsx) — там числа теми, поріг
       і причини. Тут лишається вміст: лого, `<noscript>`, меню, шухляда.

       Дописано до CAMP-374 вище: тема на звичайних сторінках ТЕЖ
       `sticky` — `.header-section { position: var(--header-position) }`,
       а `--header-position: sticky` ставить header.liquid; `fixed` у неї
       лише варіант `--transparent` поверх героя, який і заміряли
       20.10.2026 на демо-сторі. Тобто острів у `sticky` — це її власна
       конструкція, а не компроміс. */
    <SiteHeaderFrame>
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
          є вікном. Шар і його класи — у `SiteHeaderFrame`; тут він
          згаданий, бо саме це правило забороняє класти скло на ряд. */}
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
      {/* 🔴 Ряд (`relative … min-h-[62px] …`) малює `SiteHeaderFrame`, і
          `relative` там обовʼязковий: шар скла позиційований, а
          позиційовані елементи малюються ПОВЕРХ непозиційованого
          вмісту. Без цього скло лягло б на самі пункти меню. */}
      {/* 🔴 В ОСТРОВІ ПІДПИС БІЛИЙ — це заміна логотипа теми: у стані
          `--stacked` вона ховає `.header__heading-logo` і показує
          `--transparent`-варіант (світлий на темному склі). Емодзі в
          бурштиновому колі лишається як є. */}
        <Link
          href="/"
          className="flex items-center gap-2 font-narrow text-[19px] font-bold text-heading group-data-[stacked=true]/header:text-[#fff]"
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
              // CAMP-448: без JS розкривач не відкриється, тож підпункти
              // стають у ряд поруч із батьком — як і сам ряд меню вище.
              "            header [data-nav-sub] { position: static !important; visibility: visible !important; opacity: 1 !important }\n" +
              // CAMP-448: мега-панель (країни) без JS не розгортаємо — у рядок
              // шапки вона не влізає й накрила б сторінку; посилання лишаються
              // в HTML, а країни без скрипта читач бере з плиток `/camping`.
              "            header [data-nav-kind='mega'] [data-nav-sub] { display: none !important }\n" +
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
        {/* 🔴 CAMP-448. ДІТИ ЧИТАЮТЬСЯ. До цього тут стояло
            `nav.map((item) => <Link>)` — і `item.children`, які API
            віддає, а тип оголошує, не читав ніхто. Підпункт, заведений у
            базі, не зʼявлявся без жодної помилки; саме так три готові
            сторінки прожили невидимими. Пункт із дітьми — розкривач
            (`site-nav-dropdown.tsx`), без дітей — звичайне посилання. */}
        {/* 🔴 CAMP-448 (2/2). В ОСТРОВІ ГОРИЗОНТАЛЬНОГО МЕНЮ НЕМАЄ І ВІД
            1200 px — там лого й бургер. Це тема, не моє: у `main.build.css`
            `.header .header__menu { display: none }`, і лише
            `@media (min-width:1200px) .header-section--top-position
            .header__menu { display: flex }`; десктопний бургер
            `.header__burger-menu-button--desktop` ховається тільки під
            `(max-width: 1199.98px)`. Десять пунктів у пігулку 480px і не
            влізли б. Підпункти в цьому стані читач дістає через шухляду,
            де діти стоять одразу (site-nav-drawer.tsx).

            `group-data-[stacked=true]/header:hidden` виграє в `xl:block`
            специфічністю (атрибут + клас проти класу), а не порядком. */}
        <nav
          aria-label="Main"
          className="ml-auto hidden xl:block group-data-[stacked=true]/header:hidden"
        >
          <ul className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm font-medium text-ink-2">
            {/* Лупа — ПОСЛІДНЯ в ряду, хоч у базі `sort` ставить її третьою:
                іконки живуть разом, праворуч, як у темі. Порядок решти —
                порядок бази. */}
            {[...nav].sort(
              (a, b) =>
                Number(a.href === SEARCH_HREF) - Number(b.href === SEARCH_HREF),
            ).map((item) =>
              item.children.length > 0 ? (
                <NavDropdown key={item.href} item={item} />
              ) : item.href === SEARCH_HREF ? (
                <li key={item.href}>
                  <SearchIconLink item={item} />
                </li>
              ) : (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-heading">
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>

        {/* 🔴 ПЕРЕМИКАЧ ТЕМИ — ПОРУЧ ІЗ БУРГЕРОМ, НА ВСІХ ШИРИНАХ
            (CAMP-448, пункт 3). Темна тема в нас описана з першого дня,
            але дотягнутись до неї міг лише той, у кого вона стоїть у
            системі. Кнопка віддає цей вибір читачеві й уміє повернути
            його системі назад. */}
        {persona && <PersonaToggle labels={persona} />}
        {/* 🔴 CAMP-448. МОВА Й ВХІД — ЛИШЕ ВІД 1200 px: нижче вони йдуть у
            шухляду (site-nav-drawer.tsx), бо ряд там і так тримає лого,
            перемикач теми й бургер. У острові мова ховається разом із
            рядом меню; вхід лишається — іконка без підпису, як у темі. */}
        <div className="hidden items-center xl:flex group-data-[stacked=true]/header:hidden">
          <LanguageSwitch locales={locales} />
        </div>
        <AccountLink className="hidden xl:grid" />
        <ThemeToggle />

        <SiteNavDrawer items={nav} persona={persona} locales={locales} />
    </SiteHeaderFrame>
  );
}

/**
 * 🔴 CAMP-448. ПОШУК — ІКОНКА, А НЕ СЛОВО. Пункт лишається рядком бази
 * (його підпис стає `aria-label`, тож читач екрана й тест читають те саме
 * «Search»), а малюється лупою: у темі іконки шапки без підписів, і слово
 * «Search» забирало ширину, якої десяти пунктам і так бракувало.
 * Адреса `/search` тут названа, бо вигляд — рішення шапки, а не бази:
 * знімеш пункт у CMS — зникне й лупа.
 */
export const SEARCH_HREF = "/search";

const ICON_BUTTON =
  "size-12 place-items-center rounded-full text-heading ct-button-motion hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue group-data-[stacked=true]/header:text-[#fff] group-data-[stacked=true]/header:hover:bg-transparent";

function SearchIconLink({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      title={item.label}
      data-testid="header-search"
      className={`${ICON_BUTTON} grid`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

/**
 * 🔴 CAMP-448. ВХІД — ІКОНКА «УВІЙТИ», А НЕ ЛЮДИНА. До цього в шапці входу
 * не було зовсім: іконку людини, яку ревю прийняло за вхід, малює перемикач
 * «маю кемпер / орендую». Друга людина поруч читалась би як дубль, тому
 * вхід — стрілка в двері. Веде на `/account`: кабінет сам відправляє непідписаного на
 * `/login` з поверненням (`account-cabinet.tsx`), а підписаному не треба
 * екрана входу.
 */
function AccountLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/account"
      aria-label="Account"
      title="Account"
      data-testid="header-account"
      className={`${ICON_BUTTON} ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M14.5 4.5h3.2A1.8 1.8 0 0 1 19.5 6.3v11.4a1.8 1.8 0 0 1-1.8 1.8h-3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.5 12h9M10.5 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

/** Підвал живе у власному файлі (CAMP-448); імпорт звідси лишається чинним. */
export { SiteFooter } from "./site-footer";
