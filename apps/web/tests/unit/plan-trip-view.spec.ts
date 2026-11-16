import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { PlanKeepView, PlanOutcomePanel } from '@/components/plan-view';
import { checkDraft, EMPTY_DRAFT, type PlanDraft, type PlanOutcome, type PlanRun, type TripRequest } from '@/lib/plan';
import type { SavedTrip } from '@/lib/plan-save';
import { readPlan } from '@/lib/plan-source';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-456 — результат поїздки з кількох перегонів, і блок «зберегти / поділитися»,
// прочитані на ВИДАНОМУ HTML. План малюється з відповіді, знятої з сервера
// (fixtures/plan-ok.json: Ліон → Барселона, сім днів, шість ночівель), пропущеної
// через `readPlan`, а не зібраної руками.

const captured = (name: string): { status: number; body: unknown } =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const outcomeOf = (name: string): PlanOutcome => {
  const c = captured(name);
  return readPlan(c.status, c.body);
};
const PLAN = outcomeOf('plan-ok');

const LYON = '45.764, 4.8357';
const BCN = '41.3874, 2.1686';

const tripOf = (over: Partial<PlanDraft>): TripRequest => {
  const r = checkDraft({ ...EMPTY_DRAFT, from: LYON, to: BCN, days: '14', ...over });
  if (!r.ok) throw new Error(`fixture invalid: ${JSON.stringify(r.errors)}`);
  return r.trip;
};

/** Ліон → Барселона → назад: два рівні перегони, по сім днів кожен. */
const THERE_AND_BACK = tripOf({ roundTrip: true });

const panel = (run: PlanRun) => renderComponent(PlanOutcomePanel, { run });
const done = (request: TripRequest, ...outcomes: PlanOutcome[]): PlanRun => ({
  phase: 'done',
  id: 1,
  request,
  legs: request.legs.map((leg, i) => ({ leg, outcome: outcomes[i] ?? outcomes[0] })),
});

test.describe('поїздка з двох перегонів у панелі', () => {
  test('🔴 передумова: перегони рівні, дні — сім і сім (інакше решта тестів вимірюють не те)', () => {
    expect(THERE_AND_BACK.legs.map((l) => l.days)).toEqual([7, 7]);
    expect(THERE_AND_BACK.legs.map((l) => l.offset)).toEqual([0, 7]);
    expect(PLAN.status).toBe('planned');
  });

  test('🔴 нумерація днів наскрізна: 1…14, а не 1…7 двічі', () => {
    const said = visibleText(panel(done(THERE_AND_BACK, PLAN)));
    const days = [...said.matchAll(/\bDay (\d+)\b/g)].map((m) => Number(m[1]));
    expect(days).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    // 🔴 Пояснення ночівлі говорить про ПЕРЕГІН («its day 3»), а не про поїздку:
    // рівний розподіл рахується в межах свого перегону, і «day 10 of the trip»
    // про друге місце було б брехнею про те, від чого відстань.
    expect(said).toContain('On an even split of this leg, its day 6 would end');
    expect(said).not.toContain('On an even split of the trip');
    expect(said).not.toContain('from your start to your destination');
    expect(said.match(/the start of this leg to the end of it/g)).toHaveLength(12);
  });

  test('🔴 останній день перегону закінчується «у кінці перегону», а не «у вашому пункті призначення»: це проміжна зупинка', () => {
    const said = visibleText(panel(done(THERE_AND_BACK, PLAN)));
    expect(said.match(/, to the end of this leg\./g)).toHaveLength(2);
    expect(said).not.toContain('to your destination');
  });

  test('🔴 кожен перегін має заголовок із підписами обох кінців і своїми днями', () => {
    const html = panel(done(THERE_AND_BACK, PLAN));
    expect([...html.matchAll(/data-testid="leg"/g)]).toHaveLength(2);
    const said = visibleText(html);
    expect(said).toContain(`Leg 1: ${LYON} to ${BCN} (7 days)`);
    expect(said).toContain(`Leg 2: ${BCN} to ${LYON} (7 days)`);
  });

  test('🔴 підсумок: скільки днів і перегонів, а ночі — лише коли відповіли ВСІ перегони', () => {
    const all = visibleText(panel(done(THERE_AND_BACK, PLAN)));
    expect(all).toContain('14 days in 2 legs, 12 nights.');
    const some = visibleText(panel(done(THERE_AND_BACK, PLAN, { status: 'throttled' })));
    expect(some).toContain('14 days in 2 legs.');
    expect(some).not.toContain('14 days in 2 legs, ');
  });

  test('🔴 «не пряма, а дорога» — один раз на всю поїздку, а не під кожним перегоном; пояснення «як обирали» теж одне', () => {
    const said = visibleText(panel(done(THERE_AND_BACK, PLAN)));
    expect(said.match(/Every distance here is a straight line, not a road\./g)).toHaveLength(1);
    expect(said.match(/How the nights were chosen/g)).toHaveLength(1);
    expect(said.match(/To make this plan,/g)).toHaveLength(1);
    expect(said.match(/Campsite records come from/g)).toHaveLength(1);
    // Не друкує кількість кандидатів одного перегону як кількість для всієї поїздки.
    expect(said).not.toMatch(/\d[\d,]* campsites near that line/);
  });

  test('🔴 один перегін відмовлено, інший намальовано: кожен каже своє, і відмова не стирає плану сусіда', () => {
    const said = visibleText(panel(done(THERE_AND_BACK, PLAN, outcomeOf('plan-no-chain'))));
    expect(said).toContain('No plan found.');
    expect(said).toContain('Day 7');
    expect(said.match(/A night at/g)).toHaveLength(6);
    expect(said).not.toContain('did not answer');
  });

  test('🔴 ліміт на перегоні: сказано, що кожен перегін рахується за один запит', () => {
    const said = visibleText(panel(done(THERE_AND_BACK, { status: 'throttled' })));
    expect(said).toContain('every leg of a trip counts as one');
    expect(said).toContain('still in the form');
  });

  test('🔴 поза ЄС на другому перегоні: названо підпис ТОЇ точки, а не просто «start»', () => {
    const said = visibleText(
      panel(done(THERE_AND_BACK, PLAN, { status: 'outside-union', fields: ['from'] })),
    );
    expect(said).toContain(`The start of this leg (${BCN}) is outside the European Union.`);
  });

  test('«що запитано»: проміжні точки, зворотний шлях і габарити, названі словами', () => {
    const trip = tripOf({
      via: [{ id: '1', text: '43, 3', place: null }],
      roundTrip: true,
      days: '15',
      vehicle: { type: 'motorhome', height: '3,1', length: '7.4', weight: '3.5' },
    });
    const said = visibleText(panel(done(trip, PLAN)));
    expect(said).toContain('What you asked for');
    expect(said).toContain('Stop 1');
    expect(said).toContain('43, 3');
    expect(said).toContain('To, then back to the start');
    expect(said).toContain('Vehicle (not used by the planner)');
    expect(said).toContain('Motorhome, 3.1 m high, 7.4 m long, 3.5 t');
  });

  test('без габаритів рядка про авто немає взагалі: порожнє не малюємо', () => {
    expect(visibleText(panel(done(THERE_AND_BACK, PLAN)))).not.toContain('Vehicle');
  });

  test('одна пара точок малюється так само, як до проміжних: без «Leg» і без підсумку про перегони', () => {
    const single = tripOf({ days: '7' });
    const said = visibleText(panel(done(single, PLAN)));
    expect(said).not.toMatch(/\bLeg \d/);
    expect(said).not.toMatch(/\d+ legs?/);
    expect(said).toContain('7 days, 6 nights.');
    expect(said).toContain('To make this plan,');
  });
});

