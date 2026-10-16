// CAMP-229 (3/3) — the rules of deleting an account, without a database.
//
// 🔴 PURE, SO THAT EVERY BOUNDARY CAN BE EXERCISED WITH A NUMBER. The window,
// the two answers to "what happens to my photos" and the shape of the request
// are decided here; the service only carries them out.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a deleted account can be brought back by signing in.
 *
 * 🔴 THIRTY DAYS IS NOT A WAY TO PLAY FOR TIME, and the screen says so in as
 * many words. The law asks for erasure without undue delay; this window is as
 * short as it can be while still covering the one thing it is for — a mistaken
 * click, or somebody else's hand on an unlocked laptop. ACCESS ENDS AT ONCE: the
 * sessions are deleted in the same request. The only way back is the same
 * password, typed at sign-in.
 */
export const DELETION_WINDOW_DAYS = 30;
export const DELETION_WINDOW_MS = DELETION_WINDOW_DAYS * DAY_MS;

/** The last moment a deletion asked for at `deletedAt` can be undone. */
export const restorableUntil = (deletedAt: Date): Date =>
  new Date(deletedAt.getTime() + DELETION_WINDOW_MS);

/** Can an account deleted at `deletedAt` still be restored at `now`? */
export const isRestorable = (deletedAt: Date, now: Date): boolean =>
  now.getTime() < restorableUntil(deletedAt).getTime();

/**
 * The only two answers to "what should happen to the photos I published".
 *
 * 🔴 THERE IS NO THIRD VALUE, AND NO DEFAULT. A request that does not name one
 * is refused (`photo_choice_required`); nothing here, and nothing in the page,
 * picks one on the person's behalf. We would rather keep the photos, and that is
 * exactly why the choice may not be made for them — the same reasoning as the
 * newsletter box in CAMP-228 (CJEU Planet49, C-673/17), applied where it costs us
 * something.
 */
export const PHOTO_CHOICES = ['delete', 'keep-anonymous'] as const;
export type PhotoChoice = (typeof PHOTO_CHOICES)[number];

export const isPhotoChoice = (v: unknown): v is PhotoChoice =>
  typeof v === 'string' && (PHOTO_CHOICES as readonly string[]).includes(v);

/** A request that cannot be acted on, and the one word that says why. */
export type DeleteRefusal =
  'photo_choice_required' | 'confirmation_required' | 'password_required';

export type DeleteRequest = {
  photos: PhotoChoice;
  password: string;
};

/**
 * The request body, checked in the order the answers are cheapest.
 *
 * 🔴 `understood === true` AND NOTHING ELSE. "true", 1 and "on" are not the
 * person saying they understand; only the explicit boolean the page sends when
 * its box was ticked by a hand is. The password is checked for PRESENCE only
 * here — the scrypt that judges it is the service's, and spending it on a body
 * that is already refused would hand out free work.
 */
export function parseDeleteRequest(
  body: unknown,
):
  | { kind: 'ok'; value: DeleteRequest }
  | { kind: 'refused'; why: DeleteRefusal } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  if (!isPhotoChoice(b.photos))
    return { kind: 'refused', why: 'photo_choice_required' };
  if (b.understood !== true)
    return { kind: 'refused', why: 'confirmation_required' };
  if (typeof b.password !== 'string' || b.password === '')
    return { kind: 'refused', why: 'password_required' };
  return { kind: 'ok', value: { photos: b.photos, password: b.password } };
}

/** How long a finished archive can be downloaded. The mockup's "24 hours". */
export const EXPORT_TTL_MS = DAY_MS;

/**
 * How long an archive may stay "preparing" before it is called failed.
 *
 * 🔴 A process that dies between answering the request and finishing the build
 * leaves a row that says "preparing" for ever. Reading that as still in progress
 * would leave the person watching a spinner nobody is turning, and — because a
 * fresh "preparing" blocks a second request — unable to ask again. Ten minutes is
 * far longer than a build of a few queries takes and short enough to be
 * noticed.
 */
export const EXPORT_STALE_MS = 10 * 60 * 1000;
