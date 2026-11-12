import type { SectionView } from "@/lib/page-content";
import type { PersonaLabels } from "@/components/persona-toggle";

import type { PersonaSlot } from "@/lib/persona";

/** Секція в названому слоті сторінки `persona-switch`, або `null`. */
export function personaSection(
  sections: SectionView[] | null,
  slot: PersonaSlot,
): SectionView | null {
  if (!sections) return null;
  const found = sections.filter((s) => s.slot === slot);
  return found.length === 1 ? found[0] : null;
}

/**
 * Підписи перемикача. Усі три мусять бути, інакше `null`: перемикач із
 * однією підписаною кнопкою — це кнопка без назви.
 */
export function personaLabels(
  sections: SectionView[] | null,
): PersonaLabels | null {
  const group = personaSection(sections, "switch-label")?.heading;
  const owner = personaSection(sections, "owner")?.heading;
  const renter = personaSection(sections, "renter")?.heading;
  if (!group || !owner || !renter) return null;
  return { group, owner, renter };
}