const trip = (id: string, name: string): SavedTrip => ({ id, name, savedAt: 1, draft: EMPTY_DRAFT });
const keep = (over: Partial<Parameters<typeof PlanKeepView>[0]> = {}) =>
  renderComponent(PlanKeepView, {
    ready: true,
    name: '',
    saved: [],
    dropped: 0,
    message: null,
    shareUrl: null,
    onName: () => {},
    onSave: () => {},
    onShare: () => {},
    onOpen: () => {},
    onDelete: () => {},
    ...over,
  });

test.describe('блок «зберегти й поділитись»', () => {
  test('🔴 каже правду про те, де лежить поїздка: лише в цьому браузері, і що бачить той, кому дали посилання', () => {
    const said = visibleText(keep());
    expect(said).toContain('A saved trip stays in this browser only.');
    expect(said).toContain('there is no account');
    expect(said).toContain('after the “#”, which your browser never sends to us');
    expect(said).toContain('whoever you give it to will see those places');
  });

  test('порожній перелік — так і написано, без вигаданих прикладів', () => {
    const html = keep();
    expect(visibleText(html)).toContain('No saved trips yet.');
    expect(html).not.toContain('data-testid="saved-list"');
    expect(html).not.toContain('saved-dropped');
    expect(html).not.toContain('share-url');
  });

  test('збережені: назва, «Open» і «Delete», які називають свою поїздку', () => {
    const html = keep({ saved: [trip('a', 'Antwerp to Bari'), trip('b', 'Weekend')] });
    expect([...html.matchAll(/data-testid="saved-item"/g)]).toHaveLength(2);
    const said = visibleText(html);
    expect(said).toContain('Antwerp to Bari');
    for (const label of ['Open Antwerp to Bari', 'Delete Antwerp to Bari', 'Open Weekend', 'Delete Weekend']) {
      expect(html, label).toContain(`aria-label="${label}"`);
    }
  });

  test('🔴 скільки записів не прочиталось — сказано: одне й кілька різними словами; нуль — мовчить', () => {
    expect(visibleText(keep({ dropped: 1 }))).toContain('One saved record in this browser could not be read and was left out.');
    expect(visibleText(keep({ dropped: 4 }))).toContain('4 saved records in this browser could not be read and were left out.');
    expect(visibleText(keep({ dropped: 0 }))).not.toContain('could not be read');
  });

  test('посилання — лише коли воно є: поле для читання з посиланням у ньому', () => {
    const html = keep({ shareUrl: 'https://camptribe.eu/plan#t=abc' });
    const field = /<input\b[^>]*data-testid="share-url"[^>]*>/.exec(html)![0];
    expect(field).toContain('value="https://camptribe.eu/plan#t=abc"');
    expect(field).toMatch(/\breadonly=""/i);
  });

  test('повідомлення про дію — у ділянці оголошень, що існує завжди', () => {
    const html = keep({ message: 'Saved “X” in this browser.' });
    expect(html).toMatch(/role="status"[^>]*data-testid="keep-message"/);
    expect(visibleText(html)).toContain('Saved “X” in this browser.');
    expect(keep()).toMatch(/role="status"[^>]*data-testid="keep-message"/);
  });

  test('до гідратації кнопки й назва вимкнені: форма без JavaScript нічого не обіцяє', () => {
    const html = keep({ ready: false, saved: [trip('a', 'T')] });
    for (const tag of html.matchAll(/<(button|input)\b([^>]*)>/g)) {
      if (/type="text"/.test(tag[2]) && /readOnly/.test(tag[2])) continue;
      expect(tag[2], tag[0].slice(0, 80)).toMatch(/\bdisabled=""/);
    }
  });
});
