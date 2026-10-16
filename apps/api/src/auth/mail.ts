/**
 * Outgoing mail (CAMP-228, CAMP-110): the seam, a local mailbox, the real
 * sender, and the letters.
 *
 * The whole sign-up / confirm / reset flow is written against `MailSender`
 * and run against `DevMailbox` in development and CI. The real sender is
 * `mail-smtp.ts` — SMTP submission to the Hetzner mail server through
 * nodemailer — and it is selected only by `MAIL_PROVIDER=smtp`. It is one
 * class and one `if` in `mailerFrom`; the flow is not touched.
 *
 * 🔴 WHAT IS NOT PROVEN HERE, said plainly: the tests use a stand-in
 * transport or a socket on 127.0.0.1, so this code has not yet sent a letter
 * through the real server. The end-to-end proof — a letter into Gmail and
 * Outlook, `dkim=pass`, `spf=pass`, not in spam — needs the server's password
 * and is a step of its own; nothing here claims it.
 */

import { smtpSenderFrom } from './mail-smtp';

export type MailKind = 'verify_email' | 'reset_password' | 'change_email';

export type MailMessage = {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
  html: string;
};

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/**
 * Letters kept in memory and printed, for development and CI.
 *
 * 🔴 NEVER SELECTED BY DEFAULT, and refused outright under
 * `NODE_ENV=production` (see `mailerFrom`). A "convenient" default that fell
 * back to this in a deployment nobody configured would swallow every reset
 * link into a log line and answer 200 — the quietest possible way to ship a
 * flow that does not work.
 */
export class DevMailbox implements MailSender {
  readonly sent: MailMessage[] = [];

  constructor(
    private readonly print: (line: string) => void = (line) =>
      console.log(line),
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    this.print(
      `[mail:dev] to=${message.to} kind=${message.kind}\n${message.text}`,
    );
  }
}

/** What the account service needs to send a letter, or null when it cannot. */
export type Mailer = { sender: MailSender; webBase: string };

export type MailerResult =
  { mailer: Mailer; why?: undefined } | { mailer: null; why: string };

/**
 * Decide, from the environment alone, whether this process can send mail.
 *
 * 🔴 FAILS CLOSED, AND SAYS WHY. Every way of being unconfigured returns
 * `null` plus a reason, which the boot log prints and the endpoints answer
 * with a 503. The alternative — pretend, and accept the request — makes
 * "check your email" a lie, which the card's own words call a broken
 * product discovered by an angry person.
 *
 * It depends on configuration only, never on data, so a 503 for "mail is
 * off" is the same for every address and is not an oracle.
 */
export function mailerFrom(
  env: Record<string, string | undefined>,
  dev: MailSender = new DevMailbox(),
): MailerResult {
  const provider = (env.MAIL_PROVIDER ?? '').trim();
  if (provider === '') return { mailer: null, why: 'MAIL_PROVIDER is not set' };

  const base = webBaseFrom(env.WEB_BASE_URL);
  if (base === null)
    return {
      mailer: null,
      why: 'WEB_BASE_URL is missing or is not an http(s) URL',
    };

  if (provider === 'dev') {
    if (env.NODE_ENV === 'production')
      return {
        mailer: null,
        why: 'MAIL_PROVIDER=dev is refused when NODE_ENV=production',
      };
    return { mailer: { sender: dev, webBase: base } };
  }

  if (provider === 'smtp') {
    // 🔴 Fails closed like every branch here: a missing setting is `null` and
    // a reason naming the variable, never the dev mailbox and never a throw.
    const smtp = smtpSenderFrom(env);
    return smtp.sender
      ? { mailer: { sender: smtp.sender, webBase: base } }
      : { mailer: null, why: smtp.why };
  }

  // The seam. A real sender is one more `if (provider === '…')` above.
  return {
    mailer: null,
    why: `MAIL_PROVIDER=${provider} has no sender in this build (CAMP-110)`,
  };
}

