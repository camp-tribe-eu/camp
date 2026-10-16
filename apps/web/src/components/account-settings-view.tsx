import { Shell } from '@/components/account-view';

// CAMP-229 — розмітка сторінки налаштувань. Лише вигляд: що саме станеться,
// вирішує `lib/settings.ts`, а стан тримає `account-settings.tsx`.
//
// 🔴 ТРИ РОЗДІЛИ, А НЕ ЧОТИРИ. Картка називає ще «мову й одиниці». Їх тут
// немає навмисно: у продукті немає ні другої мови, ні настройки одиниць —
// жоден рядок коду такої величини не читає. Перемикач, який нічого не
// перемикає, — це обіцянка, яку інтерфейс дає, а продукт не виконує.

export const SETTINGS_TITLE = 'Settings';

const CARD = 'rounded-card border border-line-2 bg-surface px-4 py-4 md:px-5';
const BUTTON = 'rounded px-3.5 py-2 text-sm font-medium';
const PRIMARY = `${BUTTON} bg-btn text-btn-ink transition-colors hover:bg-btn-hover disabled:opacity-60`;
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface-2 px-3 py-2 text-sm text-heading';
const LABEL = 'mt-3 block text-sm font-medium text-ink-2';
const NOTE = 'mt-2 max-w-prose text-[13px] leading-[1.6] text-ink-2';

/** Повідомлення під формою: або спокійне, або помилка. */
export function Note({
  tone,
  children,
  id,
}: {
  tone: 'calm' | 'bad';
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <p
      id={id}
      // 🔴 Помилка — це `role="alert"`, спокійне повідомлення — ні.
      // Інакше читач екрана переб'є людину на кожне «готово».
      role={tone === 'bad' ? 'alert' : undefined}
      className={
        tone === 'bad'
          ? 'mt-2 max-w-prose rounded border border-warn/40 bg-warn/5 p-2.5 text-[13px] leading-[1.6] text-ink-2'
          : NOTE
      }
    >
      {children}
    </p>
  );
}

export type EmailSection = {
  current: string;
  verified: boolean;
  value: string;
  password: string;
  busy: boolean;
  note: { tone: 'calm' | 'bad'; text: string } | null;
  onEdit: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: () => void;
};

export function EmailCard(s: EmailSection) {
  return (
    <section aria-labelledby="set-email" className={`${CARD} mt-4`}>
      <h2 id="set-email" className="text-base font-semibold text-heading">
        Email
      </h2>
      <p className="mt-1 break-all text-sm text-ink-2">
        {s.current}
        {s.verified ? '' : ' — not confirmed yet'}
      </p>
      {/* 🔴 Сказано ДО дії, а не після: людина має знати, що лист піде на
          нову адресу і що доти нічого не зміниться. */}
      <p className={NOTE}>
        Changing this sends a letter to the new address. Nothing changes until
        you open the link in it, and everywhere you are signed in will be
        signed out when it does.
      </p>
      <label className={LABEL} htmlFor="set-email-new">
        New email
      </label>
      <input
        id="set-email-new"
        className={FIELD}
        type="email"
        autoComplete="email"
        value={s.value}
        onChange={(e) => s.onEdit(e.target.value)}
      />
      <label className={LABEL} htmlFor="set-email-password">
        Your password
      </label>
      <input
        id="set-email-password"
        className={FIELD}
        type="password"
        autoComplete="current-password"
        value={s.password}
        onChange={(e) => s.onPassword(e.target.value)}
      />
      <button
        className={`${PRIMARY} mt-3`}
        type="button"
        disabled={s.busy || s.value === '' || s.password === ''}
        onClick={s.onSubmit}
      >
        {s.busy ? 'Sending…' : 'Send the letter'}
      </button>
      {s.note && <Note tone={s.note.tone}>{s.note.text}</Note>}
    </section>
  );
}

export type PasswordSection = {
  current: string;
  next: string;
  busy: boolean;
  note: { tone: 'calm' | 'bad'; text: string } | null;
  onCurrent: (v: string) => void;
  onNext: (v: string) => void;
  onSubmit: () => void;
};

export function PasswordCard(s: PasswordSection) {
  return (
    <section aria-labelledby="set-password" className={`${CARD} mt-4`}>
      <h2 id="set-password" className="text-base font-semibold text-heading">
        Password
      </h2>
      <p className={NOTE}>
        Changing it signs out every browser you are signed in on, including
        this one — you stay on this page, with a new session. That is
        deliberate: the usual reason to change a password is that somebody
        else may have had it.
      </p>
      <label className={LABEL} htmlFor="set-password-current">
        Current password
      </label>
      <input
        id="set-password-current"
        className={FIELD}
        type="password"
        autoComplete="current-password"
        value={s.current}
        onChange={(e) => s.onCurrent(e.target.value)}
      />
      <label className={LABEL} htmlFor="set-password-new">
        New password
      </label>
      <input
        id="set-password-new"
        className={FIELD}
        type="password"
        autoComplete="new-password"
        value={s.next}
        onChange={(e) => s.onNext(e.target.value)}
      />
      <button
        className={`${PRIMARY} mt-3`}
        type="button"
        disabled={s.busy || s.current === '' || s.next === ''}
        onClick={s.onSubmit}
      >
        {s.busy ? 'Changing…' : 'Change password'}
      </button>
      {s.note && <Note tone={s.note.tone}>{s.note.text}</Note>}
    </section>
  );
}

export type LettersSection = {
  on: boolean;
  busy: boolean;
  note: { tone: 'calm' | 'bad'; text: string } | null;
  onToggle: (on: boolean) => void;
};

export function LettersCard(s: LettersSection) {
  return (
    <section aria-labelledby="set-letters" className={`${CARD} mt-4`}>
      <h2 id="set-letters" className="text-base font-semibold text-heading">
        Letters
      </h2>
      {/* 🔴 ГАЛОЧКА ПОРОЖНЯ, ПОКИ ЛЮДИНА САМА ЇЇ НЕ ПОСТАВИТЬ, і стан тут —
          той, що підтвердив сервер, а не той, на що натиснули. Згода, яку
          можна отримати неточним значенням, не є згодою (Planet49, C-673/17). */}
      <label className="mt-2 flex items-start gap-2.5 text-sm text-ink-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={s.on}
          disabled={s.busy}
          onChange={(e) => s.onToggle(e.target.checked)}
        />
        <span>
          Send me letters about new guides and features. Nothing about your
          account depends on this, and you can turn it off here at any time.
        </span>
      </label>
      {s.note && <Note tone={s.note.tone}>{s.note.text}</Note>}
    </section>
  );
}

/** Поки відповіді немає — і саме це лежить у виданому HTML до гідратації. */
export function SettingsLoadingView() {
  return (
    <Shell title={SETTINGS_TITLE}>
      <p className="mt-4 text-ink-2">Loading your settings…</p>
    </Shell>
  );
}

export function SettingsErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <Shell title={SETTINGS_TITLE}>
      <p className="mt-4 max-w-prose text-ink-2">
        We could not load your settings. Nothing has changed.
      </p>
      <button className={`${PRIMARY} mt-3`} type="button" onClick={onRetry}>
        Try again
      </button>
    </Shell>
  );
}

export function SettingsView({
  email,
  password,
  letters,
}: {
  email: EmailSection;
  password: PasswordSection;
  letters: LettersSection;
}) {
  return (
    <Shell title={SETTINGS_TITLE}>
      <EmailCard {...email} />
      <PasswordCard {...password} />
      <LettersCard {...letters} />
    </Shell>
  );
}
