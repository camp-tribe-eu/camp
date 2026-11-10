/**
 * Одна країна оренди для юніт-тестів — CAMP-479.
 *
 * 🔴 ФОРМА ТУТ — ТА, ЩО ВІДДАЄ API, а не та, що була у файлі: без
 * `data` і `definiteArticle`, бо вони лишились у коді й домішуються
 * вже на боці бібліотеки. Фікстура, яка повторює стару форму, зеленіла
 * б там, де справжня відповідь уже інша.
 *
 * Дані зняті з першої справжньої країни на день переїзду — щоб
 * поведінка тестів не змінилась разом із джерелом.
 */
export const RENTAL_COUNTRY_FIXTURE = {
  code: "de",
  name: "Germany",
  angle:
    "The Stellplatz network, a motorway toll that does not apply to you, and a winter tyre rule with no dates in it.",
  intro:
    "Germany is the country where the overnight stopping place — the Stellplatz — is a piece of ordinary municipal infrastructure rather than an enthusiast’s discovery. That changes how a rental trip is planned here: the question is less often “which campsite” and more often “which town has a place to put the van”. Two of the three rules below are about the vehicle rather than about you, which means the answers are the rental company’s to give, and they are worth asking for before you sign.",
  dataIntro:
    "The Stellplatz is not folklore, and it is the one claim on this page we can put a number against:",
  facts: [
    {
      title: "The motorway toll is not yours to pay",
      body: "Germany sells no vignette. The German toll falls on motor vehicles over 3.5 tonnes that are intended for, or are being used for, the carriage of goods — that is the test Toll Collect publishes, and a privately hired motor caravan is neither. So there is nothing for you to buy before you join the autobahn, and if a rental desk offers to sell you a German road pass, something is wrong.",
      source: {
        name: "Toll Collect — vehicles subject to toll",
        url: "https://www.toll-collect.de/en/toll_collect/rund_um_die_maut/mautpflichtige_fahrzeuge/mautpflichtige_fahrzeuge.html",
      },
    },
    {
      title: "The low-emission badge belongs to the vehicle, not to you",
      body: "German low-emission zones are entered on a windscreen badge — the Umweltplakette — which is issued against the vehicle’s emissions class. A diesel camper of a certain age carries a certain colour and no amount of planning on your side changes it. Ask which badge the vehicle has before you plan a city stop around it.",
      source: {
        name: "Umweltbundesamt (German Environment Agency)",
        url: "https://www.umweltbundesamt.de/",
      },
    },
    {
      title: "Winter tyres are required by the weather, not by the calendar",
      body: "Section 2(3a) of the German road traffic regulations ties winter tyres to conditions — black ice, packed snow, slush, ice or frost — and names no dates at all. A camper handed over in mild October weather can be illegal on an Alpine approach the same afternoon, and the obligation sits with the driver.",
      source: {
        name: "StVO § 2, Gesetze im Internet (Federal Ministry of Justice)",
        url: "https://www.gesetze-im-internet.de/stvo_2013/__2.html",
      },
    },
  ],
};
