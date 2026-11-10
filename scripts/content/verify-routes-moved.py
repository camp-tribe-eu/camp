import json, os, subprocess
src=json.load(open(os.environ.get('ROUTES_DUMP', '/tmp/routes.json'), encoding='utf-8'))

SQL = """
select json_agg(x) from (
  select p.slug, t.title, t.meta_description,
    (select json_agg(json_build_object('sort', s.sort, 'heading', st.heading, 'body', st.body) order by s.sort)
       from page_sections s join page_section_translations st on st.section_id=s.id
      where s.page_id=p.id) as sections
  from pages p join page_translations t on t.page_id=p.id
  where p.type='route') x;
"""
out=subprocess.run(['psql',os.environ.get('DATABASE_URL', 'postgres://localhost:5432/camptribe_dev'),'-t','-A','-c',SQL],
                   capture_output=True,text=True).stdout.strip()
db={r['slug']: r for r in (json.loads(out) or [])}

bad=[]; checked=0
for r in src:
    s=r['slug']
    if s not in db: bad.append(f'{s}: сторінки немає'); continue
    row=db[s]; checked+=2
    if row['title']!=r['name']: bad.append(f'{s}: назва розійшлась')
    if (row['meta_description'] or '')!=r['summary']: bad.append(f'{s}: підсумок розійшовся')
    sec={int(x['sort']):(x['heading'] or '', x['body'] or '') for x in (row['sections'] or [])}
    want={0:('', '\n\n'.join(r['intro'])), 1:('When to go', r['seasonNote']), 2:('The driving', r['roads'])}
    for i,st in enumerate(r['stages']): want[3+i]=(st['name'], st['why'])
    for k,(wh,wb) in want.items():
        checked+=1
        if k not in sec: bad.append(f'{s}: секції {k} немає'); continue
        gh,gb=sec[k]
        if gh!=wh: bad.append(f'{s}#{k}: заголовок «{gh[:28]}» ≠ «{wh[:28]}»')
        if gb!=wb: bad.append(f'{s}#{k}: текст розійшовся ({len(gb)} проти {len(wb)} символів)')

print(f'звірено {checked} полів у {len(src)} маршрутах, у базі {len(db)}')
print('розбіжностей:', len(bad))
for b in bad[:8]: print('  •', b)
