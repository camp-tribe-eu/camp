import type { NavItem } from "./navigation";

/**
 * CAMP-448 — коли пункт шапки малюється мега-панеллю, а коли простим
 * розкривачем.
 *
 * Простий розкривач (Tools: два пункти) — вузька колонка, як у теми Fuse.
 * Мега-панель потрібна там, де діти не вміщаються в одну колонку або мають
 * власну структуру: згруповані (країни), глибші за один рівень, або їх
 * більше за шість. Межа «шість» — з висоти простого розкривача
 * (`max-h: min(60vh, 400px)`, рядок 56 px → сім рядків уже скролять).
 */
export const MEGA_MIN_CHILDREN = 7;

export function isMega(item: NavItem): boolean {
  if (item.children.length === 0) return false;
  return (
    item.children.length >= MEGA_MIN_CHILDREN ||
    item.children.some((c) => c.group !== undefined || c.children.length > 0)
  );
}

export interface MegaColumn {
  /** `null` — перша колонка без заголовка (діти без групи й без внуків). */
  title: string | null;
  /** Заголовок-посилання: у колонки, що є дитиною з власними дітьми. */
  href?: string;
  items: NavItem[];
}

/**
 * Діти → колонки.
 *   • дитина З ВНУКАМИ — власна колонка: її підпис заголовком-посиланням,
 *     внуки списком (так вкладеність з бази доїжджає до читача);
 *   • діти з `group` — колонка за групою, у порядку першої появи;
 *   • решта — перша колонка без заголовка.
 * Порожніх колонок не буває.
 */
export function megaColumns(item: NavItem): MegaColumn[] {
  const plain = item.children.filter(
    (c) => c.group === undefined && c.children.length === 0,
  );
  const titles: string[] = [];
  for (const c of item.children) {
    if (c.group !== undefined && !titles.includes(c.group)) titles.push(c.group);
  }
  const cols: MegaColumn[] = [];
  if (plain.length > 0) cols.push({ title: null, items: plain });
  for (const c of item.children) {
    if (c.group === undefined && c.children.length > 0) {
      cols.push({ title: c.label, href: c.href, items: c.children });
    }
  }
  for (const t of titles) {
    cols.push({ title: t, items: item.children.filter((c) => c.group === t) });
  }
  return cols;
}
