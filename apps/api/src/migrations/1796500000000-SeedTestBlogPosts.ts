import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Наповнення для можливості тестування: пʼять дописів блогу.
 *
 * 🔴 ЖИВЕ В РЕДАГОВАНИХ КОЛЕКЦІЯХ. Допис це `pages` з `type = 'post'`
 * плюс `page_translations`, `page_sections`, `page_section_translations`
 * — усі чотири зареєстровані в Directus і доступні ролі Editor на
 * читання й запис. Нової колекції немає (межа 25 з 25). Міграція лише
 * кладе перші рядки; після цього власник править текст, заголовок,
 * дату, автора й `noindex` в адмінці, а не тут.
 *
 * 🔴 ЗМІСТ: лише загальні правила. Жодного конкретного кемпінгу,
 * ціни, дати чи відсотка. Єдине число — 3,5 т, межа категорії B.
 *
 * 🔴 ІДЕМПОТЕНТНО: існуючий допис із тим самим слагом не чіпається
 * (власник міг його вже виправити). `down` видаляє лише ці пʼять слагів.
 *
 * Дати публікації — відносно моменту запуску, у минулому, щоб допис
 * був видимий (`published_at <= now()`).
 */
interface Post {
  slug: string;
  daysAgo: number;
  title: string;
  description: string;
  body: string;
}

