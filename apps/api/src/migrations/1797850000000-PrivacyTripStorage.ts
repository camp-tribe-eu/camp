import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyOwnerVerifyLink1797810000000 } from './1797810000000-PrivacyOwnerVerifyLink';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 2.9 → 3.0 (CAMP-456), поверх 2.9 з CAMP-505 (1797810000000): планувальник тепер шукає місця за
 * назвою, ділить поїздку на перегони, зберігає поїздку в браузері й дає
 * посилання.
 *
 * Три речі на сторінці стали б неправдою без цієї міграції:
 *
 *   1. «Our own code writes five entries … and nothing else» — з'явився
 *      ШОСТИЙ запис, `camptribe.trips`. Сторож `legal-storage-surfaces.spec.tsx`
 *      читає кожен `.setItem(` під `apps/web/src` і звіряє перелік зі
 *      сторінками.
 *   2. «your browser sends two points and a number of days» — тепер це дві
 *      точки й число днів НА КОЖЕН ПЕРЕГІН: поїздка з проміжними точками чи
 *      зі зворотним шляхом — це кілька запитів, і кожен рахується в ліміті
 *      десять на хвилину.
 *   3. Підказки місць: літери, які людина набирає, йдуть на сервер. Вони йдуть
 *      у ТІЛІ запиту (`POST /places/suggest`), а не в адресі, бо адреса
 *      потрапляє в журнал доступу на чотирнадцять днів. Сторінка каже це
 *      словами — і код це доводить тестом (place-source.spec.ts: «набраний
 *      текст НЕ потрапляє в адресу»).
 *
 * 🔴 ЗГОДИ ЗАПИС НЕ ПОТРЕБУЄ — той самий аргумент, що для `camptribe.theme` і
 * `camptribe.persona`: читач сам натиснув «Save this trip», послуга
 * («запам'ятати мою поїздку») запитана прямо й без запам'ятовування не
 * виконується. Запису немає, доки читач не натиснув; видалення останньої
 * збереженої поїздки ключ прибирає.
 *
 * 🔴 ПОСИЛАННЯ НЕСЕ СТАН У ФРАГМЕНТІ (`#t=…`), А НЕ В ЗАПИТІ: фрагмент
 * браузер на сервер не відправляє, тож його немає ні в журналі доступу, ні в
 * Cloudflare. А `?to=<slug>`, який веде зі сторінки кемпінгу на `/plan`, — це
 * публічна адреса кемпінгу, не чиїсь наміри; він потрапляє в журнал, як будь-яка
 * інша адреса сторінки, і сторінка про це каже.
 */
export class PrivacyTripStorage1797850000000 implements MigrationInterface {
  name = 'PrivacyTripStorage1797850000000';

  readonly previous = new PrivacyOwnerVerifyLink1797810000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes five entries into your browser’s storage, and nothing else.',
      'Our own code writes six entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '- **Where to send you back** — camptribe.return, in session storage:',
      `- **Trips you keep** — camptribe.trips, in local storage: the trips you keep with the “Save this trip” button on the trip planner — the places you entered, the number of days and, if you gave them, your vehicle’s type and size — up to ten, each under a name you chose, held on your device alone, so nothing of that kind reaches us. It is written only when you press that button, and removed when you delete the last trip you kept. It is never sent to us, and it holds no name or identifier of you.
- **Where to send you back** — camptribe.return, in session storage:`,
    );
    body = replaceOnce(
      body,
      'When you ask the planner for a route, your browser sends two points and a number of days, and the answer is a list of campsites from our database.',
      'When you ask the planner for a route, your browser sends two points and a number of days for each leg of the trip — a trip with stops on the way, or one that comes back to the start, is several legs, and each is one request — and the answer is a list of campsites from our database.',
    );
    body = replaceOnce(
      body,
      'kept for that minute only and never in the database.',
      `kept for that minute only and never in the database.

The planner also looks places up by name. As you type a place into one of its fields, the letters so far are sent to our server in the body of a request, not in the page address, so the web server’s log, which writes addresses, does not hold them. The server looks for them in its own list of campsites, regions and places and sends back the matches; it keeps nothing, the application logs nothing about it, and the lookup runs in the same kind of read-only transaction. The vehicle’s height, length, weight and type that you may enter are not sent to us at all: the planner does not use them, so they stay in your browser with the trip.

Two things about the page address. When you open the planner from a campsite’s “Route to here” link, the address carries that campsite’s name (\`/plan?to=…\`); it is a public address of a campsite, and it reaches the security log like any other page address. When you press “Copy link”, the link holds the places you entered after a “#”, a part of the address that your browser never sends to us, so it is in no log of ours; whoever you give the link to will see those places.`,
    );
    // 🔴 ДВА РЕЧЕННЯ ПРО «НЕ ЗБЕРІГАЄМО НІЧОГО» МУСЯТЬ БУТИ ПРАВДОЮ І ПІСЛЯ ЦІЄЇ
    // КАРТКИ: «the site does not yet let you save anything» стало б хибним —
    // планувальник пам'ятає поїздку. Він пам'ятає її лише в браузері, і речення
    // кажуть саме це: на нашому боці нічого не тримається (сторож
    // `legal-privacy-holds.spec.ts` читає ці речення проти write-маршрутів API).
    body = replaceOnce(
      body,
      'and which browsers are signed in — nothing else, because the site does not yet let you save anything.',
      'and which browsers are signed in — nothing else, because the site keeps nothing else about you on its own side.',
    );
    body = replaceOnce(
      body,
      'The site does not yet let you save a trip, a place, a photograph or a review, so there is nothing of that kind to hold. When it does, this list changes with it',
      'The site does not yet let you save a trip, a place, a photograph or a review with us, so there is nothing of that kind to hold — the trip planner remembers a trip only inside your browser, and that never reaches us. When we do take such things, this list changes with it',
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '3.0',
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
