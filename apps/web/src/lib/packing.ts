// CAMP-55 — the packing list generator.
//
// 🔴 THE LINE THIS FILE DOES NOT CROSS.
//
// There is no "legal requirements" section, and its absence is the
// decision. A warning triangle, a hi-vis vest, a spare-bulb kit, a
// breathalyser, winter tyres between certain dates — what a driver must
// carry differs by member state, changes, and being wrong about it costs
// the reader a fine at the roadside. /guides refuses to write about
// twenty-seven jurisdictions we have not checked, and our own terms
// disclaim that advice; a checkbox saying "hi-vis vest — required" would
// be the same claim in a smaller font.
//
// So this list is what experience suggests you will want, said as a
// suggestion, and the page says out loud that legal kit is not on it and
// where to look instead.
//
// 🔴 Quantities are only derived where the derivation is obvious.
// Plates scale with people. Nights of clothing scale with nights. We do
// not tell anyone how many litres of water they need, because that is a
// health claim and we have measured nothing.

export type Season = 'warm' | 'cold' | 'shoulder';
export type VehicleKind = 'campervan' | 'motorhome' | 'car-and-tent';

export interface PackingInput {
  vehicle: VehicleKind;
  nights: number;
  people: number;
  season: Season;
  /** Cooking at the pitch rather than eating out. */
  cooking: boolean;
  /** The pitch has a mains hook-up. */
  electricity: boolean;
  children: boolean;
  dog: boolean;
}

export interface PackingItem {
  /** Stable id, so a checked box survives a change of wording. */
  id: string;
  label: string;
  /** Filled in when the count follows from the inputs. */
  qty?: string;
  /** Why it is here, when that is not obvious. */
  note?: string;
}

export interface PackingGroup {
  id: string;
  title: string;
  items: PackingItem[];
}

export const SEASONS: { id: Season; label: string }[] = [
  { id: 'warm', label: 'Summer' },
  { id: 'shoulder', label: 'Spring or autumn' },
  { id: 'cold', label: 'Winter' },
];

export const VEHICLE_KINDS: { id: VehicleKind; label: string }[] = [
  { id: 'campervan', label: 'Campervan' },
  { id: 'motorhome', label: 'Motorhome' },
  { id: 'car-and-tent', label: 'Car and tent' },
];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The list, for these inputs.
 *
 * Pure and total: any input produces a list, because this runs on every
 * change of a form field. People and nights are clamped rather than
 * validated — a reader mid-typing is not an error state.
 */
