#!/usr/bin/env python3
"""Скільки редакційного тексту ще лежить у коді — CAMP-478 / CAMP-479.

   python3 scripts/content/count-editorial-words.py [--top N]

🔴 ЧОМУ ДВА ЧИСЛА, А НЕ ОДНЕ. Перша редакція цього заміру рахувала лише
рядки в лапках — і не бачила тексту всередині JSX. 10.11.2026 вона
показала 6 246 слів там, де їх 10 516: абзаци, набрані прямо в розмітці,
для неї не існували. Саме ними написана половина сторінки оренди.

Отже: рядок у лапках і текст між тегами — це два різні способи сховати
прозу від редактора, і міряти треба обидва.
"""
import collections, os, re, sys

SKIP_DIRS = {'node_modules', '.next'}
ROOT = os.environ.get('WEB_SRC', 'apps/web/src')


def strip_comments(src: str) -> str:
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', '', src)


def literal_words(src: str) -> int:
    total = 0
    for m in re.finditer(r"'([^'\\]{25,})'|\"([^\"\\]{25,})\"", src):
        s = m.group(1) or m.group(2)
        if re.search(r'[{}<>]|https?:|^[a-z-]+$', s):
            continue
        words = re.findall(r'[A-Za-z]{2,}', s)
        if len(words) >= 5:
            total += len(words)
    return total


# 🔴 ЩО ВІДСІЮЄТЬСЯ Й ЧОМУ. Друга редакція цього заміру рахувала
# узагальнення TypeScript як прозу: `useState<Foo>(…)` для регулярки
# «текст між `>` і `<`» виглядає точнісінько як абзац. Вона показала
# 4 270 слів там, де їх 2 799 — тобто я виправив число вниз і тим же
# рухом завищив його на півтори тисячі.
#
# Урок дорожчий за саме число: замір, виправлений поспіхом, хибний так
# само, як той, що його виправляли. Тому тут стоїть явний перелік
# ознак коду, а внизу друкуються ЗРАЗКИ знайденого — щоб наступну таку
# помилку було видно очима, а не через місяць.
CODE_SHAPED = re.compile(r'[;=(){}\[\]|&]|=>|\bconst\b|\breturn\b|\buseState\b')


def jsx_words(src: str) -> tuple[int, list[str]]:
    total = 0
    samples: list[str] = []
    for m in re.finditer(r'>([^<>{}]{30,})<', src):
        text = ' '.join(m.group(1).split())
        if CODE_SHAPED.search(text):
            continue
        words = re.findall(r'[A-Za-z]{2,}', text)
        if len(words) >= 5:
            total += len(words)
            if len(samples) < 2:
                samples.append(text)
    return total, samples


def main() -> int:
    top = 10
    if '--top' in sys.argv:
        top = int(sys.argv[sys.argv.index('--top') + 1])

    per_file = collections.Counter()
    samples: list[str] = []
    lit = jsx = files = 0
    for root, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in names:
            if not fn.endswith(('.ts', '.tsx')):
                continue
            files += 1
            path = os.path.join(root, fn)
            src = strip_comments(open(path, encoding='utf-8').read())
            a, (b, found) = literal_words(src), jsx_words(src)
            if found and len(samples) < 5:
                samples.extend(found[:1])
            lit += a
            jsx += b
            if a + b:
                per_file[os.path.relpath(path, ROOT)] = a + b

    # 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ: «0 слів» над нулем файлів нічого не
    # доводить, а саме так виглядає помилка в шляху.
    print(f'переглянуто {files} файлів у {ROOT}')
    print(f'  рядки в лапках: {lit:,}')
    print(f'  текст у JSX:    {jsx:,}')
    print(f'  РАЗОМ:          {lit + jsx:,}')
    if files == 0:
        print('🔴 жодного файла — перевір шлях, число нижче нічого не варте')
        return 2
    print()
    for f, n in per_file.most_common(top):
        print(f'{n:6,}  {f}')

    # 🔴 ЗРАЗКИ ДРУКУЮТЬСЯ ЗАВЖДИ. Число без прикладів того, що воно
    # порахувало, неможливо спростувати — а саме так ця перевірка двічі
    # за день показувала неправду, лишаючись переконливою.
    if samples:
        print('\nщо саме порахувало як текст у JSX:')
        for s in samples:
            print(f'  • {s[:90]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
