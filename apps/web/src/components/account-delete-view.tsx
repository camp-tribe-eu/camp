import Link from 'next/link';
import { Shell } from '@/components/account-view';
import {
  DELETION_WINDOW_DAYS,
  PHOTO_CHOICES,
  canDelete,
  formatWhen,
  type DeleteDraft,
  type PhotoChoice,
} from '@/lib/rights';

// CAMP-229 (3/3) — екран видалення акаунта (ст. 17). Макет називає його «найчеснішим
// екраном на сайті» (Design/07-account.html, «ВИДАЛЕННЯ АКАУНТУ»).
//
// 🔴 ТРИ РІШЕННЯ КАРТКИ ЖИВУТЬ У ВИДИМОМУ ТЕКСТІ, А НЕ В КОМЕНТАРЯХ, і кожне має своє
// «чому» поруч, де його бачить людина:
//
//   1. «Що лишиться в будь-якому разі — і чому»: знеособлені записи модерації
//      (законний інтерес, ст. 17 п. 3) і ліцензія на вже опубліковані фото (договір).
//   2. «30 днів — це не спосіб потягнути час»: закон — без невиправданої затримки;
//      вікно коротке й потрібне для помилкового кліку; доступ припиняється одразу.
//   3. «Жоден варіант не вибрано заздалегідь»: доля фото не вибрана, ХОЧА нам
//      вигідний один із варіантів — Planet49, C-673/17, там, де це нам невигідно.
//
// `tests/unit/account-delete.spec.tsx` читає ВИДАНИЙ HTML і доводить кожне: і що
// текст є (з назвою підстави), і що жоден варіант не позначений.
//
// 🔴 `checked` СТОЇТЬ НА ВАРІАНТІ ЛИШЕ ТОДІ, КОЛИ ЛЮДИНА ЙОГО ОБРАЛА. `draft.photos` —
// `null` у початковому стані (lib/rights.ts, `EMPTY_DELETE`), тож ні один із двох
// `<input type="radio">` не отримує атрибута. Розмітка не має `defaultChecked`, а
// «обране за замовчуванням» не ховається ні в `selected`, ні в `aria-checked`.
//
// Текст — переклад макета; що з нього взято й що ні — docs/design-audit.md §6.8.

export const DELETE_TITLE = 'Delete your account';

const CARD = 'rounded-card border border-line-2 bg-surface';
const BUTTON = 'inline-flex h-11 items-center rounded-sm px-4 text-sm font-semibold';
const SECONDARY = `${BUTTON} border border-line-2 bg-surface text-heading hover:border-line-blue`;
const FIELD =
  'mt-1 w-full max-w-sm rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue';

/** Які слова бачить людина біля кожного з двох варіантів. Порядок — як у `PHOTO_CHOICES`. */
const PHOTO_OPTIONS: Record<PhotoChoice, { title: string; body: string }> = {
  // макет: «Видалити фото теж» — «2 знімки зникнуть зі сторінок кемпінгів протягом 24 годин.
  // Ті, що вже потрапили в кеш пошуковиків чи в соцмережі, ми відкликати не можемо — і не обіцяємо.»
  // Строк «24 години» не взято: ми не знаємо, коли сторінка кемпінгу буде зібрана наново.
  delete: {
    title: 'Delete the photos too',
    body: 'They are removed from our records straight away and come off the campsite pages when those pages are next updated. Copies that already reached search-engine caches or social networks we cannot recall — and we do not promise to.',
  },
  // макет: «Лишити фото, прибрати моє імʼя» — «Підпис стане «📷 Фото: спільнота, червень 2026».
  // Знімки далі допомагають людям вибирати кемпінг, але з вами вже нічим не повʼязані.»
  'keep-anonymous': {
    title: 'Keep the photos, remove my name',
    body: 'The credit becomes “Photo: community”. The photos keep helping people choose a campsite, but nothing links them to you any more.',
  },
};

