import { MigrationInterface, QueryRunner } from 'typeorm';
import { SeedLegalPages1792800000000 } from './1792800000000-SeedLegalPages';

/**
 * Сторінка «Data and attribution» 1.0 → 1.1: дванадцять джерел, які сайт
 * показує і яких сторінка не називала.
 *
 * 🔴 ЧОМУ ЦЕ ЛІЦЕНЗІЯ, А НЕ РЕДАКТУРА. 1.0 (23.09.2026) обіцяла назвати
 * «exactly what, from whom, and under which licence» і називала сім
 * джерел. Заміряно 01.11.2026 тестом `apps/web/tests/unit/
 * attribution-sources.spec.ts` проти відданого HTML: 33 із 38 хостів
 * джерел у коді не мали на сторінці жодного посилання. CC BY 4.0, Licence
 * Ouverte, IODL 2.0, умови CEMS і MeteoAlarm дають право показувати чужі
 * дані ЗА УМОВИ атрибуції — отже сторінка, що її не несе, означає дані,
 * показані без виконання умови, за якої ми маємо право їх показувати.
 *
 * Що додано (ліцензія кожного прочитана з першоджерела 01.11.2026, крім
 * названих нижче):
 *   · супутникові тайли IGN España (PNOA; `ows:AccessConstraints` =
 *     «CC BY 4.0 scne.es», перечитано з GetCapabilities) та IGN France
 *     (BD ORTHO®; `mco:otherConstraints` = «Licence Ouverte / Open License»,
 *     перечитано з CSW-запису Géoplateforme); Нідерланди — чому вимкнено;
 *   · EEA bathing water і EEA Air Quality Index — CC BY 4.0 (правова
 *     нота EEA: «EEA materials are published under the CC-BY license»,
 *     акноледж у кожній копії, зміст не спотворювати);
 *   · MeteoAlarm — умови від 15/03/2024, прочитані в браузері (сторінка —
 *     SPA): «equivalent to CC BY 4.0» плюс сім вимог розділу 5, і три
 *     набори меж, якими код площі попереджень кладе на кемпінги:
 *     геокоди MeteoAlarm (gitlab.com), контури хорватських повітів з
 *     OpenStreetMap, Natural Earth admin-1 (public domain). NUTS від Eurostat
 *     GISCO тут БУЛИ (умови: «© EuroGeographics…» і «not … for commercial
 *     purposes»); PR #398 прибирає їх із конвеєра, тож сторінка їх не несе —
 *     див. застереження про порядок злиття в `attribution-sources.spec.ts`;
 *   · Copernicus EDO (CDI) — умови CEMS, нота «Contains modified …»;
 *     EFFIS/GWIS — CC BY 4.0 (сторінка data-license) і ті самі умови;
 *   · ціни пального: Weekly Oil Bulletin Європейської комісії (правова
 *     нота Комісії: CC BY 4.0, Рішення 2011/833/EU), Іспанія (загальні
 *     умови datos.gob.es — сторінка самого набору відповіла 403, тож
 *     ліцензія набору взята із загальних умов, як і в `fuel/stations.ts`),
 *     Франція (Licence Ouverte 2.0), Італія (IODL 2.0);
 *   · вебкамери Windy — єдине НЕвідкрите джерело; умови Webcams API:
 *     назвати джерело видимо, кожне зображення — посилання на Windy,
 *     без сканування й історії;
 *   · у наявних розділах — хости, з яких дані справді читаються
 *     (tiles.openfreemap.org, naciscdn.org, api.open-meteo.com), бо тест
 *     звіряє хости, а не назви;
 *   · у розділі DATAtourisme — data.gouv.fr (регіональні файли,
 *     `fetch-regions.mjs`): хост, якого не було в списку `SOURCE_FILES` і який
 *     знайшов лише суцільний обхід (`attribution-sweep.ts`). Каталог v1
 *     (api.datatourisme.fr, `api-v1.ts`) на сторінці НЕ названий навмисно:
 *     модуль не підключено (CAMP-181), а сторінка описує те, що ми робимо.
 *     Версія лишається 1.1: текст ще не опубліковано.
 *
 * 🔴 ТА САМА ДИСЦИПЛІНА, ЩО В ПРИВАТНОСТІ 2.1–2.3: текст живе в базі
 * (CAMP-365), версію підіймає міграція разом із реєстром `lib/legal.ts`;
 * три випадки — 1.0 → оновити, 1.1 → нічого, інше → падіння з назвою
 * (чужий текст не перезаписується). `pages/legal-seeded.ts` накладає це
 * тіло на посів для тестів.
 */
