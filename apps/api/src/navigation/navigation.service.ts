import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-365 — меню, яке редагує власник, а не розробник.
//
// 🔴 ЩО МИ ТУТ ВТРАЧАЄМО, І ЧОМУ ЦЕ ТРЕБА ВІДНОВИТИ ОКРЕМО.
//
// Доти меню жило списком у `site-chrome.tsx`, і поруч стояв коментар:
// закоментовані пункти додаються «коли кожен поїде, не раніше». Та
// форма мала властивість, якої ніхто не називав уголос: **мертве
// посилання в меню було неможливе**. Щоб його додати, треба було
// змінити код, а код читає рецензія і CI.
//
// База цієї властивості не має. Власник може додати пункт на сторінку,
// якої ще немає, і ми віддамо 404 у головному меню — тихо, бо нічого
// не впаде.
//
// Тому разом із переїздом стоїть сторож: `navigation.e2e-spec.ts`
// бере КОЖЕН пункт із бази й перевіряє, що він відкривається. Без
// нього цей файл був би обміном «власник не може редагувати» на
// «власник може зламати».

export type NavLocation = 'header' | 'footer' | 'mobile';

export interface NavItemView {
  href: string;
  label: string;
  /** Діти того самого пункту, у порядку `sort`. Порожній масив, не null. */
  children: NavItemView[];
}

interface NavRow {
  id: string;
  parent_id: string | null;
  href: string;
  label: string | null;
}

@Injectable()
export class NavigationService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Пункти одного розташування, деревом.
   *
   * 🔴 `visible = true` і НЕПОРОЖНІЙ підпис — обидві умови в SQL, а не
   * у фільтрі після вибірки. Пункт без підпису це пункт, який читач
   * побачить порожнім прямокутником; у меню це гірше за його
   * відсутність.
   *
   * 🔴 Мова береться параметром, але запасу на іншу мову тут НЕМАЄ
   * навмисно: якщо перекладу немає, пункт не виходить. Меню,
   * наполовину англійське й наполовину інше, виглядає як поломка, а
   * підсунути англійський підпис замість відсутнього означало б
   * збрехати про стан перекладу (CAMP-219: пʼять мов лежать із
   * `live: false`).
   */
  async byLocation(
    location: NavLocation,
    language: string,
  ): Promise<NavItemView[]> {
    const rows = await this.db.query<NavRow[]>(
      `
      SELECT n.id,
             n.parent_id,
             n.href,
             t.label
        FROM navigation n
        JOIN navigation_translations t
          ON t.navigation_id = n.id
         AND t.language_code = $2
       WHERE n.location = $1
         AND n.visible = true
         AND t.label <> ''
       ORDER BY n.sort, t.label
      `,
      [location, language],
    );

    return this.toTree(rows);
  }

  /**
   * 🔴 ДЕРЕВО БУДУЄТЬСЯ ТУТ, А НЕ РЕКУРСИВНИМ ЗАПИТОМ.
   *
   * Меню — десятки рядків, не тисячі, тож рекурсія в SQL купила б
   * продуктивність, якої нікому не бракує, ціною запиту, який ніхто не
   * перечитає. А от зациклений батько в такому запиті дав би
   * нескінченний цикл у базі.
   *
   * Тут цикл неможливий за побудовою: кожен рядок додається до
   * результату РІВНО один раз, бо ми йдемо списком, а не посиланнями.
   * Пункт, чий батько не потрапив у вибірку (прихований або без
   * підпису), стає кореневим — інакше він зник би мовчки разом із
   * батьком, і власник не зрозумів би, куди подівся.
   */
  private toTree(rows: NavRow[]): NavItemView[] {
    const byId = new Map<string, NavItemView>();
    for (const r of rows) {
      byId.set(r.id, { href: r.href, label: r.label ?? '', children: [] });
    }

    const roots: NavItemView[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
}
