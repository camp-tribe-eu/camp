#!/usr/bin/env python3
"""CAMP-479: згенерувати міграцію, що сіє країни оренди.

   RENTAL_DUMP=… python3 scripts/content/gen-rental-migration.py \
     > apps/api/src/migrations/1795800000000-SeedRentalCountries.ts
   npx prettier --write <той самий файл>

🔴 PRETTIER ОБОВʼЯЗКОВИЙ: JSON вживає подвійні лапки й іншу розкладку,
ніж лінтер репозиторію, і прогін `api` падає на форматуванні.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.environ.get('RENTAL_DUMP', '/tmp/rental.json'), encoding='utf-8'))

out = []
for c in src:
    sections = [
        {'sort': 0, 'slot': 'intro', 'heading': None, 'body': c['intro'], 'items': []},
        {'sort': 1, 'slot': 'data-intro', 'heading': None, 'body': c['dataIntro'], 'items': []},
    ]
    for i, f in enumerate(c['facts']):
        sections.append({
            'sort': 2 + i,
            'slot': f'fact:{i}',
            'heading': f['title'],
            'body': f['body'],
            # Джерело їде разом із фактом: твердження без авторитету —
            # це вже не факт, а наша думка.
            'items': [{'term': f['source']['name'], 'detail': f['source']['url']}],
        })
    out.append({
        'code': c['code'],
        'name': c['name'],
        'angle': c['angle'],
        'sections': sections,
    })

tpl = open(os.path.join(HERE, 'rental-migration.tpl'), encoding='utf-8').read()
sys.stdout.write(tpl.replace('__DATA__', json.dumps(out, ensure_ascii=False, indent=2)))
