// One switch in the map's "Layers" row.
//
// 🔴 EXTRACTED FROM campsite-map.tsx FOR ONE REASON (CAMP-162), the same
// one as wildfire-panel.tsx: what a layer's switch SAYS is text rendered
// beside CEMS data, and a check can only read it if the switch can be
// rendered on its own. The label is the button's visible text and the
// description is its tooltip — `title`, which a pointer reader and most
// screen readers are both told — so a future "Flood risk" or "Drought
// warning" lands here, in the one place a reader meets it before any data
// does. `tests/unit/cems-panels.spec.ts` renders this for every layer the
// registry marks as CEMS-sourced.
//
// Nothing about the markup changed in the move.

import { Button } from '@/components/button';

export function LayerChip({
  layer,
  on,
  onToggle,
}: {
  layer: { id: string; label: string; description: string };
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={layer.description}
      data-layer={layer.id} variant={on ? 'accent' : 'chip'} size="sm">
      {layer.label}
    </Button>
  );
}
