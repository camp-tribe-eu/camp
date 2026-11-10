import json, sys
src = json.load(open('/private/tmp/claude-501/-Users-george-Documents-UTD-Claude------Camping/4c5eb47a-c753-4472-9de1-950e5f95976a/scratchpad/routes.json'))

payload = []
for r in src:
    sections = []
    sections.append({'sort': 0, 'type': 'prose', 'heading': None,
                     'body': '\n\n'.join(r['intro'])})
    sections.append({'sort': 1, 'type': 'prose', 'heading': 'When to go',
                     'body': r['seasonNote']})
    sections.append({'sort': 2, 'type': 'prose', 'heading': 'The driving',
                     'body': r['roads']})
    for i, st in enumerate(r['stages']):
        items = [{'term': p['name'], 'detail': p['what']} for p in (st.get('pois') or [])]
        sections.append({
            'sort': 3 + i, 'type': 'prose', 'heading': st['name'],
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

tpl = open('/private/tmp/claude-501/-Users-george-Documents-UTD-Claude------Camping/4c5eb47a-c753-4472-9de1-950e5f95976a/scratchpad/routes-migration.tpl', encoding='utf-8').read()
sys.stdout.write(tpl.replace('__DATA__', data))
