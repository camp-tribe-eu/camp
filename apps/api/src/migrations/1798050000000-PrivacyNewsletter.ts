import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyContactForm1797950000000 } from './1797950000000-PrivacyContactForm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 3.1 → 3.2 (CAMP-441, пункт 7 ревʼю): у підвалі сайту зʼявилося
 * поле «підписатися на листи» з подвійним підтвердженням.
 *
 * 🔴 ЦЕ ПРАВОВИЙ ТЕКСТ, І ВЛАСНИК ПОГОДЖУЄ ЙОГО ДО ЗЛИТТЯ. Міграція лише кладе
 * чернетку в той самий механізм версій, що й попередні; сайт закритий, і
 * `check-legal-review.mjs` при публічній збірці вимагає, щоб версія 3.2 була
 * прочитана (`scripts/seo/legal-review.json`: `pages.privacy` піднято, відбиток
 * `texts.privacy` ПРИБРАНО — його ставлять після викладки; до того сторож лише
 * попереджає, так задумано).
 *
 * Нова обробка нового роду: адреса, яку людина дала, щоб ми писали їй самі, —
 * на відміну від форми контактів (нічого не пишеться) і акаунта (договір).
 * Тут підстава — згода, ст. 6(1)(a), і політика мусить сказати це ДО того, як
 * поле вийде:
 *
 *   · що тримаємо: адресу, стан, три дати, два ХЕШІ токенів і строк першого;
 *     що ні: IP, браузер, акаунт, куки;
 *   · кому видно: нікому, крім нас, — наша база на нашому сервері, жодного
 *     сервісу розсилок;
 *   · підстава — згода; її доказ — натискання «Confirm» на сторінці, яку відкриває
 *     посилання з листа (саме відкриття нічого не міняє: сканери відкривають
 *     посилання самі), і дати в рядку;
 *   · строк: непідтверджена — 7 днів від першого запиту; підтверджена — до
 *     відписки; після відписки — лише адреса з позначкою, щоб не писати знову;
 *   · як відкликати: посилання в кожному листі (підтвердження вже його має).
 *
 * 🔴 ДВА ТВЕРДЖЕННЯ, ЯКІ ПОЛІТИКА ПРОГОВОРЮЄ ПРЯМО, бо вони не вигадані з
 * «так мало б бути»:
 *   · чистка непідтверджених іде НА ШЛЯХУ ЗАПИТУ (підписка або підтвердження),
 *     не окремою задачею — тож без запитів видалення може прийти пізніше за
 *     сьому добу (`newsletter.service.ts`, `purgeStale`);
 *   · розсилок цим кодом НЕ шлеться: ні один лист новин не відправляється, лише
 *     підтвердження.
 *
 * Кожне твердження держить тест: `newsletter.privacy.spec.ts` (числа, стовпці
 * таблиці, «не в Directus») і `apps/web/tests/unit/newsletter-form.spec.tsx`
 * (речення згоди й посилання `#newsletter` читаються з відданого HTML підвалу).
 */
export class PrivacyNewsletter1798050000000 implements MigrationInterface {
  name = 'PrivacyNewsletter1798050000000';

  readonly previous = new PrivacyContactForm1797950000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      '### Reporting a problem with a campsite page {#reports}',
      `### Our letters, if you ask for them {#newsletter}

The form in the footer of every page asks for one thing: your email address, so that we can send you occasional CampTribe news. It works in two steps, and you are not subscribed until the second. When you press “Subscribe”, your browser sends the address to our server, which writes one row in our own database and sends you one letter asking you to confirm. Until you press “Confirm” on the page the link in that letter opens, we send you nothing else and the address is not on any list. Opening the link changes nothing by itself; only the button on the page does, so a mail scanner that opens the links in your mail cannot subscribe or unsubscribe you.

The row holds this, and nothing else:

- your email address, in lower case;
- its state: waiting for confirmation, confirmed, or unsubscribed;
- the date of your request, the date you confirmed, and the date you unsubscribed, where those happened;
- two one-way hashes — one of the confirmation link, one of the unsubscribe link — and the time the confirmation link stops working, 48 hours after we sent it. We do not keep the links themselves, so nobody who reads the table can use it to confirm or unsubscribe anybody.

We do not store your IP address, your browser or an account with the address, and the form sets no cookie. It is protected against floods in the same way as the contact form, and none of that is stored with your address — see [Writing to us](/legal/privacy#writing).

Somebody may type an address that is not theirs. The one letter we send says so in its first lines: if it was not you, do nothing, and the address is deleted; or open the unsubscribe link in the same letter and press “Unsubscribe”, and we mark it as unsubscribed at once.

- **Who sees it:** only us. The address stays in our database on our own server at Hetzner Online GmbH (Germany), and our mail server there carries the letter. It is not given to a mailing-list service, and not shared, sold or rented.
- **Legal basis:** your consent — Article 6(1)(a) GDPR. The consent is pressing “Confirm” on the page the link in that letter opens; the dates in the row are how we show it.
- **Kept for:** an address that has not been confirmed is deleted 7 days after the first request. Our server clears such addresses whenever somebody subscribes or confirms, not on a clock of its own, so if nobody does for a while the deletion can come later than the seventh day; the address is used for nothing in that time. A confirmed address is kept until you unsubscribe. After that we keep the address, marked as unsubscribed, only so that we do not write to you again; if you would rather it were gone completely, write to us and we delete it.
- **Withdrawing consent:** with the unsubscribe link, which every letter we send you carries — open it and press “Unsubscribe”: one click, no sign-in — or by writing to [{{privacy.email}}](mailto:{{privacy.email}}). Withdrawing is as easy as giving it, and it does not make anything we did before it unlawful.
- **Your rights:** to see, correct or delete the address, to object, and to complain, as under [Your rights](/legal/privacy#rights).

### Reporting a problem with a campsite page {#reports}`,
    );
    body = replaceOnce(
      body,
      '- **Browser error reports:** 3 months from the moment they arrived',
      `- **Addresses for our letters:** one that has not been confirmed, 7 days from the first request; a confirmed one, until you unsubscribe — see [Our letters](/legal/privacy#newsletter).
- **Browser error reports:** 3 months from the moment they arrived`,
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '3.2',
      effectiveFrom: '2026-11-20',
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
