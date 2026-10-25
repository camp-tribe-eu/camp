# Лист до MeteoAlarm про MQTT — готовий до надсилання

🔴 **Картка CAMP-263 стверджувала, що цей лист уже написаний і лежить «у теці листування».**
Заміряно 25.10.2026: такої теки немає, тексту не існувало. Картка чотири тижні чекала на дію,
для якої нічого не було готово. Написано тепер.

## Кому

| | |
|---|---|
| **Кому** | `meteoalarm@geosphere.at` |
| **Копія** | `vojtech.andrs@geosphere.at` |
| **Від** | адреса, з якої велося листування раніше |
| **Тема** | `CampTribe — follow-up on MQTT access for MeteoAlarm warnings` |

## Текст листа

---

Dear Vojtěch, dear MeteoAlarm team,

Thank you for suggesting MQTT instead of polling the REST feed. We would like to take that
route, and I have a few questions before we build against it.

For context: CampTribe is a non-commercial European campsite directory. We show official
weather warnings next to campsite pages so that travellers see them before they set off. We
already hold an access token from the earlier exchange.

Our constraint comes from the licence itself: warnings must reach the reader on average in
under five minutes and never later than ten. That rules out delivery through our static site
build, which is why MQTT matters to us.

**1. Connection.** What is the broker hostname and port, and is TLS required? Should we
expect a single long-lived connection, or do you prefer clients to reconnect periodically?

**2. Credentials.** Does the token we already hold work for MQTT, or is a separate username
and password issued for the broker?

**3. Topics.** How is the topic tree organised — by country, by region, by warning type? We
need all EU-27 countries. Is a single wildcard subscription acceptable, or would you rather
we subscribe per country?

**4. Payload.** Is the message body the same CAP XML as the REST feed, or a different
format? If it differs, is there a schema we can validate against?

**5. State on connect.** When we connect, do retained messages give us the warnings that are
currently in force, or do we only receive what is published from that moment on? If the
latter, what is the recommended way to obtain the current state without polling?

**6. Gaps.** If our client is disconnected for, say, twenty minutes, is there a way to
receive what we missed, or should we re-read the REST feed once after reconnecting?

**7. Limits.** Are there limits we should respect — number of concurrent connections,
subscriptions per connection, or an expected reconnect interval?

One more question about the licence rather than the protocol: we read clause 5.6 as a
requirement on the delay between your publication and our display. With MQTT we expect that
delay to be seconds. Would you consider a measured average, published by us, an acceptable
way to demonstrate compliance?

Thank you for the time, and for making the data available at all.

Kind regards,
Yurii Smortkin
CampTribe — camptribe.eu

---

## Чому ці сім питань, а не інші

Кожне закриває спосіб, яким реалізація могла б тихо зламатись:

| питання | що ламається без відповіді |
|---|---|
| 1, 2 | не підключимось узагалі |
| 3 | підпишемось не на всі країни й не помітимо — попередження просто не прийде |
| 4 | розбірник мовчки віддасть порожнечу на іншому форматі |
| **5** | 🔴 найважливіше: підключились під час шторму й **не бачимо його**, бо прийшло до нас |
| 6 | розрив зв'язку = дірка в попередженнях, про яку ніхто не дізнається |
| 7 | нас відключать за перевищення, і це теж виглядатиме як тиша |

🔴 **Питання 5 і 6 — про одне й те саме: тиша на нашому боці нерозрізненна від «попереджень
немає».** Саме та форма дефекту, на якій ми вже горіли: порожній вивід читається як спокій.

## Що буде далі

* Є відповідь → CAMP-241 розблокована, робимо підписку з заміром затримки.
* Немає за два тижні → нагадування, як робили з NDW, E-Control і ASFINAG.
