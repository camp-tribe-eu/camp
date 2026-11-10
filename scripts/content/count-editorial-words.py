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


def jsx_words(src: str) -> int:
    total = 0
    for m in re.finditer(r'>([^<>{}]{30,})<', src):
        words = re.findall(r'[A-Za-z]{2,}', m.group(1))
        if len(words) >= 5:
            total += len(words)
    return total


def main() -> int:
    top = 10
    if '--top' in sys.argv:
        top = int(sys.argv[sys.argv.index('--top') + 1])

    per_file = collections.Counter()
    lit = jsx = files = 0
    for root, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in names:
            if not fn.endswith(('.ts', '.tsx')):
                continue
            files += 1
            path = os.path.join(root, fn)
            src = strip_comments(open(path, encoding='utf-8').read())
            a, b = literal_words(src), jsx_words(src)
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
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
