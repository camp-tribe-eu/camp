import Link from 'next/link';
import {
  AMENITY_KEYS,
  AMENITY_LABEL,
  type AmenityKey,
  type AmenityValue,
  type Listing,
} from '@/lib/owner-listings';
import { Button } from '@/components/button';

// CAMP-51 / CAMP-86 — те, що малює сторінка «мої листинги».
//
// 🔴 Лише розмітка: ані стану, ані запитів. Перевіряється на виданому
// HTML, як account-view.tsx і claim-view.tsx.

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue';
const PANEL = 'mt-6 max-w-xl rounded-card border border-line-2 bg-surface-2 p-5';

export const LISTINGS_TITLE = 'Your campsite listings';

/**
 * Рядок під формою після спроби зберегти.
 *
 * `signIn` — адреса входу, коли сервер сказав «не ввійшов». Це
 * ПОСИЛАННЯ, а не перехід: редирект зняв би сторінку разом із
 * чернеткою, яку людина щойно набрала (CAMP-227, хвіст після #449).
 */
export type Note = { text: string; signIn?: string };

export function EmptyView() {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl text-ink">{LISTINGS_TITLE}</h1>
      <p className={HINT}>
        You have not confirmed a listing yet. Open the campsite you manage and
        use <strong>Claim the listing</strong> — we send a code to the email in
        its public OpenStreetMap tags.
      </p>
      <p className={HINT}>
        <Link className="underline" href="/camping">
          Find your campsite
        </Link>
      </p>
    </section>
  );
}

export function ListingForm({
  listing,
  name,
  amenities,
  busy,
  ready,
  dirty,
  message,
  onName,
  onAmenity,
  onSave,
}: {
  listing: Listing;
  name: string;
  amenities: Partial<Record<AmenityKey, AmenityValue>>;
  busy: boolean;
  ready: boolean;
  dirty: boolean;
  message: Note | null;
  onName: (v: string) => void;
  onAmenity: (k: AmenityKey, v: AmenityValue) => void;
  onSave: () => void;
}) {
  return (
    <section className={PANEL} data-testid={`listing-${listing.slug}`}>
      <h2 className="text-lg text-ink">
        {listing.name ?? listing.slug}
      </h2>
      {/* 🔴 СКАЗАНО, ЩО ПРАВКА ПЕРЕКРИВАЄ OSM, А НЕ ЗМІНЮЄ ЙОГО.
          Власник, що думає, ніби править OpenStreetMap, потім не розуміє,
          чому в інших застосунках усе по-старому. */}
      <p className={HINT}>
        What you put here is shown on the page instead of what
        OpenStreetMap says. It does not change OpenStreetMap, and our weekly
        import never overwrites it.
      </p>

      <label className={`${LABEL} mt-5`} htmlFor={`name-${listing.slug}`}>
        Name
      </label>
      <input
        id={`name-${listing.slug}`}
        className={FIELD}
        value={name}
        disabled={!ready || busy}
        onChange={(e) => onName(e.target.value)}
      />
      <p className={HINT}>
        Leave it empty to go back to what OpenStreetMap says
        {listing.name ? ` (${listing.name})` : ''}.
      </p>

      <fieldset className="mt-5" disabled={!ready || busy}>
        <legend className={LABEL}>What the site has</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {AMENITY_KEYS.map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink">{AMENITY_LABEL[k]}</span>
              <select
                className="rounded border border-line-2 bg-surface px-2 py-1 text-ink"
                value={amenities[k] ?? 'unknown'}
                data-testid={`amenity-${k}`}
                onChange={(e) => onAmenity(k, e.target.value as AmenityValue)}
              >
                {/* 🔴 «Not known» — повноцінний вибір, а не порожнеча.
                    Без нього єдиний спосіб зняти хибне «yes» — поставити
                    «no», тобто замінити одну неправду на іншу. */}
                <option value="unknown">Not known</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      {message && (
        <p className="mt-4 text-sm text-ink" role="alert">
          {message.text}
          {message.signIn && (
            <>
              {' '}
              Copy anything you typed, then{' '}
              <Link className="underline" href={message.signIn}>
                sign in
              </Link>{' '}
              — you will come back to this page.
            </>
          )}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={onSave} disabled={busy || !ready || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {/* 🔴 Посилання лише тоді, коли сторінка існує. Кемпінг без
            регіону її не має (CAMP-34), і мовчазне посилання на 404 —
            саме те, про що попереджає `canonicalPath`. */}
        {listing.path ? (
          <Link className="text-sm underline text-ink-2" href={listing.path}>
            See the page
          </Link>
        ) : (
          <span className="text-sm text-ink-2">
            This place has no public page yet — it has no region in the data.
          </span>
        )}
      </div>
    </section>
  );
}
