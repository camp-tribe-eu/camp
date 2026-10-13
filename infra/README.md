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
| `bin/camptribe-backup` | бекап + **звірка** + 14 денних зрізів |
| `bin/camptribe-failed` | лишає слід у `/srv/camptribe/failed/<юніт>` |
| `bin/camptribe-deploy` | деплой релізу |

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
щось, чого тут немає — **рівно той рядок, що вказує в порожнечу**.
Повне порівняння з машиною потребує SSH-ключа й у CI не біжить; вдавати
протилежне було б гірше за відсутність перевірки.

## 🔴 Чого тут ще немає

Падіння лишає слід **на машині**. Каналу назовні немає: пошти на сервері
немає (CAMP-110), а вебхук означає секрет на машині або публічний
показ стану інфраструктури. Поки що тривогу бачить той, хто запустить
`check-server-drift.mjs`, або наступний деплой. Останній крок —
вибір власника.