/** The one boot line that says whether this process can send mail, and why not. */
export function mailBootLine(
  result: MailerResult,
  provider: string | undefined,
): string {
  return result.mailer
    ? `[mail] provider: ${(provider ?? '').trim()} — sign-up, confirmation and reset letters are sent`
    : `[mail] NOT CONFIGURED (${result.why}) — sign-up, "forgot password" and "resend" answer 503`;
}

/**
 * The origin letters link to, from configuration — never from the request.
 *
 * 🔴 PASSWORD-RESET POISONING. A link built from `Host`, `X-Forwarded-Host`
 * or `Origin` is a link an attacker chooses: they ask for a reset for the
 * victim with `Host: evil.example`, the victim gets a genuine letter from us
 * containing a genuine token, and the click delivers the token to the
 * attacker. The origin is therefore read once, from the environment, and the
 * request is never consulted. Only the origin is kept, so a configured value
 * with a path, query or credentials cannot reshape the link.
 */
export function webBaseFrom(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Where each kind of letter points on the SITE. These are routes in
 * `apps/web/src/app`; `account.spec.ts` checks that the page exists, because
 * a link in an email that 404s is a flow that is broken for everyone and
 * visible to nobody.
 */
export const LINK_PATH: Record<MailKind, string> = {
  verify_email: '/verify-email',
  reset_password: '/reset-password',
  change_email: '/confirm-email-change',
};

export const linkFor = (base: string, kind: MailKind, token: string): string =>
  `${base}${LINK_PATH[kind]}?t=${encodeURIComponent(token)}`;

/** How long a link in either letter lives. Printed in the letters from this. */
export const LINK_TTL_MS = 60 * 60 * 1000;
const MINUTES = Math.round(LINK_TTL_MS / 60_000);

/** HTML-escape the few characters that can end an attribute or open a tag. */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function letter(
  to: string,
  kind: MailKind,
  subject: string,
  intro: string,
  action: string,
  link: string,
  outro: string,
): MailMessage {
  const expiry = `The link works once and for ${MINUTES} minutes.`;
  const text = [
    intro,
    '',
    `${action}: ${link}`,
    '',
    expiry,
    outro,
    '',
    'CampTribe',
  ].join('\n');
  const html =
    `<p>${esc(intro)}</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;` +
    `background:#404B62;color:#ffffff;text-decoration:none;border-radius:8px">` +
    `${esc(action)}</a></p>` +
    `<p>${esc(expiry)}</p><p>${esc(outro)}</p><p>CampTribe</p>`;
  return { to, kind, subject, text, html };
}

export const verifyEmailMessage = (to: string, link: string): MailMessage =>
  letter(
    to,
    'verify_email',
    'Confirm your email for CampTribe',
    'Please confirm this address so we can send you the letters you ask for.',
    'Confirm email',
    link,
    'If you did not create a CampTribe account, you can ignore this letter.',
  );

/**
 * CAMP-229 — the letter that moves an account to a new address.
 *
 * 🔴 IT GOES TO THE NEW ADDRESS, NEVER THE OLD ONE, and that is the whole
 * point of the flow: the only thing that can prove somebody reads an
 * address is a letter they answer. A confirmation sent to the address that
 * is already on the account would confirm nothing about the new one.
 *
 * 🔴 AND IT NAMES THE ADDRESS IT WOULD MOVE TO. A letter that says only
 * "confirm the change" leaves a person who did not ask for it unable to see
 * what is being asked — and a person who mistyped unable to see the typo.
 * The old address is NOT named here: this letter may land in a stranger's
 * inbox (somebody mistyped), and it must not tell that stranger which
 * account is involved.
 */
export const changeEmailMessage = (to: string, link: string): MailMessage =>
  letter(
    to,
    'change_email',
    'Confirm your new email for CampTribe',
    `Someone asked to move a CampTribe account to this address (${to}).`,
    'Confirm this address',
    link,
    'If it was not you, delete this letter — nothing has changed, and no account has been moved here.',
  );

export const resetPasswordMessage = (to: string, link: string): MailMessage =>
  letter(
    to,
    'reset_password',
    'Reset your CampTribe password',
    'Someone asked for a new password for this account.',
    'Set a new password',
    link,
    'If it was not you, just delete this letter — nothing has changed.',
  );
