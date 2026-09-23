// CAMP-56: the reader's cookie decision — what it is and where it lives.
//
// 🔴 The record of the choice is itself stored, whether the answer was
// yes or no. Without that we would have to ask again on every page, and a
// site that keeps asking until it gets a yes is not asking — it is
// wearing the reader down. Storing a refusal is what makes a refusal
// mean something, and it is strictly necessary for that purpose, so it
// needs no consent of its own (ePrivacy Directive Art. 5(3)).
//
// 🔴 The policy version is part of the record. "You consented" is only a
// defensible statement if we can say what you consented TO; when the
// cookie policy changes in substance its version is bumped and the
// banner asks again rather than silently inheriting an answer given to a
// different question.
//
// 🔴 localStorage, not a cookie. It never travels to the server, so the
// decision cannot itself become a thing we process about you — and every
// read is wrapped, because private windows and blocked site data make
// these calls throw rather than return null.

import { legalPage } from './legal';

export type ConsentChoice = 'accepted' | 'rejected';

export interface ConsentRecord {
  choice: ConsentChoice;
  /** ISO timestamp — evidence of when, not just whether. */
  at: string;
  /** Version of the cookie policy that was in force. */
  version: string;
}

export const CONSENT_KEY = 'camptribe.consent';

/** The version currently being asked about. */
export const consentVersion = (): string =>
  legalPage('cookies')?.version ?? '0';

/** The stored decision, or null if there is none we can still rely on. */
export function readConsent(
  store: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): ConsentRecord | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const r = parsed as Partial<ConsentRecord>;
  if (r?.choice !== 'accepted' && r?.choice !== 'rejected') return null;
  if (typeof r.at !== 'string' || typeof r.version !== 'string') return null;

  // 🔴 An answer to an older version of the policy is not an answer to
  // this one. Treated as no decision at all, so the banner asks again.
  if (r.version !== consentVersion()) return null;

  return { choice: r.choice, at: r.at, version: r.version };
}

export function writeConsent(
  choice: ConsentChoice,
  store: Pick<Storage, 'setItem'> | undefined = safeStorage(),
  now: Date = new Date(),
): ConsentRecord {
  const record: ConsentRecord = {
    choice,
    at: now.toISOString(),
    version: consentVersion(),
  };
  try {
    store?.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Blocked storage means we cannot remember the answer. The banner
    // will ask again next time, which is the honest failure: it must
    // never fall through to treating the visit as consent.
  }
  return record;
}

export function clearConsent(
  store: Pick<Storage, 'removeItem'> | undefined = safeStorage(),
): void {
  try {
    store?.removeItem(CONSENT_KEY);
  } catch {
    /* nothing to do — see above */
  }
}

/**
 * Whether optional, consent-requiring things may run.
 *
 * 🔴 Defaults to false for every state that is not an explicit yes: no
 * record, an unreadable record, an answer to an older policy, storage
 * blocked. There is exactly one path to true and it is the reader
 * clicking Accept.
 */
export function mayLoadOptional(record: ConsentRecord | null): boolean {
  return record?.choice === 'accepted';
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Dispatched when the footer asks for the banner to be shown again. */
export const REOPEN_EVENT = 'camptribe:consent-reopen';
