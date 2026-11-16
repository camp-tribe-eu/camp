// CAMP-454 — де в стилі стоїть шар посухи.
//
// 🔴 ПІД ПІДПИСАМИ ОСНОВИ, А НЕ НАД НИМИ. Шар посухи — суцільна заливка на
// всю Європу. Поставлений поверх назв міст він їх замилює; поставлений
// ПЕРЕД першим символьним шаром основи, він фарбує землю, а назви лишаються
// читабельними зверху.
//
// 🔴 «ПЕРШИЙ СИМВОЛЬНИЙ ШАР» — ЛИШЕ СЕРЕД ШАРІВ ОСНОВИ. Наші власні шари
// (лічильник кластерів — теж `symbol`) додаються після основи; якби вони
// рахувались, шар посухи став би ПЕРЕД лічильником, тобто НАД колами
// кластерів і крапками кемпінгів, а питання цього шару — про місце, і
// місце мусить лишатись видимим.
//
// Якщо в основі символів нема (плоский стиль, растрова основа), шар
// ставиться перед найнижчим із наших шарів, а коли й їх нема — нагору.

export interface StyleLayerRef {
  id: string;
  type: string;
}

export function droughtBeforeId(
  layers: readonly StyleLayerRef[],
  ours: ReadonlySet<string>,
): string | undefined {
  const baseLabel = layers.find((l) => l.type === 'symbol' && !ours.has(l.id));
  if (baseLabel) return baseLabel.id;
  return layers.find((l) => ours.has(l.id))?.id;
}

/**
 * Чи шар `id` лежить під усіма символьними шарами ОСНОВИ.
 * `n/a` — у основі символів немає, питання не стоїть.
 */
export function underBaseLabels(
  layers: readonly StyleLayerRef[],
  ours: ReadonlySet<string>,
  id: string,
): 'yes' | 'no' | 'n/a' {
  const at = layers.findIndex((l) => l.id === id);
  if (at < 0) return 'n/a';
  const labels = layers
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.type === 'symbol' && !ours.has(l.id));
  if (labels.length === 0) return 'n/a';
  return labels.every(({ i }) => i > at) ? 'yes' : 'no';
}
