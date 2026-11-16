import { isPlainAddress } from '../auth/mail-smtp';

// «Write to us» — the rules for a public form whose every accepted request is
// a LETTER in the owner's mailbox, with no Nest and no TypeORM in them (the
// problem-reports.rules.ts reason: a rule beside a decorated class is a rule
// this jest setup cannot unit-test).
//
// 🔴 WHAT IS COLLECTED, SAID IN FULL. Four things: a name, an email address,
// an optional subject and the message — plus two numbers that are not about
// the person at all (how long the page was open, and a field that must stay
// empty). Nothing is stored: the body is turned into one letter and dropped.
// No IP, no browser string, no account. The privacy policy (3.1, "Writing to
// us") says exactly this, and `contact.privacy.spec.ts` reads it back.
//
// 🔴 CR AND LF ARE REFUSED IN EVERY ONE-LINE FIELD, because three of the four
// end up in a mail HEADER: the name and the address in `Reply-To`, the subject
// in `Subject`. A line break there is how a form becomes a spam relay (extra
// `Bcc:` lines). nodemailer encodes headers itself, but a guard that depends
// on the library being right is the CAMP-388 lesson run backwards: the
// refusal is here, in our own code, and the library is the second line.

export const LIMITS = {
  name: 100,
  email: 254,
  subject: 150,
  message: 5000,
} as const;

/** Shorter than this is not a message. Counted after trimming. */
export const MIN_MESSAGE = 10;

/**
 * 🔴 The shortest time, in milliseconds, between the form appearing in the
 * browser and the button being pressed. The page enforces it itself (the
 * button waits out the remainder), so a person never meets it; a script that
 * posts straight to the API does, and gets the same «thank you» a person gets.
 */
export const MIN_FILL_MS = 3000;

/** The only keys a body may carry. Anything else is refused, not trimmed. */
const ALLOWED_KEYS = new Set([
  'name',
  'email',
  'subject',
  'message',
  'leaveBlank',
  'elapsedMs',
]);

/** CR, LF, NUL and the other C0 controls, and DEL: none belongs in a header. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Same, but a message body may keep its line breaks and tabs. */
// eslint-disable-next-line no-control-regex
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** U+2028/2029 and U+0085 are line breaks to some mail clients and parsers. */
const UNICODE_BREAK = /[\u0085\u2028\u2029]/;

export type ContactProblem = {
  field: 'body' | 'name' | 'email' | 'subject' | 'message';
  code:
    | 'not_an_object'
    | 'unknown_field'
    | 'missing'
    | 'not_text'
    | 'too_long'
    | 'too_short'
    | 'invalid';
  message: string;
};

export type ParsedContact = {
  name: string;
  email: string;
  /** `null` when left empty — a valid, normal case. */
  subject: string | null;
  message: string;
  /** `true` when the page looks like a script's: the trap is filled, or the form was open too briefly. */
  spam: boolean;
};

export type ParseResult =
  | { ok: true; contact: ParsedContact }
  | { ok: false; problems: ContactProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseContact(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      problems: [
        {
          field: 'body',
          code: 'not_an_object',
          message: 'The request body must be a JSON object.',
        },
      ],
    };
  }

  const problems: ContactProblem[] = [];

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push({
        field: 'body',
        code: 'unknown_field',
        message: `Unexpected field "${key}". A message carries name, email, subject and message — nothing else.`,
      });
    }
  }

  const text = (
    field: 'name' | 'email' | 'subject' | 'message',
    required: boolean,
  ): string | null => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required)
        problems.push({
          field,
          code: 'missing',
          message: `Please fill in ${field === 'email' ? 'your email address' : `the ${field}`}.`,
        });
      return null;
    }
    if (typeof raw !== 'string') {
      problems.push({
        field,
        code: 'not_text',
        message: `The ${field} must be text.`,
      });
      return null;
    }
    const value = raw.trim();
    if (value === '') {
      if (required)
        problems.push({
          field,
          code: 'missing',
          message: `Please fill in ${field === 'email' ? 'your email address' : `the ${field}`}.`,
        });
      return null;
    }
    if (value.length > LIMITS[field]) {
      problems.push({
        field,
        code: 'too_long',
        message: `The ${field} is too long: at most ${LIMITS[field]} characters.`,
      });
      return null;
    }
    const bad =
      field === 'message'
        ? BODY_CONTROL.test(value)
        : CONTROL.test(value) || UNICODE_BREAK.test(value);
    if (bad) {
      problems.push({
        field,
        code: 'invalid',
        message: `The ${field} contains characters that are not allowed${field === 'message' ? '' : ' (no line breaks here)'}.`,
      });
      return null;
    }
    return value;
  };

  const name = text('name', true);
  const email = text('email', true);
  const subject = text('subject', false);
  const message = text('message', true);

  // One plain address with a dotted domain: `isPlainAddress` is the same
  // test the SMTP sender applies to every address it is given, so what is
  // accepted here is what the sender will accept.
  if (email !== null) {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!isPlainAddress(email) || !domain.includes('.')) {
      problems.push({
        field: 'email',
        code: 'invalid',
        message: 'That does not look like an email address.',
      });
    }
  }

  if (message !== null && message.length < MIN_MESSAGE) {
    problems.push({
      field: 'message',
      code: 'too_short',
      message: `Please write a little more: at least ${MIN_MESSAGE} characters.`,
    });
  }

  if (
    problems.length > 0 ||
    name === null ||
    email === null ||
    message === null
  )
    return { ok: false, problems };

  // The trap is a text field named like something a bot wants to fill. Any
  // value at all, even a space, is a script: a person cannot see it.
  const trap = body.leaveBlank;
  const trapped = trap !== undefined && trap !== null && trap !== '';
  const elapsed = body.elapsedMs;
  const tooFast =
    typeof elapsed !== 'number' ||
    !Number.isFinite(elapsed) ||
    elapsed < MIN_FILL_MS;

  return {
    ok: true,
    contact: { name, email, subject, message, spam: trapped || tooFast },
  };
}
