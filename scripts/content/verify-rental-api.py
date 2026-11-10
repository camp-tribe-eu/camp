#!/usr/bin/env python3
"""CAMP-479: API віддає країну оренди так само, як її віддавав код.

   RENTAL_DUMP=… API=http://localhost:3001 python3 scripts/content/verify-rental-api.py
"""
import json, os, sys, urllib.request

API = os.environ.get('API', 'http://localhost:3001')
src = json.load(open(os.environ.get('RENTAL_DUMP', '/tmp/rental.json'), encoding='utf-8'))

bad, checked = [], 0
for c in src:
    with urllib.request.urlopen(f"{API}/rental/countries/{c['code']}", timeout=30) as f:
        got = json.load(f)

    def eq(field, want, have):
        global checked
        checked += 1
        if want != have:
            bad.append(f"{c['code']}.{field}: очікував {want!r:.60}… дістав {have!r:.60}…")

    eq('name', c['name'], got['name'])
    eq('angle', c['angle'], got['angle'])
    eq('intro', c['intro'], got['intro'])
    eq('dataIntro', c['dataIntro'], got['dataIntro'])
    eq('facts.count', len(c['facts']), len(got['facts']))
    for i, f in enumerate(c['facts']):
        if i >= len(got['facts']):
            break
        g = got['facts'][i]
        eq(f'fact{i}.title', f['title'], g['title'])
        eq(f'fact{i}.body', f['body'], g['body'])
        eq(f'fact{i}.source.name', f['source']['name'], g['source']['name'])
        eq(f'fact{i}.source.url', f['source']['url'], g['source']['url'])

print(f'звірено {checked} полів у {len(src)} країнах')
print('розбіжностей:', len(bad))
for b in bad[:10]:
    print('  •', b)
sys.exit(1 if bad else 0)