export class AttributionSources1793700000000 implements MigrationInterface {
  name = 'AttributionSources1793700000000';

  /** Те, що посів поклав у базу — береться з його міграції, не передруковується. */
  readonly previous = (() => {
    const seeded = (
      new SeedLegalPages1792800000000() as unknown as {
        pages: Array<{
          slug: string;
          title: string;
          summary: string;
          version: string;
          effectiveFrom: string;
          body: string;
        }>;
      }
    ).pages.find((p) => p.slug === 'attribution');
    if (!seeded)
      throw new Error('SeedLegalPages: немає сторінки «attribution»');
    return seeded;
  })();

  readonly page = {
    slug: 'attribution',
    title: 'Data and attribution',
    summary:
      'Where every map, boundary, reading and price on this site comes from, and the licences we are bound by.',
    version: '1.1',
    effectiveFrom: '2026-11-02',
    body: `Almost everything on this site is built from open data. This page says exactly what, from whom, and under which licence — both because we are required to and because you should be able to check us. The one source that is not open data, the webcams, is named at the end. Where your browser fetches something from one of these providers directly, the [privacy](/legal/privacy#who-else) page says what that provider sees.

## Campsites, and the map {#osm}

Campsite locations, names and facilities come from [OpenStreetMap](https://www.openstreetmap.org/), © OpenStreetMap contributors, available under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/). The country extracts we import are prepared by [Geofabrik](https://download.geofabrik.de/).

> **If you take this data, the licence goes with it.** You may copy, adapt and use it, including commercially. What you owe in return depends on what you make:
>
> If you publish an adapted **database**, ODbL’s share-alike applies and you must offer that database under ODbL too. If you publish something produced *from* the data — a map image, a printed guide — that work does not itself become ODbL, but it must carry a notice saying it came from an ODbL database. Either way, OpenStreetMap contributors are credited, and you may not use technical measures to stop others exercising the same rights.
>
> Those conditions bind us exactly as they bind you, and neither of us can set them aside in terms of use. [How this database is made](/legal/database) is the description of our own alterations that §4.6 entitles you to, and it says how to ask for the data itself instead. The [licence text](https://opendatacommons.org/licenses/odbl/1-0/) is the authority; this paragraph is a summary and nothing more.

### What we added

Distance to the nearest water, town, supermarket and railway stop, the terrain description and the relief figure are computed by CampTribe from the sources on this page. They are our derivation, they carry the licences of what they were derived from, and they are estimates — see the [terms of use](/legal/terms).

## French campsites: names, descriptions and stars {#datatourisme}

Campsites in France also come from [DATAtourisme](https://www.datatourisme.fr/), France’s national tourism data platform, whose records are written by regional tourist offices and aggregated by ADN Tourisme. We read it from the regional files the platform publishes on [data.gouv.fr](https://www.data.gouv.fr/). It is published under the [Licence Ouverte 2.0 (Etalab)](https://www.etalab.gouv.fr/licence-ouverte-open-licence/), which permits commercial reuse worldwide and asks for attribution in return.

It gives us three things OpenStreetMap does not carry at all: the campsite’s own description, its **official star classification** — the French state rating, not ours — and, for most sites, the operator’s website.

> **The licence asks for the date, not only the name.** It says a reuse must not mislead anyone about the information, its source or its date of last update. The records we hold were last touched anywhere between January 2022 and this week, so a single notice at the foot of the site would do exactly that. Every campsite page therefore carries its own “where this comes from” block naming the source, the licence, which fields came from it and the day that source last changed them — and says so plainly when nothing has changed in over two years.

We do not translate those descriptions. They are quoted as published, in French, marked as French so that a screen reader pronounces them properly. A machine translation of somebody else’s words, printed as though it were theirs, would be the kind of invention this site exists not to do.

## Background map tiles {#tiles}

Map imagery is served by [OpenFreeMap](https://openfreemap.org/) from [tiles.openfreemap.org](https://tiles.openfreemap.org/), using the [OpenMapTiles](https://openmaptiles.org/) schema, from OpenStreetMap data — © OpenStreetMap contributors, ODbL. The map is drawn in your browser by [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause).

## The satellite view {#satellite}

The satellite view is off until you switch it on, and it exists for two countries. Each is the national mapping agency’s own orthophoto, loaded by your browser from that agency’s service, and the credit under the map is the one the agency asks for.

Over **Spain** the imagery is the PNOA orthophoto of the Instituto Geográfico Nacional, served from [www.ign.es](https://www.ign.es/wmts/pnoa-ma?request=GetCapabilities&service=WMTS) under **CC BY 4.0** — the service’s own capabilities document states its access constraints as “CC BY 4.0 scne.es”, and the map says: *Orthophoto © Instituto Geográfico Nacional de España (PNOA), CC BY 4.0 scne.es*. The same document says that the imagery over Melilla is Pléiades Neo © Airbus DS, not IGN’s. Melilla is outside what we offer; if that ever changes, those tiles carry Airbus’s terms, not CC BY.

Over **France** it is IGN’s BD ORTHO®, served from the Géoplateforme at [data.geopf.fr](https://data.geopf.fr/csw?REQUEST=GetRecordById&SERVICE=CSW&VERSION=2.0.2&OUTPUTSCHEMA=http://standards.iso.org/iso/19115/-3/mdb/2.0&elementSetName=full&ID=IGNF_BD-ORTHO) under the **Licence Ouverte / Open License**, as the dataset’s catalogue record states; the service points to [cartes.gouv.fr](https://cartes.gouv.fr/cgu) for its conditions of use. The map says: *Orthophoto © IGN (BD ORTHO®), Licence Ouverte / Open License*.

There is no satellite view elsewhere. The Dutch orthophoto service ([PDOK](https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0)) answers, but it declares no licence and we have not read one from the publisher, so it stays off. A server that answers is not a permission.

## Regions and boundaries {#boundaries}

Which region a campsite belongs to is resolved against [Natural Earth](https://www.naturalearthdata.com/) administrative boundaries, downloaded from its distribution at [naciscdn.org](https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip), which are in the public domain. Natural Earth generalises coastlines, so a campsite on a spit or an island may sit just outside its own region’s drawn outline; we assign it to the nearest boundary within five kilometres rather than leaving it without a region.

## Elevation and terrain {#elevation}

Height above sea level and the relief figure come from the [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) at 90 m resolution, reached through [Open-Meteo](https://open-meteo.com/)’s elevation endpoint at [api.open-meteo.com](https://api.open-meteo.com/), whose data Open-Meteo provides under CC BY 4.0. Produced using modified Copernicus data.

At 90 m a single reading is a description of the neighbourhood, not of the pitch. Treat metres as approximate.

## Bathing water {#bathing}

Where a campsite is near an officially designated bathing water, its page shows that water’s classification under the EU Bathing Water Directive, as the member states report it to the [European Environment Agency](https://www.eea.europa.eu/en/datahub/datahubitem-view/c3858959-90da-4c1b-b9ca-492db0e514df). We read it from the EEA’s map service at [water.discomap.eea.europa.eu](https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer?f=json).

The licence is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The grant sits on the season’s versioned catalogue record rather than on the parent page, which lists no licence at all — worth knowing if you check us. The EEA’s [legal notice](https://www.eea.europa.eu/en/legal-notice) says the same of its materials generally: reuse is free, for commercial or non-commercial purposes, on condition that the EEA is acknowledged as the source in each copy and that the meaning is not distorted.

There is one classification per bathing season, from at least four samples taken across it. The page prints the season and the day that edition was published — and nothing else: it is not a reading for today.

## Air quality {#air}

The air quality figure on a campsite page is the EEA’s [European Air Quality Index](https://airindex.eea.europa.eu/AQI/index.html): an hourly index per monitoring station, from concentrations the member states report to the EEA, and a 1 km model for places with no station nearby. We read the hourly station file from the EEA’s storage at [dis2datalake.blob.core.windows.net](https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans) and the model from its image service at [air.discomap.eea.europa.eu](https://air.discomap.eea.europa.eu/arcgis/rest/services/AQMobile_2025/MOSAIC_GLOBAL_AQI/ImageServer).

The licence is CC BY 4.0: the EEA’s catalogue names it for the concentrations the index is built from, and the legal notice above makes acknowledgement of the EEA a condition of reuse. The index itself has no catalogue record of its own, and nothing on it says otherwise.

The hour the value describes is printed beside it, and so is the time we read the file. When there is nothing fresh, the page says so instead of showing an old number as if it were now.

## Weather warnings {#warnings}

Official severe-weather warnings come from [MeteoAlarm](https://www.meteoalarm.org), the warning dissemination system of the European national meteorological and hydrological services, run for EUMETNET by GeoSphere Austria. We read the national feeds at [feeds.meteoalarm.org](https://feeds.meteoalarm.org/).

MeteoAlarm’s [terms and conditions](https://meteoalarm.org/en/live/page/terms-and-conditions) (last updated 15 March 2024) allow the information to be used and redistributed under terms equivalent to CC BY 4.0, with requirements that the panel on each page meets: a warning from one country names its national service; information spanning more than one country is sourced as “EUMETNET – MeteoAlarm”; the time of issue is shown; every panel links to www.meteoalarm.org; and the following disclaimer is published word for word: *“Time delays between this website and the www.meteoalarm.org website are possible. For the most up-to-date awareness information as published by the participating National Meteorological and Hydrological Services, please refer to www.meteoalarm.org.”* The warning is theirs; we add nothing to it, and we never say on our own account that a place is dangerous.

### Which campsite a warning concerns

A warning names its area by a code, not by a shape. To place campsites inside those areas we use three sets of boundaries — once, when the database is built; none of them is drawn on the map:

- MeteoAlarm’s own geocode file, published by the MeteoAlarm programme on [gitlab.com](https://gitlab.com/meteoalarm-pm-group/documents), for the countries whose warnings use its codes, and — matched by zone name — for those whose warnings use NUTS codes;
- the outlines of Croatia’s counties, from [OpenStreetMap](https://www.openstreetmap.org/) under the licence named above, because MeteoAlarm’s own list does not carry Croatia’s counties;
- Natural Earth’s admin-1 boundaries, read from its repository at [raw.githubusercontent.com](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson), public domain, for Ireland.

## Drought {#drought}

The drought layer on the map is the Combined Drought Indicator of the European Drought Observatory, part of the Copernicus Emergency Management Service, read from [drought.emergency.copernicus.eu](https://drought.emergency.copernicus.eu/) and published once every ten days — so a reading two or three weeks old is the newest there is.

The Copernicus Emergency Management Service [terms and conditions](https://drought.emergency.copernicus.eu/terms&conditions) grant free access to the data for reproduction, distribution, communication to the public and adaptation, and ask that adapted data carry this notice: **Contains modified Copernicus Emergency Management Service information 2026** — with the current year, which the layer prints. Ours is adapted data: we cut it to the EU-27 and colour it in our own palette. The same terms say that the information “does not constitute in any way an early warning”, which only national and regional institutions are authorised to issue — which is why nothing beside this layer uses those words.

## Wildfires {#wildfires}

Burnt areas of the last fourteen days come from the European Forest Fire Information System (EFFIS) and the Global Wildfire Information System (GWIS) of the same Copernicus service, read from [maps.effis.emergency.copernicus.eu](https://maps.effis.emergency.copernicus.eu/effis). EFFIS publishes its data under [CC BY 4.0](https://forest-fire.emergency.copernicus.eu/about-effis/data-license) and under the Copernicus terms above, so the layer carries both: *Copernicus EFFIS/GWIS, © European Union, licensed CC BY 4.0*, and the modified-data notice. The perimeters map scars of roughly thirty hectares and up; the layer is cut to the EU-27.

## Fuel prices {#fuel}

**Country averages.** The trip cost calculator uses the petrol and diesel averages of the European Commission’s [Weekly Oil Bulletin](https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en), with the bulletin’s date printed beside them. Under the Commission’s [legal notice](https://commission.europa.eu/legal-notice_en) its documents are reusable under CC BY 4.0, provided appropriate credit is given and changes are indicated; the credit is *© European Union*, and the change is that we print two columns of a spreadsheet.

**Prices at the pump.** Route pages show the price at individual stations in three countries, each from the ministry that publishes it, with the source and the day it was read beside every price:

- **Spain** — the Ministerio para la Transición Ecológica y el Reto Demográfico’s [Geoportal de Gasolineras](https://geoportalgasolineras.es/) and read from [sedeaplicaciones.minetur.gob.es](https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/), under the [general conditions of reuse](https://datos.gob.es/es/aviso-legal) of datos.gob.es, which permit commercial and non-commercial reuse and ask for the source, the date of last update, and that the meaning not be distorted.
- **France** — the Ministère de l’Économie et des Finances’ [prix-carburants.gouv.fr](https://www.prix-carburants.gouv.fr/), read from [data.economie.gouv.fr](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/), under the Licence Ouverte 2.0.
- **Italy** — the [Ministero delle Imprese e del Made in Italy](https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti), whose public search is [carburanti.mise.gov.it](https://carburanti.mise.gov.it/ospzSearch/), under the [Italian Open Data Licence 2.0 (IODL)](https://www.dati.gov.it/content/italian-open-data-license-v20), which permits commercial reuse and asks for the source and the licensor to be named.

No other country’s pump prices are shown. Where we have found no licence that permits publishing them, we do not — an endpoint that answers is not a permission.

## Webcams {#webcams}

This is the one source on this page that is not open data. Where a campsite page shows nearby public webcams, the cameras are found through the Webcams API of Windyty, SE at [api.windy.com](https://api.windy.com/webcams/docs), and the still frames load in your browser from [imgproxy.windy.com](https://imgproxy.windy.com/) at the moment you look — we store no images. Windy’s [terms of use](https://api.windy.com/webcams/terms) for the API require that the source be stated visibly, that every image link to Windy’s own page for it, and that nobody scan a significant number of cameras or download their image history. That is the credit **Webcams provided by windy.com** under the frames, the link on every frame, and one request per region when we look. The pictures belong to [Windy](https://www.windy.com/) and to the camera operators it names.

## Typefaces {#type}

Text is set in **Archivo** and **Archivo Narrow** by Omnibus-Type, released under the [SIL Open Font License](https://openfontlicense.org/), and served from our own domain rather than from a font network — so reading this page tells nobody else that you did.

The labels drawn on the map itself are set in Noto Sans, which comes from the tile provider along with the imagery, not from us.

## Something wrong on the map? {#wrong}

If a campsite is missing, closed or described incorrectly, the most useful thing you can do is fix it [at OpenStreetMap](https://www.openstreetmap.org/) — the correction then reaches this site and every other one built on the same data, usually within a week.

You are also welcome to write to [{{company.email}}](mailto:{{company.email}}), including if you are the owner of a campsite listed here.`,
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
        'legal_pages «attribution»: немає рядка з англійським текстом, який ця ' +
          'міграція має оновити. Міграція 1792800000000 мала його створити; ' +
          'без нього тут нема що підіймати до 1.1.',
      );
    }
    const body: string = row.body;
    if (body === this.page.body && row.version === this.page.version) return;
    if (body !== this.previous.body) {
      throw new Error(
        `legal_pages «attribution» містить текст, якого ця міграція не знає ` +
          `(${body.length} символів, версія ${row.version}; очікувала 1.0, ` +
          `${this.previous.body.length} символів). Правовий документ не перезаписується ` +
          'мовчки: вирішіть, чия редакція чинна, і або приведіть базу до 1.0, або ' +
          'внесіть правку в текст 1.1 цієї міграції.',
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
      `UPDATE legal_page_translations SET title = $2, plain_summary = $3, body = $4
        WHERE legal_page_id = $1 AND language_code = 'en'`,
      [
        rows[0].id,
        this.previous.title,
        this.previous.summary,
        this.previous.body,
      ],
    );
    await queryRunner.query(
      `UPDATE legal_pages SET version = $2, effective_from = $3 WHERE id = $1`,
      [rows[0].id, this.previous.version, this.previous.effectiveFrom],
    );
  }
}
