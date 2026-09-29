import { test } from '@playwright/test';
import { discoverPanels } from './cems-panel';
import { visibleText } from './rendered-text';

test('print drought scenarios', () => {
  const f = discoverPanels().find((x) => 'panel' in x && x.file === 'drought.panel.ts');
  if (!f || !('panel' in f)) throw new Error('no panel');
  for (const s of f.panel.scenarios()) {
    console.log(`\n### ${s.name} [showsData=${s.showsData}]\n${visibleText(s.html)}`);
  }
});
