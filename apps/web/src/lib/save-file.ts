// CAMP-229 (3/3) — віддати браузеру текст як файл для збереження.
//
// 🔴 ЄДИНЕ МІСЦЕ, ДЕ ДОТОРКАЮТЬСЯ DOM ЗАРАДИ ЗАВАНТАЖЕННЯ. Усе, що вирішує, ЧИ й ЩО
// віддавати (файл розібрано, строк не минув), — у lib/rights.ts і перевіряється на
// даних. Тут лише жест, який у Node не виконати: тимчасове посилання з `download`.
// Його перевірено руками в браузері й записано в описі PR.

export function saveTextFile(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Не одразу: частина браузерів читає blob вже після `click()`.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
