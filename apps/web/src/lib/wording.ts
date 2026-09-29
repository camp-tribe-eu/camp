// CAMP-162: words this site does not use about somebody else's data.
//
// 🔴 A LICENCE CONDITION BEFORE IT IS A PREFERENCE.
//
// For the Copernicus sources the text is explicit, and the EEA's own
// legal notice says the same thing in its own words: reuse is free,
// commercial use included, "provided that the EEA is always acknowledged
// as the original source of the material and that the original meaning
// or message of the content is not distorted."
//
// Turning an official classification into a warning distorts it. The EU
// bathing water classes are a four-season statistical summary of four
// samples a year; "Poor" is a reputation earned over four years, not a
// statement that the water is dangerous this afternoon, and nobody at
// the EEA has said it is. So we print the class, its season, its source
// and a link — and we stop.
//
// We apply the same discipline to every source, not only the ones whose
// licence spells it out, because a reader cannot be expected to know
// which of our sections came with a licence attached.

/**
 * 🔴 The forbidden words, as whole words, case-insensitive.
 *
 * Two families:
 *
 *   alarm   — warning / danger / risk / hazard / unsafe / alert: they
 *             turn a classification into an instruction, which is what
 *             the licence calls distortion.
 *
 *   verdict — safe / clean / dirty / polluted / contaminated: a reader
 *             who remembers one of these words has been told the state
 *             of the water, which we have never measured. This is the
 *             family that matters most on a page about bathing water,
 *             and the one an editor is most likely to reach for.
 *
 * `swimming` and `bathing` are of course allowed: they name the thing.
 */
export const FORBIDDEN_WORDS: readonly string[] = [
  'alert',
  'contaminated',
  'danger',
  'dangerous',
  'dirty',
  'hazard',
  'hazardous',
  'polluted',
  'pollution',
  'risk',
  'risky',
  'unsafe',
  'warning',
  // 🔴 "clean" and "safe" are forbidden as REASSURANCE, which is the
  // harder half of the rule. A page that only refuses the frightening
  // words and keeps the comforting ones has not applied the rule, it has
  // taken a side.
  'clean',
  'safe',
  'safety',
];

/**
 * Every forbidden word in a piece of text, lower-cased and deduplicated.
 *
 * 🔴 Whole words only — `\b…\b`. Substring matching would refuse
 * "Riskilä" and "Cleanthes", which are place names, and a gate that
 * fires on a Finnish lake is a gate somebody switches off.
 */
export function findForbiddenWords(text: string): string[] {
  const found = new Set<string>();
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) found.add(word);
  }
  return [...found].sort();
}
