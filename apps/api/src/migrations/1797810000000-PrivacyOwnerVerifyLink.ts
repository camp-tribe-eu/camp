import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyPersonaChoice1797100100000 } from './1797100100000-PrivacyPersonaChoice';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Політика приватності 2.8 → 2.9: «Це мій кемпінг» — підтвердження власника
 * адресою на домені кемпінгу (CAMP-505).
 *
 * 🔴 ЦЕ ОБОВʼЯЗОК, А НЕ ОФОРМЛЕННЯ. Розділ про заявку (2.5) стверджував
 * чотири речі, які після CAMP-505 перестали бути правдою:
 *
 *  · «the code goes to the address the campsite itself has published … not
 *    to one you type» — тепер є другий шлях, де лист іде на адресу, яку
 *    людина ввела сама;
 *  · «It carries a code to type here, never a link to click» — лист
 *    власнику несе посилання;
 *  · «We do not store the address itself» — лишається правдою, але
 *    введену адресу тепер приймає сервер, і сторінка мусить сказати, що
 *    з нею стається;
 *  · «three code letters per campsite … ten per account» — з'явилась
 *    третя межа, на адресу.
 *
 * 🔴 ЩО САМЕ СКАЗАНО Й ЩО ЦЕ ТРИМАЄ В КОДІ (кожне речення має тест):
 *
 *  · лист іде, лише коли домен адреси збігається за ЗАРЕЄСТРОВАНИМ доменом
 *    із сайтом кемпінгу або адреса дослівно є серед опублікованих, і ніколи
 *    не для безкоштовних поштовиків — `owner-email.spec.ts`,
 *    `owner-verify.db.spec.ts`;
 *  · у базі — хеш токена й підстава збігу, адреса не зберігається, лише
 *    маска — `owner-verify.db.spec.ts` читає всі колонки таблиці;
 *  · лічильник листів на адресу — у пам'яті процесу на добу й нікуди не
 *    пишеться — `AddressLimiter` не імпортує ні файлів, ні мережі;
 *  · посилання працює раз, годину, лише в акаунті, що почав, і саме
 *    відкриття нічого не підтверджує — `owner-verify.db.spec.ts`
 *    (маршрут GET відсутній, POST потребує того ж акаунта).
 *
 * 🔴 ТЕКСТ — ЗАМІНИ З ПЕРЕВІРКОЮ ЄДИНОСТІ ЯКОРЯ від тіла 2.8, яке береться з
 * його ж міграції. Якщо хтось відредагував розділ у CMS, заміна впаде з
 * назвою якоря, а не перезапише чуже мовчки.
 */
export class PrivacyOwnerVerifyLink1797810000000 implements MigrationInterface {
  name = 'PrivacyOwnerVerifyLink1797810000000';

  readonly previous = new PrivacyPersonaChoice1797100100000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'If you run a campsite, you can take over its page here. We prove it is yours with a code — and the code goes to the address the campsite itself has published in [OpenStreetMap](https://www.openstreetmap.org), not to one you type.',
      `If you run a campsite, you can take over its page here. There are two ways to prove it is yours, and you choose.

- **An address on the campsite’s own domain.** You type an email address. If its domain is the domain of the campsite’s own website in our data — compared as a registered domain, so that \`mail.camp.de\` matches \`camp.de\` but \`evil-camp.de\` does not — or if it is word for word an address the campsite itself has published in [OpenStreetMap](https://www.openstreetmap.org), we send a one-time link to it. A free mail service (Gmail, Outlook, GMX, Orange and the like) never qualifies, even when the address on the page is a Gmail one: anyone can open such a mailbox, so it proves nothing. Nobody approves the request by hand.
- **A code.** We send a code to the address the campsite has published in OpenStreetMap — not to one you type.`,
    );
    body = replaceOnce(
      body,
      'a one-way hash of the code (never the code), a **masked** form of the address it went to, kept as the first letter of each part with the rest replaced — the moment the code stops working, how many times a wrong code was typed, and when the request was made.',
      'a one-way hash of the code or of the link’s token (never the code or the token itself), which of the two ways it was and, for the link, which rule matched (same domain, or the published address), a **masked** form of the address it went to, kept as the first letter of each part with the rest replaced — the moment the code or link stops working, how many times a wrong code was typed, and when the request was made.',
    );
    body = replaceOnce(
      body,
      'An address you cannot read off this site is an address this site cannot be used to collect.',
      `An address you cannot read off this site is an address this site cannot be used to collect.

The address you type for the link is used for one comparison and one letter, and it is not kept: not in the record (only the mask is), and not in our logs. Two things are worth knowing. The page answers the same whether or not the address matched, so that it cannot be used to find out which campsites exist or what their domains are — it says only that a letter is on its way **if** the address belongs to the campsite, and, if nothing arrives, to write to us. And to stop one mailbox being flooded, the server counts letters per address, **in its memory only**, for at most one day, under a one-way fingerprint of the address; nothing is written to disk, and a restart clears it.`,
    );
    body = replaceOnce(
      body,
      `> It carries a code to type here, never a link to click. A link in an unexpected letter would hand the listing to whoever clicked it; a code hands it to whoever both received the letter and is signed in here — which is the thing we are trying to establish.`,
      `> The letter to the published address carries a code to type here, never a link to click. A link in an unexpected letter would hand the listing to whoever clicked it; a code hands it to whoever both received the letter and is signed in here — which is the thing we are trying to establish.
>
> The letter to an address you typed does carry a link, and it is safe for a different reason: the link works only once, for one hour, and only in the account that started the request, so someone else opening it confirms nothing for you or for themselves. Opening it does not confirm anything even there — it opens a page, and pressing the button on that page confirms. That letter also says in its first line that doing nothing is a complete answer, names the campsite, and does not name you.`,
    );
    body = replaceOnce(
      body,
      'our server allows at most **three** code letters per campsite per day and **ten** per account per day, and a campsite that someone has already confirmed receives none at all.',
      'our server allows at most **three** letters per campsite per day, **ten** per account per day and **three** per address per day, and a campsite that someone has already confirmed receives none at all.',
    );
    body = replaceOnce(
      body,
      'For the letter to the campsite’s own published address, Article 6(1)(f):',
      'For the link letter to an address you typed yourself, the same Article 6(1)(b): you asked for that letter. For the letter with a code to the campsite’s own published address, Article 6(1)(f):',
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.9',
      effectiveFrom: '2026-11-15',
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
