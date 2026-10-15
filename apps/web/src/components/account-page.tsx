import type { ReactNode } from 'react';
import { breadcrumbList, jsonLdProps } from '@/lib/jsonld';

// CAMP-228 — обгортка сторінки акаунта: хлібні крихти в JSON-LD.
//
// 🔴 ЧОМУ СТОРІНЦІ, ЯКА `noindex`, ВЗАГАЛІ РОЗМІТКА. `check-structured-data`
// вимагає від КОЖНОЇ зібраної сторінки хоч один блок JSON-LD, крім
// сторінок помилок (404, 410), бо розмітка там була б брехнею
// машинною мовою: «тут щось є», де нічого немає. Сторінка входу — не
// помилка, вона існує, тож правило до неї застосовується, і це CI
// знайшов на першому ж прогоні (п'ять сторінок), а не я локально: цей
// скрипт читає збірку, якої я не запускав.
//
// Хлібні крихти — те саме, що вже стоїть на /plan і /contact (теж
// `noindex`/службові). Це правдиве твердження про те, де сторінка в сайті,
// і воно нічого не обіцяє пошуку.
//
// Робиться на сервері (це не клієнтський компонент), бо JSON-LD має бути
// у виданому HTML.

export function AccountPage({
  name,
  path,
  children,
}: {
  name: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <>
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'CampTribe', path: '/' },
            { name, path },
          ]),
        )}
      />
      {children}
    </>
  );
}
