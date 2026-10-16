import Link from 'next/link';
import type { ReactNode } from 'react';
import { Shell } from '@/components/account-view';
import type { Profile } from '@/lib/cabinet';

// CAMP-229 — що малює кабінет `/account`: профіль і три розділи.
//
// 🔴 Лише розмітка, як і account-view.tsx: жодного стану, запиту чи `fetch`.
// Функції беруть значення й повертають HTML, тож їх читають на ВИДАНОМУ HTML
// (tests/unit/account-cabinet.spec.tsx), а не на константі, класі чи
// `data-testid`. Стан, мережа й перехід на /login — в account-cabinet.tsx.
//
// 🔴 ТРИ РОЗДІЛИ — ПОРОЖНІ, І ЦЕ НЕ ЗАГЛУШКИ. Макет (Design/07-account.html,
// «ПОРОЖНІ СТАНИ — перше, що бачить кожен новий акаунт»): порожній екран — це
// «не помилка, а найдешевше місце для запрошення до дії». Даних для маршрутів,
// збережених кемпінгів і фото ще немає (картки CAMP-227 і далі), тож усі три
// стани показуються ЗАВЖДИ, і саме вони тут — готовий дизайн.
//
// 🔴 ТЕКСТ — ПЕРЕКЛАД РЯДКІВ МАКЕТА, А НЕ НОВІ РЯДКИ. Мова сайту — англійська
// (`<html lang="en">`, шрифт Archivo без кирилиці, CAMP-228 §6.6 у
// docs/design-audit.md), макет — українською; цей розріз уже раз вирішено на
// користь мови сайту. Кожен рядок нижче має над собою оригінал макета — щоб
// звірка була очима, а не памʼяттю, і щоб мову можна було змінити в одному
// місці. Таблиця відповідностей — docs/design-audit.md §6.7.
//
// 🔴 КНОПКА Є, ЛИШЕ ЯКЩО Є КУДИ ВЕСТИ. «Додати фото» (макет, третя картка) тут
// не намальована: завантаження фото ще не існує, і кнопка без дії — це
// обіцянка, яку сторінка не виконує. Так само шапка сайту (site-chrome.tsx)
// перелічує лише наявні сторінки. Повернеться разом із завантаженням.

export const CABINET_TITLE = 'Your account';

export type EmptyState = {
  id: 'routes' | 'saved' | 'photos';
  icon: string;
  title: string;
  body: string;
  actions: readonly { label: string; href: string; primary: boolean }[];
};

/**
 * Три порожні стани, у порядку макета. Експортовано, щоб тест і e2e читали
 * рівно те, що малює компонент, і щоб адреси кнопок перевірялись на сторінки,
 * які справді відкриваються.
 */
export const EMPTY_STATES: readonly EmptyState[] = [
  {
    id: 'routes',
    icon: '🗺',
    // макет: «Маршрутів поки немає»
    title: 'No routes yet',
    // макет: «Складіть свій у Trip Planner — або візьміть готовий і змініть під себе.»
    body: 'Build your own in the Trip Planner — or take a ready-made one and change it to suit you.',
    actions: [
      // макет: «У Trip Planner»
      { label: 'Open the Trip Planner', href: '/plan', primary: true },
      // макет: «Готові маршрути»
      { label: 'Ready-made routes', href: '/routes', primary: false },
    ],
  },
  {
    id: 'saved',
    icon: '⛺',
    // макет: «Ще нічого не збережено»
    title: 'Nothing saved yet',
    // макет: «Сердечко на будь-якому кемпінгу — і він тут. Список синхронізується між пристроями.»
    body: 'A heart on any campsite and it lands here. The list syncs between your devices.',
    actions: [
      // макет: «Відкрити мапу»
      { label: 'Open the map', href: '/map', primary: true },
    ],
  },
  {
    id: 'photos',
    icon: '📷',
    // макет: «Ви ще не надсилали фото»
    title: "You haven't sent any photos yet",
    // макет: «Були в кемпінгу, якого немає на фото? Ваш знімок побачать тисячі людей — із вашим імʼям у підписі.»
    body: 'Been to a campsite we have no photo of? Thousands of people will see your shot — with your name in the credit.',
    // макет: кнопка «Додати фото» — свідомо немає, див. вище.
    actions: [],
  },
];

