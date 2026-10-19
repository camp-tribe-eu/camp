import Link from 'next/link';
import { Shell } from '@/components/account-view';
import {
  DELETION_WINDOW_DAYS,
  EXPORT_HOURS,
  formatWhen,
  type ArchiveState,
} from '@/lib/rights';
import { Button, ButtonLink } from '@/components/button';

// CAMP-229 (3/3) — що малює сторінка «Ваші дані»: вивантаження (ст. 15 і 20) і
// вхід у видалення (ст. 17).
//
// 🔴 Лише розмітка, як і решта екранів акаунта: жодного стану, запиту чи `fetch`.
// Функції беруть значення й повертають HTML, тож їх читають на ВИДАНОМУ HTML
// (tests/unit/account-data.spec.tsx), а не на константі, класі чи `data-testid`.
//
// 🔴 ТЕКСТ — ПЕРЕКЛАД МАКЕТА, А НЕ НОВІ РЯДКИ (Design/07-account.html, екран
// «/account/settings», рядки «Завантажити мої дані» й «Видалити акаунт», блок
// «Стан „архів готується“»). Мова сайту — англійська; таблиця відповідностей і
// те, що з макета свідомо НЕ взято — docs/design-audit.md §6.8.
//
// 🔴 ЧОГО ТУТ НЕМАЄ, і чому:
//   · «Посилання прийде на пошту» — немає. Листа з архівом ми не шлемо (пошту ще
//     не підключено, CAMP-110), тож сторінка не обіцяє того, чого не виконає.
//     Архів лежить тут, на цій сторінці, і готовий — по цьому ж запису.
//   · «ZIP … ваші фото в оригіналі» — немає. Завантаження фото ще не існує, тож
//     оригіналів нема; файл — один JSON, який читає і людина, і програма.
//   · «зазвичай хвилина-дві» — немає. Ми цього не вимірювали, і сторінка не
//     стверджує тривалості, якої не бачить.

export const DATA_TITLE = 'Your data';

/** Що пішло не так при завантаженні готового файлу, або `null`. */
export type DownloadProblem = 'gone' | 'failed' | 'throttled' | null;

const CARD = 'rounded-card border border-line-2 bg-surface';
const LEGAL = 'text-xs font-semibold uppercase tracking-wide text-ink-2';

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-2 border-t-line-blue"
    />
  );
}

function problemText(p: Exclude<DownloadProblem, null>): string {
  switch (p) {
    case 'gone':
      return 'That archive is no longer available. Prepare a new one.';
    case 'throttled':
      return 'Too many requests from this connection. Try again in a few minutes.';
    case 'failed':
      return 'We could not download the file. Nothing was changed — try again.';
  }
}

