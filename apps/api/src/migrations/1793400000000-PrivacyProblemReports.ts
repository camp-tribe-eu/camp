import { MigrationInterface, QueryRunner } from 'typeorm';
import { SeedLegalPages1792800000000 } from './1792800000000-SeedLegalPages';

/**
 * Політика приватності 2.0 → 2.1: розділ про форму «Report a problem».
 *
 * 🔴 ЧОМУ МІГРАЦІЯ, А НЕ ПРАВКА В CMS І НЕ ПРАВКА ПОСІВНОЇ МІГРАЦІЇ.
 * Текст правових документів живе в базі (CAMP-365), і збірка сайту падає,
 * коли версія в базі не дорівнює реєстру `lib/legal.ts`. Реєстр підіймає
 * версію до 2.1 у цьому ж PR, тож базу мусить підняти той самий код, який
 * їде на прод разом із реєстром, — інакше після деплою збірка стоїть, доки
 * людина не впише текст у CMS руками. Правити посівну міграцію не можна:
 * вона вже виконана на проді й удруге не піде.
 *
 * 🔴 ТІЛО 2.1 ВБУДОВАНО ПОВНІСТЮ, а не як «2.0 плюс заміна»: тест вірності
 * засівання (`legal-seed.spec.ts`) і юніт-тести сайту (`legal-cms.ts`)
 * читають ЦЕЙ текст як те, що мусить лежати в базі після всіх міграцій
 * (`pages/legal-seeded.ts` накладає його на посів). Згенеровано з тіла 2.0
 * трьома вставками, кожен якір перевірено на одиничність; перевірка, що тіло —
 * простий шаблонний рядок без \` і без ${}, та сама, що в
 * `check-derived-fields.mjs`.
 *
 * 🔴 ТРИ ВИПАДКИ, ЖОДЕН НЕ ТИХИЙ (та сама дисципліна, що в посівній):
 *   тіло в базі = 2.0 з посіву → оновлюємо текст, версію й дату;
 *   тіло в базі = 2.1          → нічого (повторний прогін чистий);
 *   інше (власник правив у CMS, або ряду немає) → падіння з назвою:
 *   правовий документ не перезаписується мовчки — людина вирішує, чия
 *   редакція чинна.
 *
 * Що змінено у 2.1 — лише те, що є в коді (PR #379, #380):
 *   · новий підрозділ «Reporting a problem with a campsite page» {#reports}:
 *     що зберігається (слаг, вид, опис ≤ 2 000, необовʼязковий контакт ≤ 200,
 *     час, стан модерації), що НЕ збирається (IP, агент, геолокація, акаунт —
 *     зайве поле дає 400), що лежить ПОРЯД (IP у лічильнику 5/10 хв у памʼяті
 *     й у журналі вебсервера), підстава ст. 6(1)(f), строки 12/24 місяці,
 *     які виконує `scripts/ops/retention-purge.mjs`, права й адреса
 *     {{privacy.email}}; попередження не писати персональних даних;
 *   · «How long we keep it»: рядок про заявки;
 *   · «Your rights»: адреса {{privacy.email}} для питань про персональні дані.
 */
export class PrivacyProblemReports1793400000000 implements MigrationInterface {
  name = 'PrivacyProblemReports1793400000000';

  /** Те, що посів поклав у базу як 2.0 — береться з посівної міграції, не передруковується. */
  readonly previous = (() => {
    const pages = (
      new SeedLegalPages1792800000000() as unknown as {
        pages: Array<{
          slug: string;
          version: string;
          effectiveFrom: string;
          body: string;
        }>;
      }
    ).pages;
    const p = pages.find((x) => x.slug === 'privacy');
    if (!p) throw new Error('посівна міграція не несе «privacy»');
    return p;
  })();

