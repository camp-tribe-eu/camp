import { MigrationInterface, QueryRunner } from 'typeorm';
import { ThemeChoicePrivacy1795200000000 } from './1795200000000-ThemeChoicePrivacy';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 2.6 → 2.7: сайт тепер ЛІЧИТЬ перегляди, кліки й порожні
 * пошуки (CAMP-504).
 *
 * 🔴 ЦЕ ОБОВʼЯЗОК, А НЕ ОФОРМЛЕННЯ. Сторінка стверджувала, що запит до
 * планувальника «ми не зберігаємо», а в підсумку казала «жодної
 * аналітики». Перше після CAMP-504 уточнюється (кемпінг із маршруту
 * додає одиницю до денного лічильника), друге лишається правдою тільки
 * тому, що нова сторінка прямо каже, ЩО лічиться, ЩО НЕ зберігається і
 * скільки живе.
 *
 * Що розділ каже, і чим це підперто в коді:
 *   · лічильники, а не журнал → `spot_event_daily`, `zero_result_search_daily`
 *     (міграція EventRollups; `events.db.spec.ts` читає список колонок);
 *   · IP, user-agent, cookie, сховище, текст пошуку НЕ зберігаються → ті
 *     самі специфікації, плюс `events.spec.tsx` у вебі;
 *   · хеш дедуплікації лише в памʼяті на добу → `events/dedup.ts`;
 *   · джерело переходу — одне слово, адреса викидається → `classifyReferrer`;
 *   · редирект веде лише на адресу з бази → `events.controller.ts`.
 *
 * 🔴 Строк: денні суми не мають строку, бо не містять персональних даних;
 * хеш у памʼяті живе до кінця доби за UTC. Так сказано на сторінці, і це
 * НЕ обіцянка про видалення, якої код не виконує.
 */
export class PrivacyEventCounts1796800000000 implements MigrationInterface {
  name = 'PrivacyEventCounts1796800000000';

  /** Те, що 2.6 поклала в базу — береться з її міграції. */
  readonly previous = new ThemeChoicePrivacy1795200000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      '### The trip planner {#planner}',
      `### Counting what is looked at {#event-counts}

So that we can tell a campsite how often its page was opened, and see what people look for and do not find, the site keeps a few counts. They are totals — one number per day — and not a log of visits. What is counted:

- a campsite page being opened;
- a click on a campsite’s website link. That link goes through an address on our server, which sends you on to the website we hold for that campsite, and to nothing else;
- a click on a campsite’s phone number;
- a campsite being part of a route the trip planner has built for you — the campsite is counted, not your route;
- a search that found nothing, together with which of the map’s filters were switched on at the time — never the words you typed;
- copying a campsite’s coordinates and downloading its track as a GPX file would be counted the same way, but at the time of this version the site offers neither.

With each count we keep one word for where you came from: search engine, AI assistant, direct (nothing, or another page of this site), or other. Your browser tells the page where you came from; we read that only to choose the word, and the address itself is thrown away.

**What is not stored:** your IP address, your browser’s identification string, any identifier of you or your device, any cookie, anything in your browser’s storage, and the text of anything you searched for. The tables have no column for any of them.

**How one person is not counted ten times.** The server computes a one-way hash of your IP address, your browser’s identification string, the campsite, the kind of action and the date, and remembers it in its working memory for the rest of that day (UTC). It is never written to the database, to a file or to a log, and it is gone at midnight or at the next restart of the server, whichever comes first. The key mixed into the hash is random, made when the server starts, and kept nowhere. The honest cost of that choice: after a restart, the same person can be counted once more. Visits by search-engine and AI crawlers and by scripts are recognised by their browser string and not counted at all.

- **Legal basis:** our legitimate interest in knowing how the site is used and in telling a campsite how often it was looked at — Article 6(1)(f) GDPR. Nothing is stored on your device for this.
- **Kept for:** the daily totals have no end date, because they hold no personal data — a number per day per campsite cannot be tied to a person, so there is nothing to expire or to give back. The hash lives in memory until the end of the day, as above.

### The trip planner {#planner}`,
    );
    body = replaceOnce(
      body,
      'and the application logs nothing about it.',
      'and the application logs nothing about it. Once the answer is worked out, the server adds one to the day’s total for each campsite it proposed — see [Counting what is looked at](/legal/privacy#event-counts) — which counts the campsites, and nothing about your two points or your number of days.',
    );
    body = replaceOnce(
      body,
      'Both are deleted by the same daily job that handles problem reports.',
      `Both are deleted by the same daily job that handles problem reports.
- **The daily counts of views, clicks and empty searches:** no end date, because they hold no personal data — see [Counting what is looked at](/legal/privacy#event-counts). The one-way hash that stops a person being counted twice is not among them: it lives in the server’s memory until the end of the day (UTC) and is written nowhere.`,
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.7',
      effectiveFrom: '2026-11-12',
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
