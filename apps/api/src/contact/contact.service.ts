import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAILER } from '../auth/account.service';
import { contactMessage, type Mailer } from '../auth/mail';
import { isPlainAddress } from '../auth/mail-smtp';
import type { ParsedContact } from './contact.rules';

export type ContactOutcome =
  /** Sent, or — for a script — pretended to be. The caller cannot tell the two apart, on purpose. */
  | 'accepted'
  /** No sender is configured, or it failed. The page then shows our address. */
  | 'unavailable';

/**
 * Where the letter goes: the project mailbox, `MAIL_REPLY_TO`.
 *
 * 🔴 NO NEW RECIPIENT AND NO NEW SETTING. `MAIL_REPLY_TO` is the address the
 * account letters already tell people to answer — «a real mailbox, copied to
 * the owner» (mail-smtp.ts) — and it is the address this very page prints
 * (`CONTACT_EMAIL`). `site_settings.contact_email` is NOT used: the seed
 * migration (SeedSiteSettings) leaves it empty on purpose, because the
 * company's address is a legal particular guarded with the legal pages, and
 * a second editable copy would drift from the printed one.
 */
export const recipientFrom = (
  env: Record<string, string | undefined>,
): string | null => {
  const v = (env.MAIL_REPLY_TO ?? '').trim();
  return isPlainAddress(v) ? v : null;
};

@Injectable()
export class ContactService {
  private readonly log = new Logger(ContactService.name);

  constructor(@Inject(MAILER) private readonly mailer: Mailer | null) {}

  async accept(
    contact: ParsedContact,
    env: Record<string, string | undefined> = process.env,
  ): Promise<ContactOutcome> {
    // 🔴 A SCRIPT GETS THE SAME ANSWER AS A PERSON, and nothing is sent: a
    // bot that is told «refused» tries another trick; one that is told
    // «thanks» goes away content. The cost of a wrong guess is a person's
    // message dropped, which is why the page makes a human unable to be
    // «too fast» (it waits the remainder out itself).
    if (contact.spam) return 'accepted';

    const to = recipientFrom(env);
    if (!this.mailer || !to) return 'unavailable';

    try {
      await this.mailer.sender.send(contactMessage(to, contact));
      return 'accepted';
    } catch (e) {
      // 🔴 THE CLASS NAME ONLY (`SmtpSendFailed_EAUTH`…): the error's text can
      // hold the recipient or the server's reply, and the message body is a
      // person's words. Nothing of the visitor is logged on any path.
      this.log.warn(
        `contact letter not sent: ${(e as Error)?.name ?? 'Error'}`,
      );
      return 'unavailable';
    }
  }
}