export const TEST_POSTS: readonly Post[] = [
  {
    slug: 'camper-over-3-5-tonnes',
    daysAgo: 9,
    title: 'What changes when your camper weighs more than 3.5 tonnes',
    description:
      'A heavier motorhome changes your licence, your tolls and your route. A plain checklist before you buy or rent one.',
    body: `Most people never think about the weight of a motorhome until a form asks for it. Then 3,500 kilograms turns out to be a line that matters more than almost any other number on the registration papers.

## Your driving licence

In the European Union, an ordinary car licence, category B, covers vehicles up to 3,500 kilograms of maximum permissible mass. Go over that and you need a heavier category, usually C1, which is a separate test with a medical check. This is the figure on the plate or in the papers, not what the van weighs on the day. A camper that is 3,400 kilograms empty-ish but plated for more is a heavier vehicle in the eyes of the law.

If you are renting, ask the rental company for the plated weight and check it against your licence before you pay a deposit. Some older licences carry extra entitlements and some newer ones do not, so look at your own card rather than relying on what a friend with a similar van told you.

## Tolls, speed and where you may drive

Many countries set tolls by weight class, and a motorhome over the line can be charged like a small lorry. Some road tolls are a sticker, some are a gantry that reads a device in the cabin, and the weight class decides which device and which price. Speed limits for heavier vehicles are often lower on motorways and sometimes on country roads too.

Weight also decides where you can go at all. City centres, mountain passes, old bridges and some coastal roads post weight limits, and a satnav built for cars will not know about them. Plan the last few kilometres to a place by looking at the road, not just the pin.

## The part nobody likes: payload

Heavier does not mean you may load more. Water, gas, bikes, a generator, a full family and a week of food all count against the payload. It is very easy to be over the plated weight while feeling you packed lightly. If you have the option, drive onto a public weighbridge once, fully loaded, before a long trip. It costs little and removes a guess.

## Before you commit

- Read the maximum permissible mass off the papers, not the brochure.
- Match it to your licence category.
- Ask how tolls will be charged in the countries you plan to cross.
- Weigh the van loaded, at least once.

None of this is a reason to avoid a bigger camper. It is a reason to decide on purpose.`,
  },
  {
    slug: 'reading-overnight-parking-rules',
    daysAgo: 7,
    title: 'How to read the overnight parking rules in a new country',
    description:
      'Rules for sleeping in a vehicle differ from country to country and often from town to town. Here is how to read the signs and find the real answer.',
    body: `There is no single European rule for sleeping in a camper by the side of the road. National law sets a frame, regions and municipalities fill it in, and a sign at the edge of a car park has the last word. The same night can be fine in one valley and fined in the next.

## Resting is not camping

A distinction that appears in many places is between resting in a vehicle and camping. Resting usually means you are parked legally, you are inside, and you leave in the morning. Camping tends to mean awning out, chairs and a table, levelling blocks, a grill, anything that suggests you have settled in. Where the law draws that line, the second set of behaviours is what gets people moved on.

Never assume that being allowed to park for a few hours means you may stay overnight. Time limits on signs and sleeping rules are separate questions.

## Signs worth knowing

A crossed-out tent or caravan symbol is a clear no. A blue parking sign with a time limit controls how long you may stay, not whether you may sleep. A sign for a motorhome service point or camper stop is the opposite signal: that place expects you. Local signs can say no overnight stays, no vehicles over a certain height, or no parking between certain hours. If a barrier or a height gauge sits at the entrance, it is there for a reason.

## Where the answer actually lives

For any country you plan to cross, look for three things.

- The national rule, usually published by the tourism authority or the motoring club.
- The local rule for the municipality where you plan to stop, often on the town website.
- The land rule: even where roadside parking is fine, private land, nature reserves, forests and shorelines often have their own limits.

Open data can help you find candidates, but it records what someone tagged on a map, not what is currently allowed. Treat a pin as a place to check, not a permission.

## Manners that keep the door open

Arrive late, leave early, take everything with you, and do not empty tanks or toilets anywhere that is not meant for it. Places stay tolerant of campers largely because earlier campers behaved. If someone asks you politely to move, move.`,
  },
  {
    slug: 'tourist-taxes-and-camping-fees',
    daysAgo: 5,
    title: 'Tourist taxes and camping fees: what you are actually paying for',
    description:
      'The nightly price is rarely the whole bill. How pitch fees, tourist taxes and extras fit together, and how to avoid surprises at the gate.',
    body: `You book a pitch at one price and pay at the barrier on the way out at a slightly different one. Nobody has cheated you. A camping bill is usually several separate things that are quoted in different ways.

## The parts of a bill

**The pitch.** The charge for the space itself. It is often quoted per night and may depend on the size of your vehicle, whether you have a tent or an awning, and whether the pitch has electricity.

**People.** Many sites charge per adult, with a different rate for children and sometimes for visitors who come for the day. Pets can be a line of their own.

**Tourist tax.** This one is not set by the site. It is a local charge decided by the municipality or region and collected on its behalf, usually per person per night. Who is exempt, from what age, and for how many nights varies a lot. The site can only tell you the local rule; it cannot waive it.

**Extras.** Electricity, hot showers, laundry, a token for the washing machine, an extra vehicle, a visitor car, a deposit for a gate card. These are often the lines that surprise people.

## Why two sites in the same town can differ

Because the tourist tax is local, two sites in the same municipality charge the same tax. Because the pitch fee is the site's own decision, it can differ widely. Compare the whole total for the same group over the same nights, not the headline nightly figure.

## Paying for a night at a camper stop

Simple stops for motorhomes often sell a night as one package, and services such as water or waste disposal may be paid separately by token or coin. Check whether the price includes the services before you assume it does.

## How to avoid surprises

- Ask what is included before you sign in, not after you pack.
- Ask separately about the tourist tax, who it applies to and whether it is paid here or at the end.
- Carry a little cash; not every small site takes cards, and not every token machine does.
- Keep the receipt until you have left the country.

We do not list prices on CampTribe unless we hold a source for them, and we say so when we do not. The number on the gate is the one that counts.`,
  },
  {
    slug: 'when-to-go-camping-seasons-in-europe',
    daysAgo: 3,
    title: 'When to go: how the seasons change camping in Europe',
    description:
      'Opening seasons, crowds, weather and daylight all shift through the year. A practical way to choose your months without relying on a single number.',
    body: `Europe is wide enough that the best month for camping in one country is a poor one in another. Instead of a table of dates, it helps to know what actually changes through the year.

## Opening seasons

Many campsites open only for part of the year. Coastal and holiday sites often close in winter, some mountain sites flip between a summer and a ski season, and city camp stops may stay open all year. Opening dates are one of the facts most likely to be out of date on any map, ours included, so confirm with the site before you drive a long way for a night.

## Crowds and prices

School holidays move the crowds. Places on the coast and by lakes fill first, and in the busiest weeks a short notice booking can be hard. Shoulder months, the weeks just before and after the main holidays, tend to be quieter and often cheaper, with the trade-off that some facilities may be closed and the weather is less settled.

## Weather and daylight

Heat in southern regions can be hard on a camper without shade, and it brings its own risks, especially wildfire in dry spells. Mountain weather changes fast at any time of year, and high passes can close well outside winter. In the north, daylight stretches long in summer and shrinks sharply in autumn, which matters when you plan arrivals.

Water points and some service points are drained in cold weather to protect pipes. If you depend on a fill-up or a dump station, check that it is working in the month you plan to travel.

## Choosing a month

- Start from what you want to do: swim, hike, ski, see cities, or simply drive.
- Check the holiday calendar of the countries you cross, including your own.
- Look at the live conditions before you leave: official weather warnings, and where relevant wildfire and bathing-water reports.
- Have a second option for the same week in case the first is closed or full.

The best season is the one that fits your plan and your comfort, not the one in the brochure.`,
  },
  {
    slug: 'electricity-and-gas-on-campsites',
    daysAgo: 1,
    title: 'Electricity and gas on campsites: plugs, limits and bottles',
    description:
      'The hook-up cable, the amp limit and the gas bottle that will not connect: what to bring and what to check before you travel.',
    body: `Two things catch out first-time campers more than any road: the electric hook-up that does not fit, and the gas bottle that cannot be refilled. Both are easy to sort out in advance.

## Electricity

Most campsites offer a mains hook-up at the pitch, and the standard connector is a blue round plug in the CEE style. You need a cable with the matching plug and socket, long enough to reach a pole that may be several metres from where you park. Bring more length than you think and keep the cable uncoiled when in use, because a coiled cable can overheat under load.

Each hook-up has a limit, expressed in amps, and it can be low on older or simple sites. A kettle, a heater and an air conditioner running at once will trip it. Know what your appliances draw, switch the big ones on one at a time, and expect to reset a breaker now and then.

An adapter can help where the pole has a different socket, and a polarity tester is cheap and worth having. If something feels wrong with a hook-up, do not use it and tell the site.

Solar panels and a good battery reduce how much you depend on any of this, but they do not replace a hook-up for heavy loads.

## Gas

Gas is where countries differ most. Bottle sizes, valve types and the gas itself vary, and a bottle bought in one country often cannot be exchanged in another. Many exchange schemes are tied to a particular brand and country.

Practical ways around this are a refillable tank, a set of adapters for the countries you will cross, or a fixed system that you can fill from a pump. Whichever you pick, check it before the trip, not on the first cold evening.

Keep gas bottles upright and secured, store them in the vented locker designed for them, and have the system checked on schedule. If you ever smell gas, shut it off at the bottle, open everything and keep flames and switches away.

## A short checklist

- A correct, long hook-up cable and a tester.
- Knowledge of what your appliances draw.
- Adapters or a refillable gas system suited to the countries you cross.
- A working detector for smoke and for gas.

Ask the site what its hook-up limit is before you pitch. We do not publish amp limits unless a source states them, and we say so when none does.`,
  },
];

export class SeedTestBlogPosts1796500000000 implements MigrationInterface {
  name = 'SeedTestBlogPosts1796500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of TEST_POSTS) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM pages WHERE type = 'post' AND slug = $1`,
        [p.slug],
      );
      if (existing.length > 0) continue;

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, author_name, sort, noindex)
         VALUES ($1, 'post', 'published', now() - make_interval(days => $2::int), 'CampTribe', 0, false)
         RETURNING id`,
        [p.slug, p.daysAgo],
      );
      const pageId = page[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations (page_id, language_code, title, meta_description)
         VALUES ($1, 'en', $2, $3)`,
        [pageId, p.title, p.description],
      );

      const prose: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, visible)
         VALUES ($1, 0, 'prose', true) RETURNING id`,
        [pageId],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations (section_id, language_code, body)
         VALUES ($1, 'en', $2)`,
        [prose[0].id, p.body],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = TEST_POSTS.map((p) => p.slug);
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE type = 'post' AND slug = ANY($1))`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE type = 'post' AND slug = ANY($1)`,
      [slugs],
    );
  }
}