export function packingList(input: PackingInput): PackingGroup[] {
  const people = Math.max(1, Math.min(12, Math.round(input.people) || 1));
  const nights = Math.max(1, Math.min(120, Math.round(input.nights) || 1));
  const tent = input.vehicle === 'car-and-tent';
  const cold = input.season === 'cold';
  const shoulder = input.season === 'shoulder';

  const groups: PackingGroup[] = [];

  groups.push({
    id: 'sleeping',
    title: 'Sleeping',
    items: [
      tent
        ? { id: 'tent', label: 'Tent, poles and pegs', note: 'Count the pegs before you leave, not in the dark.' }
        : { id: 'bedding', label: 'Fitted sheets for the bunk' },
      {
        id: 'bags',
        label: cold ? 'Sleeping bags rated for the cold' : 'Sleeping bags or duvets',
        qty: plural(people, 'person', 'people'),
      },
      { id: 'pillows', label: 'Pillows', qty: plural(people, 'pillow') },
      ...(tent
        ? [{ id: 'mats', label: 'Sleeping mats', qty: plural(people, 'mat') }]
        : []),
      ...(cold
        ? [{ id: 'thermal', label: 'Extra blanket or thermal liner', qty: plural(people, 'set') }]
        : []),
    ],
  });

  groups.push({
    id: 'kitchen',
    title: 'Kitchen',
    items: [
      ...(input.cooking
        ? [
            { id: 'stove', label: tent ? 'Camping stove' : 'Gas for the hob', note: 'Check the fitting before you travel — connectors differ across Europe.' },
            { id: 'pans', label: 'Pan and frying pan' },
            { id: 'plates', label: 'Plates, bowls, mugs', qty: plural(people, 'set') },
            { id: 'cutlery', label: 'Cutlery', qty: plural(people, 'set') },
            { id: 'knife', label: 'A knife that is actually sharp, and a board' },
            { id: 'washing', label: 'Washing-up bowl, cloth and liquid' },
            { id: 'bin', label: 'Bin bags' },
          ]
        : [{ id: 'basics', label: 'Mugs, a kettle and something to open a bottle with', qty: plural(people, 'set') }]),
      { id: 'water', label: 'Water container', note: 'Not every pitch has a tap within a hose of you.' },
      { id: 'coolbox', label: input.electricity ? 'Cool box (mains)' : 'Cool box and ice packs' },
    ],
  });

  groups.push({
    id: 'clothes',
    title: 'Clothes',
    items: [
      {
        id: 'layers',
        label: cold ? 'Warm layers' : shoulder ? 'Layers — it will be both' : 'Light layers',
        qty: `${plural(people, 'person', 'people')}, ${nights} night${nights === 1 ? '' : 's'}`,
      },
      { id: 'waterproof', label: 'Waterproof jacket', qty: plural(people, 'jacket') },
      { id: 'shoes', label: 'Shoes you can walk in and shoes you can get wet' },
      ...(cold ? [{ id: 'hat', label: 'Hat and gloves', qty: plural(people, 'set') }] : []),
      ...(!cold ? [{ id: 'sun', label: 'Sun hat and sunscreen' }] : []),
      { id: 'towels', label: 'Towels', qty: plural(people, 'towel') },
    ],
  });

  groups.push({
    id: 'pitch',
    title: 'At the pitch',
    items: [
      { id: 'chairs', label: 'Folding chairs', qty: plural(people, 'chair') },
      { id: 'table', label: 'Folding table' },
      ...(input.electricity
        ? [{ id: 'hookup', label: 'Hook-up cable and a CEE adapter', note: 'Blue 16 A is the usual European pitch socket.' }]
        : [{ id: 'power', label: 'Power bank, charged' }]),
      { id: 'torch', label: 'Head torch', qty: plural(people, 'torch') },
      ...(tent ? [{ id: 'mallet', label: 'Mallet' }] : [{ id: 'levelling', label: 'Levelling ramps and chocks' }]),
      ...(!tent ? [{ id: 'hose', label: 'Fresh-water hose' }] : []),
    ],
  });

  groups.push({
    id: 'practical',
    title: 'Practical',
    items: [
      { id: 'firstaid', label: 'First-aid kit' },
      { id: 'meds', label: 'Any medication you take, for the whole trip and a bit over' },
      { id: 'documents', label: 'Driving licence, vehicle papers, insurance, EHIC or GHIC' },
      { id: 'cash', label: 'Some cash', note: 'Small campsites and machines at barriers are often cash only.' },
      { id: 'tape', label: 'Duct tape and cable ties' },
      ...(nights > 7 ? [{ id: 'laundry', label: 'Laundry bag and detergent', note: `${nights} nights is past one set of everything.` }] : []),
    ],
  });

  if (input.children) {
    groups.push({
      id: 'children',
      title: 'With children',
      items: [
        { id: 'kid-warm', label: 'More warm layers than you think' },
        { id: 'kid-quiet', label: 'Something to do in the rain' },
        { id: 'kid-night', label: 'Night light' },
        { id: 'kid-seat', label: 'Car seats — and check they fit the hire vehicle before you book' },
      ],
    });
  }

  if (input.dog) {
    groups.push({
      id: 'dog',
      title: 'With a dog',
      items: [
        { id: 'dog-bowl', label: 'Bowls and food for the trip' },
        { id: 'dog-lead', label: 'Lead and a long line' },
        { id: 'dog-bed', label: 'Bed or blanket that smells of home' },
        { id: 'dog-papers', label: 'Pet passport or animal health certificate, and up-to-date vaccinations' },
        { id: 'dog-towel', label: 'A towel that is the dog’s towel' },
      ],
    });
  }

  return groups;
}

/** Total items, for the page to state without counting by hand. */
export const countItems = (groups: PackingGroup[]) =>
  groups.reduce((n, g) => n + g.items.length, 0);

/** Plain text, for the copy button — a list is only useful if it travels. */
export function asText(groups: PackingGroup[]): string {
  return groups
    .map(
      (g) =>
        `${g.title}\n${g.items
          .map((i) => `  [ ] ${i.label}${i.qty ? ` — ${i.qty}` : ''}`)
          .join('\n')}`,
    )
    .join('\n\n');
}