function problemText(error: DeleteProblem): string {
  switch (error) {
    case 'wrong-password':
      return 'That password is not right. Nothing was deleted.';
    case 'throttled':
      return 'Too many attempts from this connection. Try again in a few minutes.';
    case 'unavailable':
      return 'Accounts are not available right now. Nothing was deleted.';
    case 'incomplete':
      return 'Choose what happens to your photos, enter your password and tick the box. Nothing was deleted.';
    case 'failed':
      return 'We could not complete that. Nothing was deleted — try again.';
  }
}

export type DeleteProblem =
  | 'wrong-password'
  | 'throttled'
  | 'unavailable'
  | 'incomplete'
  | 'failed';

/** Форма видалення. Усі три рішення картки — у цьому тексті. */
export function DeleteFormView({
  email,
  draft,
  error,
  busy,
  ready,
  onEdit,
  onSubmit,
}: {
  email: string;
  draft: DeleteDraft;
  error: DeleteProblem | null;
  busy: boolean;
  ready: boolean;
  onEdit: <K extends keyof DeleteDraft>(field: K, value: DeleteDraft[K]) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell title={DELETE_TITLE}>
      <form
        className={`${CARD} mt-6 max-w-2xl px-4 py-4 md:px-5`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canDelete(draft) && ready && !busy) onSubmit();
        }}
        noValidate
      >
        {/* макет: «Видалити акаунт Анни?» */}
        <h2 className="break-all text-lg font-semibold text-warn">Delete the account {email}?</h2>

        {/* макет: «Зникне: профіль, 3 маршрути, 12 збережених кемпінгів, налаштування. Публічний
            лінк «Альпи за 6 днів» перестане відкриватись…» — без цифр і без публічного лінку:
            ні джерела цифр, ні публічних лінків ще немає. */}
        <p className="mt-3 text-[13px] leading-[1.6] text-ink-2">
          <b className="font-semibold text-heading">Will disappear:</b> your profile, your routes and
          saved campsites, your settings, and any reviews you wrote.
        </p>

        {/* макет: «Що зробити з вашими опублікованими фото — оберіть, ми не вирішуємо за вас» */}
        <fieldset className="mt-4">
          <legend className="mb-2 block text-sm font-medium text-ink-2">
            What should happen to the photos you have published{' '}
            <b className="font-semibold text-warn">— choose, we do not decide for you</b>
          </legend>
          {PHOTO_CHOICES.map((value) => (
            <label
              key={value}
              className="mb-2 flex cursor-pointer items-start gap-2.5 rounded border border-line-2 px-3 py-3 has-[:checked]:border-line-blue has-[:checked]:bg-accent-surface"
            >
              <input
                type="radio"
                name="photos"
                value={value}
                checked={draft.photos === value}
                disabled={!ready || busy}
                onChange={() => onEdit('photos', value)}
                className="mt-1 h-4 w-4 flex-none"
              />
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold text-heading">
                  {PHOTO_OPTIONS[value].title}
                </b>
                <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">
                  {PHOTO_OPTIONS[value].body}
                </span>
              </span>
            </label>
          ))}
          <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">
            Your choice is applied straight away. Signing back in later restores your account — not
            the photos.
          </p>
        </fieldset>

        {/* 🔴 РІШЕННЯ 1. макет: «Що лишиться в будь-якому разі — і чому». */}
        <div className="mt-4 rounded border border-warn/40 bg-warn/5 p-3.5">
          <h3 className="text-sm font-semibold text-heading">What stays in any case — and why</h3>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-2">
            <b className="font-semibold text-heading">Anonymised moderation records</b> — that a photo
            or a review was rejected, why, when, and for which place, with nothing that could point
            back to you: no name, no address, not even a reference to the account. Because no part of
            that row identifies a person, it is not personal data any more, and the right to erasure
            has nothing left to reach. We keep it to be able to account for our own decisions — not
            to recognise anyone, which it could not do.
          </p>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-2">
            <b className="font-semibold text-heading">The licence on photos already published</b> is a
            contract, not personal data. So your name comes off whenever you ask, and the photo
            itself only if you chose the first option above.
          </p>
        </div>

        {/* макет: «Підтвердьте паролем» */}
        <label className="mt-4 block text-sm font-medium text-ink-2" htmlFor="delete-password">
          Confirm with your password
        </label>
        <input
          id="delete-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={draft.password}
          disabled={!ready || busy}
          onChange={(e) => onEdit('password', e.target.value)}
          className={FIELD}
        />

        {/* макет: «Розумію: 30 днів акаунт можна повернути простим входом, після цього — ні.»
            🔴 НЕ поставлена: `checked` — це `draft.understood`, а він `false`. */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="understood"
            checked={draft.understood}
            disabled={!ready || busy}
            onChange={(e) => onEdit('understood', e.target.checked)}
            className="mt-1 h-4 w-4 flex-none"
          />
          <span>
            I understand: for <b className="font-semibold">{DELETION_WINDOW_DAYS} days</b> the
            account can be brought back by simply signing in; after that it cannot.
          </span>
        </label>

        {error !== null && (
          <div
            role="alert"
            className="mt-4 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink"
          >
            <span className="font-semibold">Error:</span> {problemText(error)}
          </div>
        )}

        {!ready && (
          <p className="mt-3 text-sm text-ink-2">
            The form comes alive when the page finishes loading.
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/* макет: «Скасувати» */}
          <Link href="/account/data" className={SECONDARY}>
            Cancel
          </Link>
          {/* макет: «Видалити акаунт» — `btn-d off`: неактивна, доки людина не обрала сама. */}
          <button
            type="submit"
            disabled={!ready || busy || !canDelete(draft)}
            className={`${BUTTON} bg-warn text-white disabled:cursor-not-allowed disabled:border disabled:border-line-2 disabled:bg-surface-2 disabled:text-ink-3`}
          >
            Delete account
          </button>
        </div>
      </form>

      {/* 🔴 РІШЕННЯ 2. макет: «30 днів — це не спосіб потягнути час». */}
      <div className="mt-4 grid max-w-2xl gap-3">
        <section aria-labelledby="note-window" className={`${CARD} px-4 py-3.5`}>
          <h3 id="note-window" className="text-sm font-semibold text-heading">
            {DELETION_WINDOW_DAYS} days is not a way to stall
          </h3>
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-2">
            The law asks us to erase <b className="font-semibold">without undue delay</b>, and we do
            not allow ourselves a month’s pause. The window is short and is there for exactly one
            thing: a mistaken click, and a broken account. <b className="font-semibold">Access ends
            immediately.</b> The only way back is signing in with the same password. After{' '}
            {DELETION_WINDOW_DAYS} days the account and everything left in it is erased for good.
          </p>
        </section>

        {/* 🔴 РІШЕННЯ 3. макет: «Жоден варіант не вибрано заздалегідь». */}
        <section aria-labelledby="note-preselect" className={`${CARD} px-4 py-3.5`}>
          <h3 id="note-preselect" className="text-sm font-semibold text-heading">
            No option is chosen in advance
          </h3>
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-2">
            We would rather you kept the photos — which is exactly why choosing “keep” for you would
            be manipulation. The delete button stays off until you choose yourself. It is the same
            rule as the newsletter box when you signed up: an option ticked in advance is not a
            choice (CJEU, Planet49, C-673/17) — applied here where it costs us something.
          </p>
        </section>
      </div>
    </Shell>
  );
}

/** Після успіху: що сталося, до якої миті можна повернути, і що з фото вже не повернути. */
export function DeletedView({ restorableUntil }: { restorableUntil: string }) {
  return (
    <Shell title="Your account has been deleted">
      <div role="status" className={`${CARD} mt-6 max-w-2xl px-4 py-4 md:px-5`}>
        <p className="text-sm text-ink">
          Access ended just now and you have been signed out everywhere. Until{' '}
          <b className="font-semibold text-heading">{formatWhen(restorableUntil)}</b> you can bring
          the account back by signing in with the same password. After that everything left in it is
          erased for good.
        </p>
        <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">
          What we keep regardless is described on the previous screen. Your choice about photos has
          been applied and is not undone if you sign back in.
        </p>
        <p className="mt-3 text-sm">
          <Link className="underline" href="/">
            Back to the front page
          </Link>
        </p>
      </div>
    </Shell>
  );
}
