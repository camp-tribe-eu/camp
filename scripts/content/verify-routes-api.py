#!/usr/bin/env python3
"""CAMP-479: API віддає маршрут так само, як його віддавав код.

🔴 ЗВІРЯЄМО З ДАМПОМ КОДУ, А НЕ З БАЗОЮ. База вже перевірена окремо
(`verify-routes-moved.py`). Тут питання інше: чи СКЛАДАННЯ назад не
загубило нічого — абзаци вступу, координати, ночі, місця на етапах.

   ROUTES_DUMP=… API=http://localhost:3001 python3 scripts/content/verify-routes-api.py
"""
import json, os, sys, urllib.request

API = os.environ.get('API', 'http://localhost:3001')
src = json.load(open(os.environ.get('ROUTES_DUMP', '/tmp/routes.json'), encoding='utf-8'))

bad, checked = [], 0
for r in src:
    with urllib.request.urlopen(f"{API}/routes/content/{r['slug']}", timeout=30) as f:
        got = json.load(f)
    def eq(field, want, have):
        global checked
        checked += 1
        if want != have:
            bad.append(f"{r['slug']}.{field}: очікував {want!r:.60}… дістав {have!r:.60}…")
    eq('name', r['name'], got['name'])
    eq('region', r['region'], got['region'])
    eq('days', r['days'], got['days'])
    eq('countries', r['countries'], got['countries'])
    eq('months', r['months'], got['months'])
    eq('suits', sorted(r['suits']), sorted(got['suits']))
    eq('summary', r['summary'], got['summary'])
    eq('seasonNote', r['seasonNote'], got['seasonNote'])
    eq('roads', r['roads'], got['roads'])
    eq('intro', r['intro'], got['intro'])
    eq('attribution', r['attribution'], got['attribution'])
    eq('curatedAt', r['curatedAt'], got['curatedAt'])
    eq('stages.count', len(r['stages']), len(got['stages']))
    for i, st in enumerate(r['stages']):
        if i >= len(got['stages']):
            break
        g = got['stages'][i]
        eq(f'stage{i}.name', st['name'], g['name'])
        eq(f'stage{i}.nights', st['nights'], g['nights'])
        eq(f'stage{i}.why', st['why'], g['why'])
        eq(f'stage{i}.lat', round(st['lat'], 5), round(g['lat'], 5))
        eq(f'stage{i}.lon', round(st['lon'], 5), round(g['lon'], 5))
        want_pois = [{'name': p['name'], 'what': p['what']} for p in (st.get('pois') or [])]
        eq(f'stage{i}.pois', want_pois, g['pois'])

print(f'звірено {checked} полів у {len(src)} маршрутах')
print('розбіжностей:', len(bad))
for b in bad[:10]:
    print('  •', b)
sys.exit(1 if bad else 0)
