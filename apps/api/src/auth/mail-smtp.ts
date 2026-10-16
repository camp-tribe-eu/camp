import { createTransport, type SendMailOptions } from 'nodemailer';
import type { MailMessage, MailSender } from './mail';

/**
 * The real sender (CAMP-110): SMTP submission to the Hetzner mail server,
 * through nodemailer, pinned at 10.0.13.
 *
 * 🔴 EVERY MISSING SETTING IS A "NOT CONFIGURED", NEVER A GUESS. `smtpConfigFrom`
 * returns `config: null` plus the NAMES of what is not set, `mailerFrom` turns
 * that into `mailer: null`, and the account service answers 503 — the same
 * property `mailerFrom` states for every other provider. There is no default
 * host, no default port and no fall-back to the dev mailbox, because the quiet
 * version of this file is a deployment that says "check your email" and sends
 * nothing. Nothing here throws at boot either: a typo in `.env` must show up as
 * the `[mail] NOT CONFIGURED (…)` line, not as an API that will not start.
 *
 * 🔴 THE PASSWORD IS READ FROM THE ENVIRONMENT AND NOWHERE ELSE, AND IS NEVER
 * PRINTED. Not in `why` (which the boot line prints), not in a thrown error
 * (the account service logs the error's class name), not in a transport log:
 * `logger` and `debug` are off by name, because nodemailer's SMTP debug output
 * contains the AUTH exchange.
 *
 * 🔴 THE PORT DECIDES THE TLS MODE, AND ONLY TWO PORTS ARE ACCEPTED. 465 is
 * TLS from the first byte; 587 is STARTTLS, and `requireTLS` makes a server
 * that does not offer it a failure instead of a plain-text session in which
 * the password would be sent. Any other port is refused: we could not say
 * which of the two it was meant to be. Certificate and host name are always
 * checked.
 */

/**
 * The two ports of the Hetzner server. Compared, not looked up in an object:
 * `{}['constructor']` is a function, and a table would call that "a port".
 */
const portFrom = (raw: string): 465 | 587 | undefined =>
  raw === '465' ? 465 : raw === '587' ? 587 : undefined;

export type SmtpConfig = {
  host: string;
  port: 465 | 587;
  user: string;
  pass: string;
  /** The `From` address. A real mailbox, copied to the owner, not a black hole. */
  from: string;
  /** Display name next to `from`. */
  fromName: string;
  /** Where a reply goes. Mandatory: people do answer a letter from `noreply@`. */
  replyTo: string;
};

export type SmtpConfigResult =
  { config: SmtpConfig; why?: undefined } | { config: null; why: string };

/** Required, in the order they are reported. `MAIL_FROM_NAME` is the one optional. */
export const SMTP_REQUIRED_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_REPLY_TO',
] as const;

export const DEFAULT_FROM_NAME = 'CampTribe';

const CONTROL = '\\u0000-\\u001f\\u007f';
// A host name, and nothing a URL could carry: no scheme, port, path, `@`.
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
// One plain addr-spec. Whitespace, control characters (CR and LF are header
// injection) and the characters an address parser gives a meaning to — angle
// brackets, parentheses, brackets, backslash, comma, semicolon, colon, quote —
// are all out, and there is exactly one `@`. nodemailer's address parser is
// where its security advisories have been, so an address that would need
// parsing is refused here rather than handed to it.
const PLAIN_ADDRESS = new RegExp(
  `^[^\\s${CONTROL}<>()\\[\\]\\\\,;:"@]+@[^\\s${CONTROL}<>()\\[\\]\\\\,;:"@]+$`,
  'u',
);

export const isPlainAddress = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 254 && PLAIN_ADDRESS.test(v);

