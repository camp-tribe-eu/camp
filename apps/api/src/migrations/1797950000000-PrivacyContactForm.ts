import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyTripStorage1797850000000 } from './1797850000000-PrivacyTripStorage';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 3.0 → 3.1 (CAMP-441, пункт 31 ревʼю): на /contact зʼявилась
 * форма «Write to us».
 *
 * 🔴 ЦЕ ПРАВОВИЙ ТЕКСТ, І ВЛАСНИК ПОГОДЖУЄ ЙОГО ДО ЗЛИТТЯ. Міграція лише
 * кладе чернетку в той самий механізм версій, що й попередні; вона нічого не
 * публікує, поки сайт закритий, а `check-legal-review.mjs` при публічній
 * збірці вимагає, щоб версія 3.1 була прочитана (`legal-review.json`).
 *
 * Що на сторінці стало б неправдою без цієї міграції — нічого: старий
 * розділ «Writing to us» говорив про лист на адресу. Але форма — нова
 * обробка персональних даних іншого роду (імʼя, адреса, текст людини
 * приходять на наш сервер і перетворюються на лист), і політика мусить
 * сказати це словами, ДО того як форма вийде:
 *
 *   · що збирається (чотири поля) і що ні (IP, браузер, акаунт);
 *   · що нічого не пишеться в базу: тіло стає одним листом і забувається;
 *   · що біля листа лежить лічильник ліміту (IP у памʼяті на десять хвилин)
 *     і дві перевірки на скрипт — приховане поле й мінімальний час, які
 *     самі нічого не зберігають;
 *   · кому йде (нашому ж серверу в Hetzner) і нікому більше;
 *   · строк: у скриньці — «доки розбираємось і розумний час після», бо інше
 *     число в політиці не сказано. ⚠️ Числа немає і КОДОМ строк не
 *     виконується (скриньку ніщо не чистить) — це питання власнику.
 *
 * Кожне з цих тверджень держить тест: `contact.spec.ts` (лист, відмови,
 * ліміт) і `apps/web/tests/unit/contact-form.spec.tsx` (речення під кнопкою
 * читається з відданого HTML і веде на якір `#writing`, який ця міграція
 * ставить).
 */
export class PrivacyContactForm1797950000000 implements MigrationInterface {
  name = 'PrivacyContactForm1797950000000';

  readonly previous = new PrivacyTripStorage1797850000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      `### Writing to us

If you send us an email, we have your email address and whatever you put in the message, for as long as it takes to deal with it and for a reasonable period afterwards.

- **Legal basis:** our legitimate interest in answering people who write to us — Article 6(1)(f) GDPR.`,
      `### Writing to us {#writing}

If you write to us — by email, or with the form on the [contact page](/contact) — we have your email address and whatever you put in the message, for as long as it takes to deal with it and for a reasonable period afterwards.

The form asks for your name, your email address, a subject if you want to give one, and your message. When you press “Send message”, your browser sends those four things to our server, which turns them into one email to {{company.email}} and forgets them: they are not written to our database, and the only copy is the email in our mailbox. The email is sent from our own address and carries yours as its reply address, so that answering it reaches you. Nothing is sent while you type. The form sets no cookie, loads nothing from anyone else, and has no CAPTCHA or other outside service behind it.

Two things stand next to the message, and we would rather name them than leave them to be discovered. To keep the form from being flooded, our server counts how many messages arrive from each IP address — at most ten in ten minutes, a count it shares with the account letters described above — and keeps that count in memory only, for those ten minutes, never in the database; it is gone when the process restarts. And the form carries a field that a person cannot see and notes how long it has been open: a message that fills the invisible field, or arrives within three seconds of the page appearing, was sent by a script, and is thrown away without telling the sender. Neither check stores anything about you. The request itself is one line in the security log described above — the address, the method and the path, not what you wrote.

- **Who does it:** us, on our own mail server at Hetzner Online GmbH (Germany), which carries the email and holds the mailbox. Nobody else receives it.
- **Legal basis:** our legitimate interest in answering people who write to us — Article 6(1)(f) GDPR — and, where you write to ask for something you are entitled to from us under an agreement you have with us, performing it — Article 6(1)(b) GDPR. We do not ask for your consent and the form has no tick-box: answering you is the reason we receive the message at all.
- **Kept for:** in the mailbox, for as long as it takes to deal with the message and for a reasonable period afterwards. A message you want removed earlier, we remove when you ask.
- **Your rights:** you may object to this processing under Article 21 GDPR, and you may ask to see, correct or delete what you sent, by writing to [{{privacy.email}}](mailto:{{privacy.email}}). We can find a message by the address you wrote from.`,
    );
    body = replaceOnce(
      body,
      '- **Browser error reports:** 3 months from the moment they arrived',
      `- **Messages you send us** — by email or with the form on the contact page: in our mailbox, for as long as it takes to deal with them and a reasonable period afterwards — see [Writing to us](/legal/privacy#writing). The form keeps no copy in any database.
- **Browser error reports:** 3 months from the moment they arrived`,
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '3.1',
      effectiveFrom: '2026-11-16',
      body,
    };
  })();

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyLegalUpdate(queryRunner, this.page, this.previous);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await revertLegalUpdate(queryRunner, this.page, this.previous);
  }
}
