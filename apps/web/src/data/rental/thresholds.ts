// CAMP-4 — the four numbers on a rental contract that decide the trip.
//
// 🔴 WHY THE TABLE IS ABOUT THRESHOLDS AND NOT ABOUT VEHICLES.
//
// The obvious page here would list camper models with lengths, masses and
// a price "from". We hold none of those. Every figure in such a table
// would be a plausible number nobody measured, about a vehicle nobody has
// seen, offered by a company we have no relationship with — and this
// project has been burned by exactly that shape of content before.
//
// What IS knowable, and is the same for every renter, is the set of legal
// and physical thresholds those numbers get compared against. 3 500 kg is
// in a directive. 1.30 m is in an Italian toll tariff. Those we can cite.
//
// So the page tells a reader which four numbers to find on the contract
// and what each one costs them if they get it wrong, and the contract —
// not us — supplies the numbers. That is also more useful than a spec
// table, because the renter is holding the spec table already.

export interface ThresholdSource {
  name: string;
  url: string;
}

export interface Threshold {
  id: string;
  /** The number itself, as the rule states it. */
  value: string;
  /** What the number measures. */
  what: string;
  /** What crossing it changes, in the order it will bite. */
  decides: string[];
  source: ThresholdSource;
}

export const THRESHOLDS: Threshold[] = [
  {
    id: 'mass',
    value: '3 500 kg',
    what: 'Maximum authorised mass (MAM) — the loaded weight the vehicle is type-approved for, not what it weighs empty',
    decides: [
      'Whether an ordinary category B licence covers it at all. Above 3 500 kg you need C1, which is a separate test.',
      'Which road-charging system you are in. ASFINAG sells the Austrian vignette to “cars, motorbikes and camper vans up to 3.5 tons”, and DARS sells the Slovenian e-vignette for vehicles “up to 3 500 kilograms”; above that, both countries move you into the distance-based systems built for lorries.',
      'What winter equipment you must carry. Slovenia asks vehicles up to 3 500 kg for winter tyres on all four wheels and heavier vehicles for winter tyres on the driven wheels — the same number again, deciding something else.',
      'In several member states, a lower speed limit and different rules on which lanes you may use. The national road authority is the one to ask.',
    ],
    source: {
      name: 'Directive 2006/126/EC on driving licences, Article 4(4)',
      url: 'https://eur-lex.europa.eu/eli/dir/2006/126/oj',
    },
  },
  {
    id: 'payload',
    value: 'MAM minus mass in running order',
    what: 'Payload — everything you are allowed to put in, including water, gas, bikes and passengers',
    decides: [
      'Whether you are legal once loaded. The mass in running order of a motor caravan already includes a 75 kg driver and a 90% full fuel tank, so the figure left over is smaller than it looks.',
      'How much fresh water you may carry. Water weighs a kilogram a litre; a full 100-litre tank is 100 kg of a payload that is often measured in a few hundred.',
      'Nothing about it is the rental company’s problem at a roadside weighbridge. The driver is the one weighed.',
    ],
    source: {
      name:
        'Regulation (EU) No 1230/2012 on masses and dimensions, Annex I (mass in running order)',
      url: 'https://eur-lex.europa.eu/eli/reg/2012/1230/oj',
    },
  },
  {
    id: 'height',
    value: '1.30 m, 2.00 m, 3.00 m',
    what: 'Height — measured differently by different people, which is the trap',
    decides: [
      'In France the toll classes are drawn at 2 m and at 3 m: up to 2 m and 3.5 t is class 1, above 2 m is class 2 — which ASFA itself describes as where most motor caravans sit — and at 3 m or above you are in class 3 with the lorries.',
      'In Italy the step is 1.30 m and it is measured AT THE FRONT AXLE, not at the roof. Below it is class A, above it class B, and essentially every camper is above it.',
      'Height barriers on city car parks and at some campsite entrances are commonly set around 2 m. Roof boxes, aerials and air-conditioning units are part of your height and are not on the contract.',
    ],
    source: {
      name: 'ASFA — French vehicle classification',
      url: 'https://www.autoroutes.fr/fr/classification-des-vehicules.htm',
    },
  },
  {
    id: 'length',
    value: '6.00 m',
    what: 'Overall length, including the tow bar, the bike rack and the spare wheel',
    decides: [
      'The Danish Great Belt crossing prices by length: its published tariff has one rate for a car of 3–6 m and a higher one for a car over 6 m, with height entering the categories above that. A great many motorhomes sit on the wrong side of the step.',
      'Ferry fares across the Union are quoted per metre band, and a rack you added is billed the same as bodywork.',
      'Whether a pitch fits. We hold no pitch dimensions for any campsite in our database, so this is the one number on this list nothing on this site can check for you. Ring the site.',
    ],
    source: {
      name: 'Sund & Bælt — Great Belt tariffs by vehicle length',
      url: 'https://www.storebaelt.dk/priser-rabatter/privat/',
    },
  },
];

/**
 * The shapes a fleet offers, described by what defines them geometrically
 * and nothing else.
 *
 * 🔴 No dimensions, no masses, no models, no prices. Each entry says what
 * makes the shape that shape — a fact of construction, true of every
 * example of it — and then points at the number on the contract that the
 * shape tends to put under pressure. The contract has the figures; this
 * list only says which of them to read first.
 */
export interface CamperShape {
  id: string;
  name: string;
  /** True by construction, not by fleet averages. */
  defined: string;
  /** Which threshold above to check first for this shape. */
  checkFirst: Threshold['id'];
  why: string;
}

export const SHAPES: CamperShape[] = [
  {
    id: 'van',
    name: 'Panel van conversion',
    defined:
      'Built inside an unmodified delivery-van body, so its height, width and length are the van’s.',
    checkFirst: 'height',
    why:
      'Some van bases clear a 2 m barrier and some do not, and the difference decides whether town car parks are open to you. The figure is on the contract; a roof box is not.',
  },
  {
    id: 'low-profile',
    name: 'Low-profile motorhome',
    defined:
      'A coachbuilt body on a chassis cab, with no bed over the driver’s cab — which is what keeps the roofline low.',
    checkFirst: 'payload',
    why:
      'The shape most often built right up to the 3 500 kg limit so it stays on a B licence, which is exactly where payload gets tight.',
  },
  {
    id: 'overcab',
    name: 'Overcab (alcove) motorhome',
    defined:
      'The same coachbuilt body with a bed built over the cab, which adds berths and adds height.',
    checkFirst: 'height',
    why:
      'The extra berths are free; the height is not. It is the shape most likely to find a barrier or a branch.',
  },
  {
    id: 'a-class',
    name: 'Integrated (A-class) motorhome',
    defined:
      'The cab is part of the habitation body rather than a separate chassis cab, so the vehicle is one shell from front to back.',
    checkFirst: 'mass',
    why:
      'The larger builds are frequently plated above 3 500 kg, which takes them off a B licence and out of the vignette systems in one step.',
  },
  {
    id: 'caravan',
    name: 'Car and caravan',
    defined:
      'Two vehicles: the licence question is about the combination, not about either one.',
    checkFirst: 'mass',
    why:
      'A B licence tows a trailer up to 750 kg outright; heavier combinations depend on the total and may need the code 96 training or a BE licence. The directive linked above sets the arithmetic.',
  },
];
