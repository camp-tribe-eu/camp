# Права на дані: ліцензії джерел, sui generis, ODbL

## A2 — аудит ODbL share-alike. Зроблено 04.10.2026

Питання було відкрите з CAMP-87 і формулювалось як «чи зобов'язує нас
share-alike». **Текст ліцензії на головне питання відповідає сам.**
Цитати нижче — з `opendatacommons.org/licenses/odbl/1-0/`, читано
04.10.2026.

### Крок 1. Чи є в нас Derivative Database

> **Derivative Database** — "a database based upon the Database, and
> includes any translation, adaptation, arrangement, modification, or any
> other alteration of the Database or of a Substantial part of the
> Contents."

Ми беремо кемпінги OSM, зводимо з DATAtourisme, дораховуємо відстані,
рельєф і звірку, кладемо в PostgreSQL. Це **модифікація й адаптація
суттєвої частини**. Так, це Derivative Database — без натяжок.

### Крок 2. Чи рятує нас «Produced Work»

Рятує частково, і саме тут була наша надія:

> §4.5: "Using this Database, a Derivative Database ... to create a
> **Produced Work** does not create a Derivative Database for purposes of
> Section 4.4"

Тобто сторінки сайту — твір, і сам факт їхнього створення share-alike не
вмикає.

🔴 **Але наступне речення §4.4 закриває цей вихід:**

> "A Derivative Database **is Publicly Used** and so must comply with
> Section 4.4 **if a Produced Work created from the Derivative Database is
> Publicly Used**."

Тобто публікація сайту **сама по собі** робить нашу базу «публічно
використаною». Produced Work не ізолює базу — він її викриває.

### Крок 3. І окремо — ми віддаємо не лише твір

`apps/web/src/app/data/spots/[country]/[chunk]/route.ts` роздає **812
файлів GeoJSON**, і в кожному `chunkBody` кладе:

```
coordinates [lon, lat], slug, name, type, href, amenities
```

на всі **61 557** кемпінгів.

Це не «image, audiovisual material, text, or sounds». Це **дані**. За
визначенням:

> **Re-utilisation** — "any form of making available to the public all or
> a Substantial part of the Contents by ... online or other forms of
> transmission."

Отже навіть без ланцюга з кроку 2 ми публічно використовуємо похідну базу
прямо.

### Крок 4. Що з цього випливає як обов'язок

**§4.4** — похідна база має бути **під ODbL** (або сумісною ліцензією).

**§4.6** — треба **запропонувати** одержувачам машиночитану копію:

> "The entire Derivative Database; **or** A file containing all of the
> alterations made to the Database or the method of making the
> alterations to the Database (such as an algorithm), including any
> additional Contents ... free of charge if distributed over the internet."

Тобто є **вибір**: або дамп, або опис змін. Другий варіант дешевший і
цілком законний.

### Крок 5. Чого ці норми НЕ вимагають

Це важливо не менше за те, чого вони вимагають:

| міф | що насправді |
| --- | --- |
| «доведеться відкрити код» | ODbL — ліцензія на **базу даних**, не на програму |
| «доведеться віддати чужі дані» | §4.4: не можна додавати **несумісний** контент; віддавати чуже воно не змушує |
| «доведеться віддати все, що ми нарахували» | достатньо **або** бази, **або** файлу змін |
| «це вмикається вже» | вмикається на **Public Use**; ми не в проді |

### Стан: **сьогодні порушення немає, завтра було б**

Ми нічого не порушуємо, **бо не опублікували**. У день публікації — так,
обов'язок вмикається, і виконувати його треба того ж дня, а не потім.

### Що лишається юристу — питання звузилось

Не «чи діє share-alike» (текст відповів), а межа:

> Наша похідна база зводить OSM (ODbL 1.0), DATAtourisme (Licence Ouverte
> 2.0) і EEA (CC BY 4.0) в одну таблицю. Чи достатньо запропонувати за
> §4.6 лише OSM-похідну частину? Чи не робить додавання контенту під
> Licence Ouverte і CC BY порушенням застереження §4.4 про «Contents ...
> incompatible with the rights granted under this License»?

### Найдешевший відповідний шлях

1. Сторінка з описом змін (що взяли з OSM, що дорахували, яким способом) —
   це виконує §4.6 b.
2. Рядок про ODbL на похідну базу поруч із наявною атрибуцією.
3. За бажанням — дамп OSM-похідної частини окремим файлом.

День роботи, не місяць. **Дешево, поки робиться заздалегідь**, і дорого,
якщо робиться після скарги.

---

## Решта джерел

Реєстр закритих — у `open-questions.md`, розділ D.