const CARD = 'rounded-card border border-line-2 bg-surface';
// 🔴 Основна кнопка — `bg-btn`, темна, як `btn-p` у макеті й як у решті сайту
// (сторінка кемпінгу, калькулятор); другорядна — біла з рамкою, як `btn-s`.
// Форми входу й реєстрації (CAMP-228) стоять на світлішій `accent-surface`;
// це інша роль — поле форми, а не заклик до дії на порожньому екрані.
// Висота 44 px: це ціль для пальця на 375 px, якої макет (`btn-sm`) не мав.
const BUTTON = 'inline-flex h-11 items-center rounded-sm px-4 text-sm font-semibold';
const PRIMARY = `${BUTTON} bg-btn text-btn-ink transition-colors hover:bg-btn-hover`;
const SECONDARY = `${BUTTON} border border-line-2 bg-surface text-heading hover:border-line-blue`;

function EmptyCard({ state }: { state: EmptyState }) {
  const heading = `empty-${state.id}`;
  return (
    <section aria-labelledby={heading} className={`${CARD} px-4 py-[22px]`}>
      <div className="mx-auto max-w-[340px] text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-full border border-line-2 bg-surface-2 text-xl"
        >
          {state.icon}
        </div>
        <h2 id={heading} className="mb-1.5 text-base font-semibold text-heading">
          {state.title}
        </h2>
        <p className="text-[13px] leading-[1.55] text-ink-2">{state.body}</p>
        {state.actions.length > 0 && (
          <div className="mt-3.5 flex flex-wrap justify-center gap-2">
            {state.actions.map((a) => (
              <Link key={a.href} href={a.href} className={a.primary ? PRIMARY : SECONDARY}>
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Профіль і три розділи. Усі три порожні — даних поки немає. */
export function CabinetView({ profile }: { profile: Profile }) {
  return (
    <Shell title={CABINET_TITLE}>
      <section aria-labelledby="profile-name" className={`${CARD} mt-6 px-4 py-4 md:px-5`}>
        {/* Імʼя, а коли його немає, — адреса. Не вигадане «Hello, user». */}
        <h2 id="profile-name" className="break-all text-[19px] font-semibold text-heading">
          {profile.displayName ?? profile.email}
        </h2>
        {profile.displayName !== null && (
          <p className="mt-0.5 break-all text-sm text-ink-2">{profile.email}</p>
        )}
        <p className="mt-1 text-sm text-ink-2">
          {profile.emailVerified ? 'Email confirmed' : 'Email not confirmed yet'}
        </p>
      </section>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {EMPTY_STATES.map((s) => (
          <EmptyCard key={s.id} state={s} />
        ))}
      </div>
      {/* CAMP-229 (3/3): вхід у вивантаження й видалення. Це `<nav>`, а не `<section>`:
          розділи кабінету — три порожні стани, і тести читають саме їх. */}
      <nav aria-label="Your data" className="mt-6 text-sm">
        <Link className="underline" href="/account/data">
          Your data — download a copy, or delete your account
        </Link>
      </nav>
    </Shell>
  );
}

// ── Стани до профілю ────────────────────────────────────────────────────

/** Поки відповіді немає. Це й те, що лежить у виданому HTML до гідратації. */
export function CheckingView({ title = CABINET_TITLE }: { title?: string }) {
  return (
    <Shell title={title}>
      <p role="status" className="mt-4 text-ink-2">
        Checking your sign-in…
      </p>
    </Shell>
  );
}

/** Сервер сказав «ви не ввійшли»; сторінка веде на /login, а посилання — про всяк випадок. */
export function SignedOutView({ title = CABINET_TITLE }: { title?: string }) {
  return (
    <Shell title={title}>
      <p role="status" className="mt-4 text-ink-2">
        You are not signed in. Taking you to the sign-in page…{' '}
        <Link className="underline" href="/login">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

/** Не вдалось дізнатись, хто це. Сесію НЕ скинуто: це не відмова сервера, а збій. */
export function CabinetErrorView({
  kind,
  onRetry,
  title = CABINET_TITLE,
}: {
  kind: 'unavailable' | 'failed';
  onRetry: () => void;
  title?: string;
}): ReactNode {
  return (
    <Shell title={title}>
      <div
        role="alert"
        className="mt-4 max-w-md rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink"
      >
        <p>
          <span className="font-semibold">Error:</span>{' '}
          {kind === 'unavailable'
            ? 'Accounts are not available right now.'
            : 'We could not load your account. Nothing was changed — try again.'}
        </p>
      </div>
      {kind === 'failed' && (
        <button type="button" onClick={onRetry} className={`${PRIMARY} mt-4`}>
          Try again
        </button>
      )}
    </Shell>
  );
}
