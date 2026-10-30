# infra/ — те, що робить сервер сервером

Юніти systemd і скрипти, які на машині лежать у `/etc/systemd/system`
і `/usr/local/bin`. Тут вони — джерело істини; на машині — копія.

## 🔴 Навіщо це тут

13.10.2026 `camptribe-backup.service` упав о 03:30 UTC:

```
camptribe-backup.service: Changing to the requested working directory failed
status=200/CHDIR
```

У юніті стояла `WorkingDirectory=/srv/camptribe/app` — тека, яку прибрав
деплой, що прокрутив релізи. Два інші юніти дивились у
`/srv/camptribe/current`; бекап лишився на старій розкладці й помер після
першого ж деплою. **Добу жили без бекапу й не знали** — падіння було
видно лише тому, хто подивиться в journal, а ніхто не дивився.

Знайшлось випадково. Виправлено текстовим редактором на машині — тобто
зміни не було ні в репозиторії, ні в рецензії, ні в історії.

## Що де

| файл | на машині |
| --- | --- |
| `systemd/camptribe-api.service` | API, `node dist/main`, порт 3001 |
| `systemd/camptribe-web.service` | `next start`, порт 3000, лише 127.0.0.1 |
| `systemd/camptribe-backup.service` | денний бекап контенту |
| `systemd/camptribe-backup.timer` | 03:30 UTC, `Persistent=true` |
| `systemd/camptribe-failed@.service` | 🔴 обробник падінь (CAMP-306) |
| `systemd/camptribe-freshness.service` | 🔴 який імпортер замовк (CAMP-170) |
| `systemd/camptribe-freshness.timer` | 06:00 UTC, `Persistent=true` |
| `systemd/camptribe-coverage-drift.service` | 🔴 чи досі правда таблиця заповненості, на якій стоять ваги планувальника (CAMP-262): `measure-coverage.js --check` |
| `systemd/camptribe-coverage-drift.timer` | 06:30 UTC, `Persistent=true` |
| `systemd/camptribe-osm-import.service` | 🔴 вівторок 04:30 UTC: `import-release.mjs --max-age-days 9` (останній реліз `osm-weekly` → `camping_spots`). `spot_links` тут немає навмисно — це вирок людини |
| `systemd/camptribe-osm-import.timer` | вівторок 04:30 UTC, `Persistent=true` (понеділкове будування екстрактів + доба запасу) |
| `systemd/camptribe-fuel-prices.service` | 🔴 щодня: `import-stations.js --report` (ES/FR/IT → `fuel_station_prices`) |
| `systemd/camptribe-fuel-prices.timer` | 05:00 UTC, `Persistent=true` |
| `systemd/camptribe-deploy-nightly.service` | 🔴 щонічний деплой: `camptribe-deploy-nightly` (від root; `Nice=10`; `TimeoutStartSec=45min`) |
| `systemd/camptribe-deploy-nightly.timer` | 13:00 UTC, `Persistent=true` — після найпізнішого заміряного старту `data-refresh` (див. нижче) |
| `bin/camptribe-deploy-nightly` | `ls-remote` main → порівняти з чинним релізом → `camptribe-deploy deploy --sha … --apply` лише якщо різні; без `--migrate`; не скасовує відкат |
| `bin/camptribe-backup` | бекап CSV + повний `pg_dump` (CAMP-386: інакше 208 обʼєктів `directus_*` і `project_id` ліцензії не бекапились) + **звірка вмісту** + 14 денних зрізів |
| `bin/camptribe-failed` | лишає слід у `/srv/camptribe/failed/<юніт>` |
| `bin/camptribe-deploy` | викладка, перевірка й відкат релізу (CAMP-61); зазвичай запускається з ноутбука через `deploy-app.sh` |

## 🔴 Як дані доходять до читача (ланцюг із трьох ланок)

1. **`data-refresh`** (GitHub, `cron 17 4 * * *`) збирає пожежі, посуху й
   ціни пального, відкриває PR **і сам його зливає**, якщо в diff лише
   три файли даних (`scripts/ci/data-pr-guard.mjs`).
2. **`camptribe-deploy-nightly.timer`** (машина, 13:00 UTC) питає публічний
   GitHub, чи змінився `main`, і лише тоді викликає `camptribe-deploy`.
   Не змінився — вихід 0 без збірки.
3. **`camptribe-deploy`** будує реліз поруч із живим, перемикає, перевіряє
   й сам відкочує. Відкат лишається таким, як у ручного деплою.

