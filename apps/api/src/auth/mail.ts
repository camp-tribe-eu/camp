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

export type MailKind =
  | 'verify_email'
  | 'reset_password'
  | 'change_email'
  // 🔴 CAMP-51 — ЄДИНИЙ ВИД, ЩО ЙДЕ НЕ НАШОМУ КОРИСТУВАЧЕВІ.
  //
  // Усі листи вище йдуть на адресу акаунта. Цей — на ПУБЛІЧНИЙ контакт
  // кемпінгу з тегів OSM, тобто чужій людині, яка нас не питала. Тому в
  // ньому немає посилання: клік у незнайомому листі віддав би листинг
  // тому, хто почав заявку. Там код, який треба ввести в нас.
  | 'claim_spot'
  // 🔴 CAMP-505 — ДРУГИЙ ВИД, ЩО ЙДЕ НЕ НА АДРЕСУ АКАУНТА, АЛЕ З ПОСИЛАННЯМ.
  //
  // Іде на адресу, яку людина ввела сама, і лише коли її домен збігся з
  // доменом кемпінгу. Посилання тут безпечне з причини, якої немає в
  // `claim_spot`: воно працює лише в акаунті, що почав заявку (інакше
  // клік власника скриньки віддав би листинг сторонньому), і саме
  // відкриття сторінки нічого не підтверджує — потрібен клік на кнопку.
  | 'claim_owner_link'
  // 🔴 «Write to us» (CAMP-441/31) — ТРЕТІЙ ВИД, ЩО ЙДЕ НЕ КОРИСТУВАЧЕВІ, і
  // перший, що йде НАМ: на нашу ж скриньку, з тим, що написала людина.
  // Без посилання: нічого, що можна клацнути, у ньому немає.
  | 'contact_message';

/**
 * Види, у листі яких є посилання, що будується з `LINK_PATH`.
 * `claim_spot` — без посилання; `claim_owner_link` — своє, з токеном, але
 * не тим самим шляхом, тож лежить окремо від `LINK_PATH`.
 */
export type LinkMailKind = Exclude<
  MailKind,
  'claim_spot' | 'claim_owner_link' | 'contact_message'
>;

