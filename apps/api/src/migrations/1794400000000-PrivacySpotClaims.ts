import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyBrowserStorage1793900000000 } from './1793900000000-PrivacyBrowserStorage';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Політика приватності 2.4 → 2.5: заявка на володіння кемпінгом.
 *
 * 🔴 ЧОМУ ЦЕ МУСИЛО СТАТИ ОКРЕМОЮ РОБОТОЮ, А НЕ АБЗАЦОМ У PR ПРО ФІЧУ.
 *
 * CAMP-51 додав `spot_claims` — нову категорію персональних даних: ЯКИЙ
 * АКАУНТ цікавився ЯКИМ кемпінгом. Реєстр ст. 30 оновили того ж дня
 * (§11), а політика — ні, і сторож `check-gdpr-register.mjs` цього не
 * бачить: він звіряє код із реєстром, не з політикою.
 *
 * Підняти версію означає анулювати запис огляду: `legal-review.json`
 * своїми ж словами каже «By itself, the moment any named page's version
 * is raised». Тобто це перечитування, а не правка тексту — і саме тому
 * CAMP-436 заведена окремо.
 *
 * 🔴 ЩО САМЕ СКАЗАНО ЧИТАЧЕВІ, І ЧОМУ КОЖНЕ РЕЧЕННЯ ТАМ Є.
 *
 *  · адреса НЕ зберігається — у рядку лише маска, і це не ввічливість:
 *    кінцева точка, що віддає адресу, перетворює сайт на спосіб зібрати
 *    11 628 робочих адрес підприємств по одній;
 *  · код, не посилання — клік у несподіваному листі віддав би листинг
 *    тому, хто клікнув;
 *  · лист іде ТРЕТІЙ СТОРОНІ й не називає заявника — інакше ми видаємо
 *    його адресу сторонньому й пишемо готовий сценарій для «це я з
 *    CampTribe, продиктуйте код»;
 *  · межі 3 на кемпінг і 10 на акаунт за добу — ті самі числа, що в
 *    коді (`spot-claim.ts`) і в реєстрі §11;
 *  · строк 1 місяць для непідтверджених і «не видаляється за таймером»
 *    для підтверджених — ті самі слова, що в `RULES` сторожа строків.
 *
 * 🔴 ТЕКСТ — ОДНА ЗАМІНА З ПЕРЕВІРКОЮ ЄДИНОСТІ ЯКОРЯ, від тіла 2.4, яке
 * береться з його ж міграції, а не передруковується. Якір — заголовок
 * планувальника: новий розділ стає перед ним, одразу після «Reporting a
 * problem», бо обидва про те, що читач САМ надсилає нам.
 */
const SECTION = `### Claiming a campsite listing {#claim}

If you run a campsite, you can take over its page here. We prove it is yours with a code — and the code goes to the address the campsite itself has published in [OpenStreetMap](https://www.openstreetmap.org), not to one you type.

When you ask, we store: which campsite, which account asked, a one-way hash of the code (never the code), a **masked** form of the address it went to, kept as the first letter of each part with the rest replaced — the moment the code stops working, how many times a wrong code was typed, and when the request was made. When the right code is typed, the record also holds the moment it was confirmed, and that confirmed record is what lets you correct the page.

**We do not store the address itself.** It stays where it already was, in the public map tags, and the page never shows it back to you in full — only the mask, so that you can recognise your own inbox. An address you cannot read off this site is an address this site cannot be used to collect.

> **The letter goes to someone who did not ask us for it** — whoever reads that campsite’s inbox. So it says in its first line that doing nothing is a complete answer, it explains that we took the address from the public map, and it does not name you: neither your email nor anything else about you. A letter that named the person asking would hand your address to a stranger, and would be a ready-made script for “this is CampTribe, read me the code”.
>
> It carries a code to type here, never a link to click. A link in an unexpected letter would hand the listing to whoever clicked it; a code hands it to whoever both received the letter and is signed in here — which is the thing we are trying to establish.

To keep this from becoming a way to send mail to campsites, our server allows at most **three** code letters per campsite per day and **ten** per account per day, and a campsite that someone has already confirmed receives none at all.

- **Who does it:** us, on our own server at Hetzner Online GmbH (Germany); the letter is sent through Hetzner’s mail service. Nobody else receives it.
- **Legal basis:** for you, Article 6(1)(b) GDPR — you asked us to connect your account to this campsite, and without that record the service cannot exist. For the letter to the campsite’s own published address, Article 6(1)(f): our legitimate interest, and the interest of every reader, in the page being corrected by the person who actually runs the place rather than by anyone who asks.
- **Kept for:** a request nobody confirmed is deleted after **1 month** by the same scheduled job that clears the other records here. A confirmed one is not deleted on a timer — it is the thing that makes the listing yours — and it goes when you delete your account, or when you tell us you no longer run the place.
- **Your rights:** the record is tied to your account, so everything on the [rights](/legal/privacy#rights) page applies to it: you can see it, correct it, or have it deleted, and deleting the account takes it with you.`;

export class PrivacySpotClaims1794400000000 implements MigrationInterface {
  name = 'PrivacySpotClaims1794400000000';

  /** Те, що 2.4 поклала в базу — береться з її міграції. */
  readonly previous = new PrivacyBrowserStorage1793900000000().page;

  readonly page = (() => {
    const anchor = '### The trip planner {#planner}';
    const body = replaceOnce(
      this.previous.body,
      anchor,
      `${SECTION}

${anchor}`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію політики за `slug: 'privacy'` у тексті файла.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.5',
      effectiveFrom: '2026-11-03',
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