const given = (v: string | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

/**
 * Read the SMTP settings from the environment, or say what is wrong.
 *
 * 🔴 `why` NAMES VARIABLES AND NEVER QUOTES VALUES: a password pasted into the
 * wrong line must not come out in the boot log. Everything that is missing is
 * listed at once, so one failed deploy shows the whole list.
 */
export function smtpConfigFrom(
  env: Record<string, string | undefined>,
): SmtpConfigResult {
  const missing = SMTP_REQUIRED_VARS.filter((name) => !given(env[name]));
  if (missing.length > 0)
    return {
      config: null,
      why: `MAIL_PROVIDER=smtp needs these set: ${missing.join(', ')}`,
    };

  const host = env.SMTP_HOST.trim();
  if (!HOST.test(host))
    return {
      config: null,
      why: 'SMTP_HOST must be a bare host name (no scheme, port or path)',
    };

  const port = portFrom(env.SMTP_PORT.trim());
  if (port === undefined)
    return {
      config: null,
      why: 'SMTP_PORT must be 465 (TLS) or 587 (STARTTLS)',
    };

  for (const name of ['MAIL_FROM', 'MAIL_REPLY_TO'] as const)
    if (!isPlainAddress(env[name].trim()))
      return {
        config: null,
        why: `${name} must be one plain address, without a display name`,
      };

  return {
    config: {
      host,
      port,
      user: env.SMTP_USER.trim(),
      // Not trimmed: this is the one value whose spaces could be real.
      pass: env.SMTP_PASSWORD,
      from: env.MAIL_FROM.trim(),
      fromName: given(env.MAIL_FROM_NAME)
        ? env.MAIL_FROM_NAME.trim()
        : DEFAULT_FROM_NAME,
      replyTo: env.MAIL_REPLY_TO.trim(),
    },
  };
}

/**
 * What nodemailer is told. Pure, so a test can read it.
 *
 * 🔴 NOT HERE, ON PURPOSE: `ignoreTLS`, `opportunisticTLS` (both are ways to
 * end up in plain text), `url` (a connection string with the password in it),
 * `pool` (a handful of letters an hour does not need one).
 */
export function smtpTransportOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    // 465: TLS from the start. 587: start plain, then STARTTLS — and refuse to
    // go on without it.
    secure: config.port === 465,
    requireTLS: config.port === 587,
    tls: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true },
    auth: { user: config.user, pass: config.pass },
    // The default is two minutes to connect. These letters leave after the
    // response (account.service `later`), but shutdown waits for them.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    dnsTimeout: 15_000,
    // 🔴 The SMTP debug log contains the AUTH exchange.
    logger: false,
    debug: false,
    transactionLog: false,
    // Our letters are strings. A path or a URL in a message is never ours.
    disableFileAccess: true,
    disableUrlAccess: true,
    // One letter, one recipient.
    maxRecipients: 1,
  };
}

/**
 * A failed send, with nothing from the provider in it.
 *
 * 🔴 THE ACCOUNT SERVICE LOGS ONLY `error.name`, because a provider's error
 * text can hold the recipient and a log of failed addresses is a list of
 * people. So the one thing worth knowing — wrong password (`EAUTH`), server
 * unreachable (`ECONNECTION`, `ETIMEDOUT`), recipient refused (`EENVELOPE`) —
 * goes into the NAME, taken from the error's `code` only when that is a bare
 * identifier. The original error is not kept as `cause`: it carries the
 * server's reply text.
 */
export class SmtpSendFailed extends Error {
  constructor(readonly code: string) {
    super(`SMTP send failed (${code})`);
    this.name = `SmtpSendFailed_${code}`;
  }
}

const IDENTIFIER = /^E[A-Z0-9_]{2,19}$/;
const codeOf = (e: unknown): string => {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && IDENTIFIER.test(code) ? code : 'EUNKNOWN';
};

/** What `SmtpMailer` needs from nodemailer's transporter. */
export type SmtpTransport = {
  sendMail(data: SendMailOptions): Promise<unknown>;
};

export class SmtpMailer implements MailSender {
  constructor(
    private readonly config: SmtpConfig,
    private readonly transport: SmtpTransport = createTransport(
      smtpTransportOptions(config),
    ),
  ) {}

  async send(message: MailMessage): Promise<void> {
    // 🔴 The address was typed by a person. It reaches nodemailer as an
    // object, which nodemailer does not run through its address parser, and
    // only when it is one plain address — so what was validated is what is
    // sent to, and a second recipient cannot ride along.
    if (!isPlainAddress(message.to)) throw new SmtpSendFailed('EADDRESS');
    try {
      await this.transport.sendMail({
        from: { name: this.config.fromName, address: this.config.from },
        replyTo: { name: '', address: this.config.replyTo },
        to: { name: '', address: message.to },
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (e) {
      throw new SmtpSendFailed(codeOf(e));
    }
  }
}

/**
 * The sender for `MAIL_PROVIDER=smtp`, or why there is none. Never throws:
 * building the transport opens no connection, and if it somehow refuses its
 * options that is a reason on the boot line, not a crash.
 */
export function smtpSenderFrom(
  env: Record<string, string | undefined>,
  make: (options: ReturnType<typeof smtpTransportOptions>) => SmtpTransport = (
    options,
  ) => createTransport(options),
): { sender: MailSender; why?: undefined } | { sender: null; why: string } {
  const result = smtpConfigFrom(env);
  if (!result.config) return { sender: null, why: result.why };
  try {
    return {
      sender: new SmtpMailer(
        result.config,
        make(smtpTransportOptions(result.config)),
      ),
    };
  } catch {
    return { sender: null, why: 'the SMTP transport could not be created' };
  }
}