export type MailMessage = {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
  html: string;
  /**
   * Де відповідь. Лише коли вона йде НЕ на скриньку проєкту: лист із форми
   * контактів відповідає людині, яка його написала. Одна проста адреса;
   * відправник перевіряє її тим самим `isPlainAddress`.
   */
  replyTo?: string;
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
export const LINK_PATH: Record<LinkMailKind, string> = {
  verify_email: '/verify-email',
  reset_password: '/reset-password',
  change_email: '/confirm-email-change',
};

export const linkFor = (
  base: string,
  kind: LinkMailKind,
  token: string,
): string => `${base}${LINK_PATH[kind]}?t=${encodeURIComponent(token)}`;

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
  kind: LinkMailKind,
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

/**
 * CAMP-51 — лист із кодом на публічний контакт кемпінгу.
 *
 * 🔴 ЧОТИРИ РІШЕННЯ, І КОЖНЕ ЧЕРЕЗ ТЕ, ЩО ЧИТАЧ НАС НЕ ПИТАВ.
 *
 * 1. КОД, НЕ ПОСИЛАННЯ. Клік у незнайомому листі віддав би листинг
 *    тому, хто почав заявку. Код працює навпаки: його треба ввести в
 *    нас, уже маючи акаунт, — отже одна людина і отримала лист, і
 *    тримає акаунт.
 * 2. ХТО ПОПРОСИВ — НЕ НАЗВАНО. Ані пошти, ані імені. Лист може
 *    потрапити не до тієї людини, і називати заявника означало б
 *    видавати його адресу стороннім; а ще це готовий матеріал для
 *    «це я з CampTribe, продиктуйте код».
 * 3. «НІЧОГО НЕ РОБІТЬ» — ПОВНОЦІННА ВІДПОВІДЬ, і вона сказана першою.
 *    Людина, яка цього не просила, має побачити вихід у першому рядку,
 *    а не наприкінці.
 * 4. НАЗВАНО, ЗВІДКИ АДРЕСА. Інакше лист виглядає як витік. Вона з
 *    публічних тегів OpenStreetMap — і це перевірне твердження.
 */
export function claimSpotMessage(
  to: string,
  code: string,
  spotName: string,
  hours: number,
): MailMessage {
  const subject = `Someone asked to claim ${spotName} on CampTribe`;
  const lines = [
    `Someone asked to manage the CampTribe listing for ${spotName}.`,
    '',
    'If that was not you or your team: do nothing. Nothing changes, and we will not write again about this request.',
    '',
    'If it was, here is the code to type on the site:',
    '',
    `    ${code}`,
    '',
    `The code works once, for ${hours} hours, and only for the person who started the request.`,
    '',
    'We wrote to this address because it is in the public OpenStreetMap tags for this place. We did not get it from anywhere else, and we do not add it to any list.',
    '',
    'CampTribe',
  ];
  const html =
    `<p>${esc(lines[0])}</p>` +
    `<p>${esc(lines[2])}</p>` +
    `<p>${esc(lines[4])}</p>` +
    `<p style="font:700 22px/1.4 monospace;letter-spacing:3px">${esc(code)}</p>` +
    `<p>${esc(lines[8])}</p>` +
    `<p>${esc(lines[10])}</p>` +
    `<p>CampTribe</p>`;
  return { to, kind: 'claim_spot', subject, text: lines.join('\n'), html };
}

/** Куди веде посилання з листа власника. Фіксований шлях, жодного `next`. */
export const OWNER_LINK_PATH = '/account/claim/confirm';

export const ownerLinkFor = (base: string, token: string): string =>
  `${base}${OWNER_LINK_PATH}?t=${encodeURIComponent(token)}`;

/**
 * CAMP-505 — лист із посиланням для власника, що ввів адресу сам.
 *
 * 🔴 ЧОТИРИ РЕЧЕННЯ, І КОЖНЕ ПРО ТЕ, ЩО ЛИСТ МОЖЕ ЧИТАТИ НЕ ТОЙ, КОМУ ВІН.
 *
 * 1. «НІЧОГО НЕ РОБІТЬ» ПЕРШИМ. Адресу ввів хтось інший (друкарська
 *    помилка, колега, зловмисник, що знає лише домен): людина має
 *    побачити вихід у першому рядку.
 * 2. АДРЕСУ ЗАЯВНИКА НЕ НАЗВАНО (її тут і немає — ми не знаємо, хто
 *    ввів). Названо кемпінг: це те, що людина може перевірити.
 * 3. ПОСИЛАННЯ ПРАЦЮЄ ЛИШЕ В АКАУНТІ, ЩО ПОЧАВ ЗАЯВКУ — і лист каже це
 *    прямо, щоб клік у незнайомому листі не здавався безпечним «на
 *    всяк випадок»: клік нічого не віддасть, а лист не просить нікуди
 *    входити чи вводити пароль.
 * 4. СТРОК І ОДНОРАЗОВІСТЬ — із тієї самої константи, що їх тримає.
 */
/**
 * Хто контролер і куди писати про дані. 🔴 КОПІЯ `COMPANY` і `PRIVACY_EMAIL`
 * з `apps/web/src/lib/legal.ts`, звідки їх бере й правова сторінка; API не
 * може імпортувати код сайту, тож `owner-mail.spec.ts` читає той файл і
 * вимагає ті самі рядки. Свого тексту тут немає навмисно.
 */
export const CONTROLLER = {
  name: 'UTD BV',
  street: 'Kapucinessenstraat 6',
  city: '2000 Antwerpen',
  country: 'Belgium',
} as const;
export const PRIVACY_EMAIL = 'privacy@camptribe.eu';

/** Скільки живе непідтверджена заявка: «1 month» у політиці й у `RULES` сторожа строків. */
export const UNCONFIRMED_KEPT = 'one month';

/**
 * Інформація за ст. 14 GDPR для того, хто не давав нам адреси.
 *
 * 🔴 ЧОМУ ВОНА В ЛИСТІ. Адресу міг ввести сторонній: одержувач нам нічого не
 * надавав, і цей лист — перша наша комунікація з ним (ст. 14(3)(b)). Тож у
 * ньому мусить бути те, що ст. 14(1)–(2) вимагає дати: хто контролер, мета
 * й підстава, звідки адреса, строк, права, скарга. Тут це одним абзацом;
 * повний текст — політика приватності, на яку є посилання.
 *
 * Підстава — ст. 6(1)(f), а не (b): одержувач ні про що нас не просив (див.
 * оцінку законного інтересу в реєстрі §11).
 */
export function art14Notice(
  spotName: string,
  privacyUrl: string,
): { text: string; html: string } {
  const address = `${CONTROLLER.name}, ${CONTROLLER.street}, ${CONTROLLER.city}, ${CONTROLLER.country}`;
  const head = `Why you are getting this letter: ${address} runs CampTribe and is the controller of your data here. Somebody asked to manage the page for ${spotName} and typed this email address into our form; that is where we got it, and it is all we know about you. We write because we have a legitimate interest (Article 6(1)(f) GDPR) in checking that a campsite page is managed by the person who really runs the place.`;
  const keep = `We do not keep the address itself, only a masked form of it, and a request nobody confirms is deleted after ${UNCONFIRMED_KEPT}. You can object or ask us to erase it by replying to this letter or writing to ${PRIVACY_EMAIL}, and you can complain to the Belgian Data Protection Authority. The full details are in our privacy policy:`;
  return {
    text: `${head} ${keep} ${privacyUrl}`,
    html:
      `<p style="font-size:13px;color:#555555">${esc(head)} ${esc(keep)} ` +
      `<a href="${esc(privacyUrl)}">${esc(privacyUrl)}</a></p>`,
  };
}

export function claimOwnerLinkMessage(
  to: string,
  link: string,
  spotName: string,
  minutes: number,
  privacyUrl: string,
): MailMessage {
  const subject = `Confirm that you manage ${spotName} on CampTribe`;
  const art14 = art14Notice(spotName, privacyUrl);
  const lines = [
    `Someone asked to manage the CampTribe listing for ${spotName}, and used this address to prove it.`,
    '',
    'If that was not you or your team: do nothing. Nothing changes.',
    '',
    `If it was, open this link and press the confirm button: ${link}`,
    '',
    `The link works once, for ${minutes} minutes, and only in the CampTribe account that started the request. Opening it does not confirm anything by itself, and we will never ask for a password in this letter.`,
    '',
    'CampTribe',
    '',
    art14.text,
  ];
  const html =
    `<p>${esc(lines[0])}</p>` +
    `<p>${esc(lines[2])}</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;` +
    `background:#404B62;color:#ffffff;text-decoration:none;border-radius:8px">` +
    `Open the confirmation page</a></p>` +
    `<p>${esc(lines[6])}</p><p>CampTribe</p>` +
    art14.html;
  return {
    to,
    kind: 'claim_owner_link',
    subject,
    text: lines.join('\n'),
    html,
  };
}

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

/**
 * «Write to us»: the letter a visitor's message becomes.
 *
 * 🔴 THE VISITOR'S WORDS ARE DATA IN THIS LETTER, NEVER MARKUP AND NEVER A
 * HEADER. Name and message are escaped in the html part; the subject is the
 * visitor's text after a fixed prefix, on one line (the rules refuse CR/LF
 * before it gets here, and `subjectOf` strips them again — a second wall,
 * because this function is exported and a later caller may not have
 * parsed). `Reply-To` is the visitor's address, so «Reply» in the mailbox
 * answers them; `From` stays ours, because a letter from our server that
 * claims to be from `anna@example.eu` fails SPF and lands in spam.
 */
export const CONTACT_SUBJECT_PREFIX = '[CampTribe contact] ';

const oneLine = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').trim();

export function contactMessage(
  to: string,
  visitor: {
    name: string;
    email: string;
    subject: string | null;
    message: string;
  },
): MailMessage {
  const subject = `${CONTACT_SUBJECT_PREFIX}${oneLine(visitor.subject ?? '') || 'Message from the contact form'}`;
  const text = [
    `From: ${oneLine(visitor.name)} <${visitor.email}>`,
    `Subject: ${oneLine(visitor.subject ?? '') || '(none)'}`,
    '',
    visitor.message,
    '',
    '—',
    'Sent through the contact form on camptribe.eu. Reply to this letter to answer the sender.',
  ].join('\n');
  const html =
    `<p><strong>From:</strong> ${esc(oneLine(visitor.name))} &lt;${esc(visitor.email)}&gt;<br>` +
    `<strong>Subject:</strong> ${esc(oneLine(visitor.subject ?? '') || '(none)')}</p>` +
    `<p style="white-space:pre-wrap">${esc(visitor.message)}</p>` +
    `<p style="color:#666">Sent through the contact form on camptribe.eu. Reply to this letter to answer the sender.</p>`;
  return {
    to,
    kind: 'contact_message',
    subject,
    text,
    html,
    replyTo: visitor.email,
  };
}