  readonly page = {
    slug: 'privacy',
    title: 'Privacy',
    summary:
      'What we hold about you, who else touches it, and the two things you can do yourself without asking us.',
    version: '2.1',
    effectiveFrom: '2026-10-30',
    body: `## Who is responsible {#who}

{{company.address}} is the controller for personal data processed through this site. You can reach a person at [{{company.email}}](mailto:{{company.email}}).

> **The short version.** You can use almost all of this site without an account, and we would rather you did. If you make one, we hold your email address, a one-way hash of your password, and whatever you save — trips, places, photos. No advertising, no tracking pixels, no third-party analytics, and nothing sold or shared. You can download everything we hold, or delete the account, from your account pages, without asking us.

## What we process, and why {#what}

### Serving the pages

A page request passes through two hands. Cloudflare receives it first, as our content delivery network and reverse proxy, and it necessarily sees your IP address, the page asked for and your browser’s user-agent string. It then forwards the request to our own server, which is where the site is actually hosted and which sees the same information in order to answer.

- **Who does it:** Cloudflare, Inc. as CDN and proxy, and Hetzner Online GmbH (Germany) as the provider of the machine that serves the site. Both act as our processors under Article 28 GDPR.
- **Legal basis:** our legitimate interests in operating the service and defending it from abuse — Article 6(1)(f) GDPR.
- **Kept for:** fourteen days on our own server, in the security log described next. Cloudflare keeps its own operational logs inside its platform under its retention policy; we do not export them, build profiles from them, or use them for anything but keeping the site up.

### The security log

Our web server writes one line for every request it answers. We turned this on deliberately, and it is the one place on our machine where your IP address is written down. Sites get attacked; a log is the difference between knowing what happened and guessing.

Each line holds:

- the time, to the second;
- your IP address as our content delivery network passes it to us, and the two-letter country code it derives from that address;
- the address of the page you asked for, the method, and the status we answered with;
- your browser’s user-agent string, the TLS version and cipher it negotiated, how many bytes we sent, and how long we took.

The rest of each line is about the connection rather than about you: which name the request arrived under, what your browser said it could accept, and the identifiers our content delivery network uses to trace a request through its own machines.

It does **not** hold the contents of your cookies or of any authorisation header. The server writes the word REDACTED in their place before the line reaches the file, so a copy of this log is not a way to sign in as you.

One thing it does hold is worth saying plainly, because it is easy to miss. Several tools on this site keep their state in the page address, so that a link can be reloaded or sent to someone: what you type into the site search, the filters you set on the map, and the answers you give the packing list and the trip cost calculator. While you are using them nothing is sent to us — they run in your browser. That address reaches us, and this log, when the page is **loaded** with it: because you reloaded, or because you or somebody else opened a saved link. Then whatever is in the address is written down with the rest of the line, and it goes when that line goes.

- **Who does it:** us, on our own server. The file can be read only by the account the web server runs as and by whoever administers the machine — not by the application that serves you — and it is appended to, never rewritten. Nothing copies it to anyone else.
- **Legal basis:** our legitimate interest in keeping this service secure — Article 6(1)(f) GDPR. Recital 49 names network and information security as exactly that kind of interest, and Article 32 requires us to take measures of this sort. We do not ask for your consent here, and saying so plainly is part of being honest about it: a security log that stops recording for whoever declines would not be a security log.
- **Kept for:** fourteen days. The server deletes older lines by itself, on a schedule, rather than waiting for someone to remember.
- **Not used for:** analytics, audience measurement, advertising, profiling, or any decision about you. It is read when something looks wrong, and otherwise it is not read at all.

You can object to this under Article 21 GDPR by writing to us. We will weigh your objection against the security interest and tell you what we decided and why.

### Your account, if you make one

An account exists so that what you save stays yours across devices. We hold the following, and nothing else:

- your email address, and whether you have confirmed it;
- a **hash** of your password — a one-way transformation, not the password. We cannot read it, recover it or tell you what it was;
- whether and when you agreed to receive our emails, recorded separately so that consent can be proven and withdrawn;
- sessions — the fact that a browser is signed in, and until when;
- what you saved: trips and their stops, saved places, photos you submitted, reviews you wrote.

- **Legal basis:** performance of the contract you entered into by creating the account — Article 6(1)(b) GDPR. For the newsletter flag specifically, your consent — Article 6(1)(a).

### Email we send you

Confirming your address and resetting your password require us to send you an email, so your address passes to the mail system that carries it.

- **Who does it:** Hetzner Online GmbH (Germany), which operates our mailboxes and carries outgoing mail.
- **Legal basis:** performance of the contract — Article 6(1)(b) GDPR — for account mail; consent for anything we send you because you asked to hear from us.

### Your cookie choice

If you answer the cookie banner, we store that answer — and only that answer — on your own device, so we do not have to ask again. It never reaches our servers and it identifies nothing. The details are on the [cookies](/legal/cookies) page.

### Writing to us

If you send us an email, we have your email address and whatever you put in the message, for as long as it takes to deal with it and for a reasonable period afterwards.

- **Legal basis:** our legitimate interest in answering people who write to us — Article 6(1)(f) GDPR.

### Reporting a problem with a campsite page {#reports}

Every campsite page carries a “Report a problem” form. It exists so that a reader — or the people who run the campsite — can tell us that something on the page is wrong, and a person will look. Nothing on the page changes until one has.

When you send a report we store: which campsite it is about, the kind of problem you chose from the list, what you wrote in the description (up to 2 000 characters), the moment the report arrived, and — **only if you typed one** — a way to reach you, up to 200 characters, exactly as typed. The contact is optional and a report without one is handled the same; it is asked for only so that we can put a follow-up question. Later the record gains what the moderator decided, the note they left, and who looked at it and when.

That is the whole record. The form does not send, and the table has no column for, your IP address, your browser’s user-agent string, your location or any account. A request carrying a field that is not in that list is refused outright, not trimmed.

> **Please do not put personal details into the description — yours or anyone else’s.** It is free text and we do not filter it; the form says the same beside the field. If something personal did go in, write to us and we will take it out.

Two things stand next to the record, and we would rather name them than leave them to be discovered. To keep the form from being flooded, our server counts how many reports arrive from each IP address — at most five in ten minutes — and keeps that count in memory only, for those ten minutes, never in the database; it is gone when the process restarts. And the request itself is one line in the security log described above, like any other request: the address, the method and the path, not what you wrote.

- **Who does it:** us, on our own server at Hetzner Online GmbH (Germany). A moderator reads the reports in our content system on that same machine. Nobody else receives them.
- **Legal basis:** our legitimate interest in keeping what we publish accurate, which is also your interest in seeing the error fixed — Article 6(1)(f) GDPR. We do not ask for your consent: you can send a report without telling us who you are, and a consent we would have to record for every anonymous report would hold more about you than the report does.
- **Kept for:** 12 months after a moderator has closed the report, and 24 months for a report nobody has reviewed by then. A scheduled job on our server deletes what has expired every day, and stops with an error rather than silently skipping if it cannot. The term is enforced by code, not by this sentence — see [How long we keep it](/legal/privacy#keep).
- **Your rights:** you may object to this processing under Article 21 GDPR, and you may ask to see, correct or delete a report you sent, by writing to [{{privacy.email}}](mailto:{{privacy.email}}). Reports are not tied to an account, so we can find yours only by the contact you left, or by which campsite and roughly when — tell us what you can.

### What we do not do

- No advertising and no advertising networks.
- No automated decision-making that produces legal or similarly significant effects, and no profiling of you as a person — Article 22 GDPR does not arise. What you save is shown back to you; it is not used to score or categorise you.
- No selling, renting or sharing of personal data.
- No social-media buttons that report your visit back to a social network.

## Who else sees it {#who-else}

Three processors, each acting only on our instructions under a contract that says so — Article 28 GDPR:

- **Hetzner Online GmbH**, Germany — the server that hosts the site and the database, and the mail system. Inside the EU, so no transfer question arises.
- **Cloudflare, Inc.** — content delivery network and reverse proxy in front of that server. Where this involves a transfer outside the European Economic Area, it is covered by the European Commission’s Standard Contractual Clauses.

That is the complete list. Nobody else receives personal data from this site, except where we are legally required to disclose it — and if that list ever grows, this page grows with it in the same release.

## The map {#map}

The map draws its background tiles from an external provider, which means your browser connects to that provider directly and it can see your IP address and which tiles you asked for, in the same way any image on the web works. We do not send it anything about you, and it sets no cookies through us. Which provider is in use is shown under the map, and you can switch it.

## How long we keep it {#keep}

- **Account data:** until you delete the account. We do not expire accounts for inactivity.
- **Sessions:** thirty days, then they expire on their own. Signing out ends one immediately; changing your password ends all of them.
- **Links we email you** — confirmation and password reset: one hour, and single-use.
- **Problem reports** sent through a campsite page: 12 months after the report was closed, 24 months for a report nobody reviewed. Deleted by a daily job on our server — see [Reporting a problem](/legal/privacy#reports).

## Your rights {#rights}

Under the GDPR you may ask us to give you a copy of your personal data, correct it, delete it, restrict or object to our use of it, or hand it to someone else in a portable form. Where we rely on your consent you can withdraw it at any time, and withdrawing is as easy as giving it.

For two of those you do not have to ask us at all. If you have an account, you can **download a file containing everything we hold about you** and you can **delete the account**, both from your account pages. Deleting ends your access in the same request — not in thirty days.

> **What deletion does not reach, and why.** One record survives: that a photo or a review was rejected, why, when, and for which place. It carries nothing that points back to you — no name, no address, not even a reference to the account that was deleted. Because no part of it identifies a person, it has stopped being personal data, and the right to erasure has nothing left to reach. We keep it to be able to account for our own moderation decisions. Separately, the licence you granted for photographs already published is a contract rather than personal data, so those photographs may remain — but your name comes off them on request. We would rather tell you where the line is than let you discover it.

For anything else, write to [{{company.email}}](mailto:{{company.email}}) — or, for anything about your personal data, to [{{privacy.email}}](mailto:{{privacy.email}}). We answer within one month, and if a request is complex enough to need longer we will tell you inside that month and say why — which is what Article 12(3) allows and requires.

> **If we get it wrong.** You can complain to a data protection authority. Ours is the Belgian [Gegevensbeschermingsautoriteit / Autorité de protection des données](https://www.gegevensbeschermingsautoriteit.be/), and you may also complain to the authority where you live or work.

## Children {#children}

Reading this site needs no account and no age. Opening one requires you to be eighteen, and we ask you to confirm that rather than asking for your date of birth — a date we would then be holding and would have to protect, to answer a question that a yes already answers.

This site is not aimed at children, and we do not knowingly open accounts for them or collect anything from them. If you believe a child has given us personal data, write to us and we will remove it.

## Changes {#changes}

The version of this policy and the date it took effect are at the top of the page. Earlier versions are in our public source repository, so what applied on any given day can be established exactly.`,
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; version: string; body: string | null }> =
      await queryRunner.query(
        `SELECT lp.id, lp.version, t.body
           FROM legal_pages lp
           LEFT JOIN legal_page_translations t
             ON t.legal_page_id = lp.id AND t.language_code = 'en'
          WHERE lp.slug = $1`,
        [this.page.slug],
      );
    const row = rows[0];
    if (row === undefined || row.body === null) {
      throw new Error(
        'legal_pages «privacy»: немає рядка з англійським текстом, який ця ' +
          'міграція має оновити. Посівна міграція (1792800000000) мала його ' +
          'створити; без нього тут нема що підіймати до 2.1.',
      );
    }
    const body: string = row.body;
    if (body === this.page.body && row.version === this.page.version) return;
    if (body !== this.previous.body) {
      throw new Error(
        `legal_pages «privacy» містить текст, якого ця міграція не знає ` +
          `(${body.length} символів, версія ${row.version}; очікувала 2.0 з посіву, ` +
          `${this.previous.body.length} символів). Правовий документ не перезаписується ` +
          'мовчки: вирішіть, чия редакція чинна, і або приведіть базу до посіву, або ' +
          'внесіть правку в текст 2.1 цієї міграції.',
      );
    }
    await queryRunner.query(
      `UPDATE legal_page_translations SET title = $2, plain_summary = $3, body = $4
        WHERE legal_page_id = $1 AND language_code = 'en'`,
      [row.id, this.page.title, this.page.summary, this.page.body],
    );
    await queryRunner.query(
      `UPDATE legal_pages SET version = $2, effective_from = $3 WHERE id = $1`,
      [row.id, this.page.version, this.page.effectiveFrom],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Повертаємо лише те, що самі поклали: чужий текст не чіпаємо.
    const rows: Array<{ id: string }> = await queryRunner.query(
      `SELECT lp.id
         FROM legal_pages lp
         JOIN legal_page_translations t
           ON t.legal_page_id = lp.id AND t.language_code = 'en'
        WHERE lp.slug = $1 AND t.body = $2`,
      [this.page.slug, this.page.body],
    );
    if (rows.length === 0) return;
    await queryRunner.query(
      `UPDATE legal_page_translations SET body = $2
        WHERE legal_page_id = $1 AND language_code = 'en'`,
      [rows[0].id, this.previous.body],
    );
    await queryRunner.query(
      `UPDATE legal_pages SET version = $2, effective_from = $3 WHERE id = $1`,
      [rows[0].id, this.previous.version, this.previous.effectiveFrom],
    );
  }
}