/** Блок вивантаження: у кожному стані архіву — своє, і жодного вигаданого. */
function ExportBlock({
  archive,
  busy,
  ready,
  problem,
  onPrepare,
  onDownload,
  onRetry,
}: {
  archive: ArchiveState;
  busy: boolean;
  ready: boolean;
  problem: DownloadProblem;
  onPrepare: () => void;
  onDownload: () => void;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="export-heading" className={`${CARD} mt-6 px-4 py-4 md:px-5`}>
      {/* макет: «GDPR · стаття 15 і 20» */}
      <p className={LEGAL}>GDPR · Articles 15 and 20</p>
      {/* макет: «Завантажити мої дані» */}
      <h2 id="export-heading" className="mt-1 text-base font-semibold text-heading">
        Download my data
      </h2>
      {/* макет: «ZIP: профіль, маршрути, збережені кемпінги, ваші фото в оригіналі й історія
          модерації — JSON, який читає і людина, і машина.» — без ZIP і без оригіналів,
          див. шапку файлу. */}
      <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
        One JSON file that both a person and a program can read: your profile, your routes, the
        records of your photos and reviews, and their moderation history.
      </p>

      {archive.kind === 'checking' && (
        <p role="status" className="mt-3 text-sm text-ink-2">
          Checking…
        </p>
      )}

      {archive.kind === 'unavailable' && (
        <div
          role="alert"
          className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink"
        >
          <span className="font-semibold">Error:</span> Accounts are not available right now.
        </div>
      )}

      {archive.kind === 'none' && (
        <Button
          variant="primary"
          type="button"
          className="mt-3.5"
          disabled={busy || !ready}
          onClick={onPrepare}
        >
          {/* макет: «Підготувати архів» */}
          Prepare my archive
        </Button>
      )}

      {archive.kind === 'preparing' && (
        <>
          {/* макет: «Збираємо ваш архів — зазвичай хвилина-дві» — без обіцянки строку */}
          <p role="status" className="mt-3.5 inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
            <Spinner /> Preparing your archive…
          </p>
          {/* макет: «Можете закрити сторінку: посилання прийде на пошту. …» — листа немає,
              але й правда інша: архів готується на нашому боці й чекатиме тут. */}
          <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-2">
            This page updates by itself. You can leave it: the archive keeps being prepared on our
            side and will be here when you come back. The law gives us a month for this (Article
            12(3) GDPR); we do it straight away — which is why this is a button and not a letter to
            support.
          </p>
        </>
      )}

      {archive.kind === 'ready' && (
        <>
          <p role="status" className="mt-3 text-sm text-ink">
            Your archive is ready. You can download it until{' '}
            <b className="font-semibold text-heading">{formatWhen(archive.expiresAt)}</b> ({EXPORT_HOURS}{' '}
            hours after it was prepared); after that it is deleted.
          </p>
          <Button
            variant="primary"
            type="button"
            className="mt-3.5"
            disabled={busy || !ready}
            onClick={onDownload}
          >
            Download (JSON)
          </Button>
        </>
      )}

      {archive.kind === 'unreachable' && (
        <>
          <div
            role="alert"
            className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink"
          >
            <span className="font-semibold">Error:</span> We could not check on your archive.
            Nothing was changed — try again.
          </div>
          <Button
            variant="primary"
            type="button"
            className="mt-3.5"
            disabled={busy || !ready}
            onClick={onRetry}
          >
            Try again
          </Button>
        </>
      )}

      {archive.kind === 'failed' && (
        <>
          <div
            role="alert"
            className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink"
          >
            <span className="font-semibold">Error:</span> We could not prepare your archive. Nothing
            was changed — try again.
          </div>
          <Button
            variant="primary"
            type="button"
            className="mt-3.5"
            disabled={busy || !ready}
            onClick={onPrepare}
          >
            Try again
          </Button>
        </>
      )}

      {problem !== null && (
        <div
          role="alert"
          className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink"
        >
          <span className="font-semibold">Error:</span> {problemText(problem)}
        </div>
      )}
    </section>
  );
}

/** Сторінка «Ваші дані»: вивантаження й вхід у видалення. */
export function DataView({
  archive,
  busy,
  ready,
  problem,
  onPrepare,
  onDownload,
  onRetry,
}: {
  archive: ArchiveState;
  busy: boolean;
  ready: boolean;
  problem: DownloadProblem;
  onPrepare: () => void;
  onDownload: () => void;
  onRetry: () => void;
}) {
  return (
    <Shell title={DATA_TITLE}>
      <ExportBlock
        archive={archive}
        busy={busy}
        ready={ready}
        problem={problem}
        onPrepare={onPrepare}
        onDownload={onDownload}
        onRetry={onRetry}
      />

      <section aria-labelledby="delete-heading" className={`${CARD} mt-4 px-4 py-4 md:px-5`}>
        {/* макет: «GDPR · стаття 17» */}
        <p className={LEGAL}>GDPR · Article 17</p>
        {/* макет: «Видалити акаунт» */}
        <h2 id="delete-heading" className="mt-1 text-base font-semibold text-heading">
          Delete my account
        </h2>
        {/* макет: «Назавжди. Перед цим ми покажемо, що саме зникне, а що за законом і за виданою
            ліцензією лишиться.» — «назавжди» уточнено вікном: воно й так на наступному екрані. */}
        <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
          Permanently — after a {DELETION_WINDOW_DAYS}-day window in which you can change your mind.
          Before you confirm, we show what disappears and what stays, by law and because of the
          licence you gave on photos.
        </p>
        <ButtonLink
          href="/account/delete"
          variant="danger-soft"
          className="mt-3.5"
        >
          Delete account…
        </ButtonLink>
      </section>

      <p className="mt-6 text-sm">
        <Link className="underline" href="/account">
          Back to your account
        </Link>
      </p>
    </Shell>
  );
}
