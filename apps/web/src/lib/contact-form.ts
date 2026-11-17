// «Write to us» — what the contact page sends, and how it reads the answer.
//
// 🔴 PURE LOGIC, NO React AND NO NETWORK BY DEFAULT: `fetch`, the API address
// and the clock come in as parameters, so everything decided here is tested
// on data. The component (components/contact-form.tsx) only joins this to
// React — the same split as problem-report.ts.
//
// 🔴 WHAT GOES OVER THE WIRE IS BUILT BY `requestBody` AND NOWHERE ELSE: the
// name, the address, the subject if one was typed, the message — and two
// things that are not about the person: the field a human cannot see
// (`leaveBlank`, always empty from a real page) and how many milliseconds the
// form had been open. The API refuses a body with any other field
// (`contact.rules.ts`), so a later "helpful" addition here is a 400 on the
// first click, not a column of data nobody decided to collect.

import { CONTACT_EMAIL } from "./legal";

/** The API's address from the browser. Empty — no request is made, and the form says so. */
export const CONTACT_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** The same limits the API enforces (`LIMITS` in contact.rules.ts; the spec compares). */
export const LIMITS = { name: 100, email: 254, subject: 150, message: 5000 } as const;
export const MIN_MESSAGE = 10;
/** The API's minimum time between the form appearing and the press (`MIN_FILL_MS`). */
export const MIN_FILL_MS = 3000;
/** Margin over the minimum, so timer jitter never lands a person under it. */
export const FILL_MARGIN_MS = 250;

export type ContactDraft = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export const EMPTY_DRAFT: ContactDraft = { name: "", email: "", subject: "", message: "" };

export type DraftProblem = {
  field: "name" | "email" | "message";
  message: string;
};

// A line break in a one-line field is refused by the API; here a text input
// cannot hold one, so this only catches a paste that smuggled a control char.
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

/** Looks like an address — the API is the real judge (`isPlainAddress`). */
const ADDRESS = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\]]+$/;

/** What the page checks before sending — the same rules as the API, so a refusal is rare. */
export function validateDraft(d: ContactDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  const name = d.name.trim();
  const email = d.email.trim();
  const message = d.message.trim();
  if (name === "") out.push({ field: "name", message: "Please tell us your name." });
  else if (name.length > LIMITS.name || CONTROL.test(name))
    out.push({ field: "name", message: `Please keep your name to ${LIMITS.name} characters on one line.` });
  if (email === "") out.push({ field: "email", message: "Please give an email address, so we can answer." });
  else if (email.length > LIMITS.email || !ADDRESS.test(email))
    out.push({ field: "email", message: "That does not look like an email address." });
  if (message.length < MIN_MESSAGE)
    out.push({ field: "message", message: `Please write a little more: at least ${MIN_MESSAGE} characters.` });
  else if (message.length > LIMITS.message)
    out.push({ field: "message", message: `That is too long: at most ${LIMITS.message} characters.` });
  return out;
}

export type ContactBody = {
  name: string;
  email: string;
  subject?: string;
  message: string;
  leaveBlank: "";
  elapsedMs: number;
};

/** The one place a request body is built. A subject is sent ONLY IF one was typed. */
export function requestBody(d: ContactDraft, elapsedMs: number): ContactBody {
  const body: ContactBody = {
    name: d.name.trim(),
    email: d.email.trim(),
    message: d.message.trim(),
    leaveBlank: "",
    elapsedMs: Math.round(elapsedMs),
  };
  const subject = d.subject.trim();
  if (subject !== "") body.subject = subject;
  return body;
}

/** How long the button must still wait before the API will take the message. */
export function waitBeforeSending(openedForMs: number): number {
  return Math.max(0, MIN_FILL_MS + FILL_MARGIN_MS - openedForMs);
}

export type ContactOutcome =
  /** 200: a letter was sent. */
  | "sent"
  /** 400: the server disagreed with the form — should not happen after validateDraft. */
  | "invalid"
  /** 429: this connection has sent enough for now. */
  | "throttled"
  /** No API address configured: the form cannot send anything. */
  | "unavailable"
  /** 503, network, or an answer of the wrong shape. */
  | "failed";

/** Status → outcome. `status` decides everything; no body is read. */
export function interpret(status: number): ContactOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 400) return "invalid";
  if (status === 429) return "throttled";
  return "failed";
}

/**
 * What each outcome says to the reader. One place, so tests and the page
 * read the same.
 *
 * 🔴 EVERY FAILURE NAMES THE ADDRESS, in words: a form that cannot deliver
 * must not leave a person with nowhere to go. The page adds a mailto link
 * beside the sentence; the sentence alone is enough if a script is blocked.
 */
export function messageFor(outcome: ContactOutcome): string {
  switch (outcome) {
    case "sent":
      return "Thank you. Your message is with us and a person will read it.";
    case "invalid":
      return "The form was not accepted. Check the fields and try again.";
    case "throttled":
      return `Enough messages from this connection for now. Try again in a few minutes, or write to ${CONTACT_EMAIL}.`;
    case "unavailable":
      return `Sending is not available right now. Nothing was sent — please write to ${CONTACT_EMAIL}.`;
    case "failed":
      return `We could not send your message just now. Nothing was sent — please write to ${CONTACT_EMAIL}.`;
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Send one message.
 *
 * 🔴 AN EMPTY API ADDRESS SENDS NOTHING — `fetchImpl` is never called, and the
 * outcome says so. No credentials, no cookies: `credentials: 'omit'`, said
 * rather than left to the default, because a reader's session must not travel
 * with a message.
 */
export async function sendContact(
  body: ContactBody,
  api: string = CONTACT_API,
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<ContactOutcome> {
  if (api === "") return "unavailable";
  try {
    const res = await fetchImpl(`${api}/contact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
    });
    return interpret(res.status);
  } catch {
    return "failed";
  }
}
