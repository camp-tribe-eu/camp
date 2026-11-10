import json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
# 🔴 ПІСЛЯ ГЕНЕРАЦІЇ ФАЙЛ ТРЕБА ПРОГНАТИ ЧЕРЕЗ PRETTIER ПРОЄКТУ:
#   npx prettier --write apps/api/src/migrations/1795600000000-SeedRoutesContent.ts
# JSON вживає подвійні лапки й іншу розкладку, ніж лінтер репозиторію,
# і прогін `api` падає на форматуванні — заміряно 10.11.2026.
# Форматування згенерованого файла безпечне: це механічне перетворення
# того, що ми ж і створили, а не правка чужого коду.
src = json.load(open(os.environ.get('ROUTES_DUMP', '/tmp/routes.json'), encoding='utf-8'))

payload = []
for r in src:
    sections = []
    # 🔴 РОЛЬ СЕКЦІЇ ЗАПИСУЄТЬСЯ В `slot`, А НЕ ВИВОДИТЬСЯ З `sort`.
    # Номер по порядку — не договір: редактор має право переставити
    # секції місцями, і складання сторінки за номерами тихо зламалось
    # би, віддавши «дороги» там, де чекали «сезон».
    sections.append({'sort': 0, 'slot': 'intro', 'type': 'prose', 'heading': None,
                     'body': '\n\n'.join(r['intro'])})
    sections.append({'sort': 1, 'slot': 'season', 'type': 'prose', 'heading': 'When to go',
                     'body': r['seasonNote']})
    sections.append({'sort': 2, 'slot': 'roads', 'type': 'prose', 'heading': 'The driving',
                     'body': r['roads']})
    for i, st in enumerate(r['stages']):
        items = [{'term': p['name'], 'detail': p['what']} for p in (st.get('pois') or [])]
        sections.append({
            'sort': 3 + i, 'slot': f'stage:{i}', 'type': 'prose', 'heading': st['name'],
            'body': st['why'], 'items': items or None,
        })
    payload.append({
        'slug': r['slug'],
        'region': r['region'],
        'name': r['name'],
        'summary': r['summary'],
        'countries': r['countries'],
        'days': r['days'],
        'months': r['months'],
        'suits': r['suits'],
        'curatedAt': r['curatedAt'],
        'attribution': r['attribution'],
        'stages': [{'name': s['name'], 'lat': s['lat'], 'lon': s['lon'],
                    'nights': s['nights']} for s in r['stages']],
        'sections': sections,
    })

# 🔴 БЕЗ ЖОДНОГО ЕКРАНУВАННЯ. Перша редакція клала JSON у `String.raw`
# і подвоювала зворотні слеші — текст ламався на 47-й тисячі символів.
# JSON сам по собі є валідним літералом TypeScript, тож він просто
# вставляється як масив. Нема рядка — нема і його екранування.
data = json.dumps(payload, ensure_ascii=False, indent=2)

tpl = open(os.path.join(HERE, 'routes-migration.tpl'), encoding='utf-8').read()
sys.stdout.write(tpl.replace('__DATA__', data))