🔴 **Чому 13:00, а не 05:00.** GitHub запускає заплановані завдання з
запізненням: три заміряні прогони `data-refresh` стартували о 09:53, 10:39
і 10:57 UTC при розкладі 04:17 (`gh api repos/camp-tribe-eu/camp/actions/
workflows/data-refresh.yml/runs`). Деплой о 05:00 вивозив би вчорашні дані.

🔴 **Таймер ніколи не робить `--migrate`** — міграція це рішення людини;
без неї `camptribe-deploy` відмовить до збірки, юніт упаде, піде лист.
🔴 **Таймер не скасовує відкат:** якщо останній успішний крок історії —
`rollback`/`switch` З релізу, що збігається з `main`, він виходить
помилкою й чекає нового коміту або людини.

⚠ `deploy-infra.sh --apply` робить `enable --now camptribe-*.timer`, тобто
**ввімкне й цей таймер**. Файли лежать у репозиторії, поки це не запущено;
на машині нічого не ввімкнено.

## Деплой застосунку — окремо від юнітів

`deploy-infra.sh` розкладає юніти systemd. Код сайту викочується
`./infra/deploy-app.sh`, і за замовчуванням це **сухий прогін**. Усе, що
треба знати — що зараз на проді, як викотити, як відкотити, що з
міграціями — в [`docs/deploy.md`](../docs/deploy.md).

```bash
export CAMPTRIBE_HOST=root@…           # адреси машини в репозиторії немає навмисно
./infra/deploy-app.sh --status         # що зараз на проді
./infra/deploy.selftest.sh             # перевірка самої процедури, без сервера
```

## Як розкладати

```bash
./infra/deploy-infra.sh          # сухий прогін: що розійшлося
./infra/deploy-infra.sh --apply  # розкласти, daemon-reload, verify
```

Перезаписане лягає в `/root/infra-backups/<ім'я>.<дата>`.

## Як перевіряти

```bash
node scripts/ci/check-server-drift.mjs --offline  # у CI, без SSH
node scripts/ci/check-server-drift.mjs            # з машини, де є ключ
```

`--offline` питає те, на що вистачає репозиторію: чи посилається юніт на
щось, чого тут немає.

🔴 **До 14.10.2026 він не ловив власну причину смерті.** Заміряно: обидва
написання дефекту, що вбив бекап 13.10 — `WorkingDirectory=/srv/camptribe/app`
і опечатка в шляху скрипта — проходили `--offline` ЗЕЛЕНИМИ. Перевірка
читала лише `/usr/local/bin` і `OnFailure`, а `WorkingDirectory` не
читала взагалі. Тепер читає: кожен шлях, який юніт називає під
`/srv/camptribe/current`, мусить існувати в репозиторії.

«Немає, бо дрейф» від «немає, бо це збірка» відрізняє список
`DEPLOY_CREATES` — три рядки, кожен названий тим рядком
`bin/camptribe-deploy`, який його створює.

🔴 **Тут стояв `git check-ignore`, і це було гірше за список.** Рецензія
14.10.2026 заміряла хибні проходження: `out/freshness.mjs`, `logs/x.mjs`,
`.env.production` і `WorkingDirectory=…/current/out` проходили мовчки, бо
в `.gitignore` `out`, `dist`, `logs`, `coverage` і `.next` записані
голими — тож збігається будь-яка складова шляху. Вирок ще й залежав від
машини: `check-ignore` читає глобальні excludes, яких у CI немає.

Повне порівняння з машиною потребує SSH-ключа й у CI не біжить; вдавати
протилежне було б гірше за відсутність перевірки.

## 🔴 Таймер — не те саме, що ввімкнений таймер

Розкладка копіювала таймери й не вмикала жодного: `daemon-reload` їх
приймає, `systemd-analyze verify` каже «ок», і вони не спрацьовують
ніколи. Виправлено 14.10.2026 — `--apply` тепер робить `enable --now` і
**друкує `list-timers`**, бо `enable` може відпрацювати, а наступного
спрацювання не зʼявитись.

🔴 І одразу ж перша версія цього виправлення його ж і скасовувала:
`[ "$changed" -eq 0 ] && exit 0` стояло ПЕРЕД увімкненням. У стані
«файли на машині збігаються, але таймери ніхто не вмикав» — тобто рівно
тому, заради якого це писалось — `--apply` робив нуль викликів і виходив
нулем. Знайдено рецензією, відтворено підставним `ssh`. **Вміст файлів і
стан машини — різні питання.**

## 🔴 Чого тут ще немає

Падіння лишає слід **на машині**. Каналу назовні немає: пошти на сервері
немає (CAMP-110), а вебхук означає секрет на машині або публічний
показ стану інфраструктури. Поки що тривогу бачить той, хто запустить
`check-server-drift.mjs`, або наступний деплой. Останній крок —
вибір власника.
