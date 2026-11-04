'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { needsLogin, pauseForLogin, type Where } from '@/lib/auth-wall';
import {
  AMENITY_KEYS,
  hasChanges,
  loadListings,
  namePatch,
  saveListing,
  type AmenityKey,
  type AmenityValue,
  type Listing,
} from '@/lib/owner-listings';
import { EmptyView, ListingForm, type Note } from '@/components/owner-listings-view';

// CAMP-51 / CAMP-86 — стан сторінки «мої листинги». Тонка обгортка:
// правила в lib/owner-listings.ts, розмітка в owner-listings-view.tsx.

/**
 * 🔴 CAMP-227, хвіст після #449: ЗБЕРЕЖЕННЯ ВПАЛО НА «НЕ ВВІЙШОВ».
 *
 * Та сама пауза, що на читанні вище (`pauseForLogin`): місце повернення
 * лягає у сховище ЗАРАЗ, разом із запитом, і вхід поверне людину сюди.
 * Але `go` тут — НЕ навігація. Редирект на /login зняв би сторінку
 * разом із чернеткою, яка живе лише в стані React і яку людина щойно
 * набрала. Тому на /login веде посилання в нотатці під формою, і
 * людина піде ним сама, коли буде готова.
 *
 * Окрема функція, бо перевіряється без React: що саме лягло у
 * `sessionStorage` і що саме отримала нотатка.
 */
export function signInToSave(where: Where, note: (n: Note) => void): void {
  pauseForLogin(where, (to) =>
    note({ text: 'Your session has ended, so this was not saved.', signIn: to }),
  );
}

function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

type Draft = {
  name: string;
  amenities: Partial<Record<AmenityKey, AmenityValue>>;
};

const draftOf = (l: Listing): Draft => ({
  name: l.overrides.name ?? l.name ?? '',
  amenities: { ...(l.overrides.amenities ?? {}) },
});

export function OwnerListings() {
  const ready = useReady();
  // 🔴 Через ref, як у кабінеті: інакше `router` стає залежністю ефекту,
  // і запит на листинги повторюється щоразу, коли Next віддає новий
  // обʼєкт навігації. Той самий прийом, та сама причина.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});

  useEffect(() => {
    let alive = true;
    void loadListings().then((res) => {
      if (!alive) return;
      if (res.kind === 'ok') {
        setListings(res.listings);
        setDrafts(Object.fromEntries(res.listings.map((l) => [l.slug, draftOf(l)])));
        return;
      }
      // 🔴 CAMP-227. «НЕ ВВІЙШОВ» І «НІЧОГО НЕМАЄ» — РІЗНЕ, А ТУТ БУЛО
      // ОДНЕ. Будь-яка невдача клалась у порожній список, і людина, яка
      // просто не ввійшла, читала «ви ще не підтвердили жодного
      // листингу» — твердження замість невідомості.
      if (needsLogin(res.kind)) {
        pauseForLogin(
          { pathname: window.location.pathname, search: window.location.search },
          (to) => routerRef.current.replace(to),
        );
        return;
      }
      setListings([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 🔴 Нічого не малюємо, доки не знаємо відповіді. Сторінка, що встигла
  // показати «у вас нічого немає», а потім перемалювала список, —
  // це брехня на півсекунди, і саме її людина запам'ятає.
  if (listings === null) return null;
  if (listings.length === 0) return <EmptyView />;

  const patchFor = (l: Listing, d: Draft): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    const name = namePatch(d.name, l.name);
    if (name !== (l.overrides.name ?? null)) patch.name = name;
    const before = l.overrides.amenities ?? {};
    const amenities: Record<string, AmenityValue | null> = {};
    for (const k of AMENITY_KEYS) {
      const now = d.amenities[k] ?? 'unknown';
      const was = before[k];
      // «unknown» у чернетці означає «не правлю», тобто прибрати правку.
      const want = now === 'unknown' ? null : now;
      if (want !== (was ?? null)) amenities[k] = want;
    }
    if (Object.keys(amenities).length > 0) patch.amenities = amenities;
    return patch;
  };

  return (
    <>
      {listings.map((l) => {
        const d = drafts[l.slug] ?? draftOf(l);
        const patch = patchFor(l, d);
        return (
          <ListingForm
            key={l.slug}
            listing={l}
            name={d.name}
            amenities={d.amenities}
            busy={busy === l.slug}
            ready={ready}
            dirty={hasChanges(patch)}
            message={notes[l.slug] ?? null}
            onName={(v) => setDrafts((s) => ({ ...s, [l.slug]: { ...d, name: v } }))}
            onAmenity={(k, v) =>
              setDrafts((s) => ({
                ...s,
                [l.slug]: { ...d, amenities: { ...d.amenities, [k]: v } },
              }))
            }
            onSave={() => {
              setBusy(l.slug);
              void saveListing(l.slug, patch)
                .then((res) => {
                  if (res.kind === 'saved') {
                    setListings((all) =>
                      (all ?? []).map((x) =>
                        x.slug === l.slug ? { ...x, overrides: res.overrides } : x,
                      ),
                    );
                    setNotes((n) => ({ ...n, [l.slug]: { text: 'Saved.' } }));
                  } else if (res.kind === 'refused') {
                    setNotes((n) => ({ ...n, [l.slug]: { text: res.message } }));
                  } else if (needsLogin(res.kind)) {
                    // Посилання, не редирект: чернетка вище ще потрібна людині.
                    signInToSave(
                      { pathname: window.location.pathname, search: window.location.search },
                      (note) => setNotes((n) => ({ ...n, [l.slug]: note })),
                    );
                  } else {
                    setNotes((n) => ({ ...n, [l.slug]: { text: 'That did not go through.' } }));
                  }
                })
                .finally(() => setBusy(null));
            }}
          />
        );
      })}
    </>
  );
}
