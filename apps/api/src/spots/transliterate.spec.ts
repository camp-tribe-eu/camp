import { transliterate } from './transliterate';
import { foldToAscii } from './canonical';

// CAMP-291 — 188 campsites whose address carried no word at all.
//
// 🔴 The names below are real rows, not invented ones. A table checked
// against examples somebody made up is a table checked against itself.

/** Every Greek and Cyrillic letter present in the live rows (12.10.2026). */
const INVENTORY =
  'ІАБВГДЕЗИКЛМНОПРСТХЦЧШЮЯабвгдежзийклмнопрстуфхцчшщъьюяі' +
  'ΆΈΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΧΩάέήίαβγδεζηθικλμνοπρςστυφχψωόύώ';

describe('🔴 every letter the data actually contains has a rule', () => {
  it.each([...INVENTORY])('%s becomes a Latin letter', (ch) => {
    const out = foldToAscii(ch);
    expect(out).not.toBe('');
    expect(out).toMatch(/^[a-z0-9]+$/);
  });

  it('…and the inventory is the one that was measured', () => {
    // A shrinking inventory would quietly stop testing the letters it
    // dropped. 55 Cyrillic + 55 Greek, counted from the live rows.
    expect(INVENTORY).toHaveLength(110);
  });
});

describe('Bulgarian, by the Transliteration Act of 2009', () => {
  it.each([
    ['Нестинарка', 'nestinarka'],
    ['Добруджа', 'dobrudzha'],
    ['Тюленово', 'tyulenovo'],
    ['Къмпинг Весело село', 'kamping-veselo-selo'],
    ['Ваканционното селище „Чайка”', 'vakantsionnoto-selishte-chayka'],
    ['Св. Кирик', 'sv-kirik'],
  ])('%s → %s', (from, to) => {
    expect(foldToAscii(from)).toBe(to);
  });

  it('🔴 й is y, not i — it is a composed letter and NFD would eat it', () => {
    // Transliterating after the decomposition read it as `и` and wrote
    // «Чайка» as `chaika`. Measured on the live row.
    expect(foldToAscii('Чайка')).toBe('chayka');
    expect(foldToAscii('й')).toBe('y');
  });

  it('ъ is a, which is the letter in България itself', () => {
    expect(foldToAscii('Къмпинг')).toBe('kamping');
  });
});

describe('Greek, by ELOT 743', () => {
  it.each([
    ['Αστερίας', 'asterias'],
    ['Ακτή Ρετζίκα', 'akti-retzika'],
    ['Κατασκήνωση ΚΟΡΕΛΚΟ', 'kataskinosi-korelko'],
    ['Κατασκηνώσεις Ερυθρού Σταυρού', 'kataskinoseis-erythrou-stavrou'],
    [
      'Αυτοδιαχειριζόμενο Κάμπινγκ Βούλας',
      'avtodiacheirizomeno-kampingk-voulas',
    ],
  ])('%s → %s', (from, to) => {
    expect(foldToAscii(from)).toBe(to);
  });

  it('🔴 the accented vowels are the table’s own, not NFD’s', () => {
    // Leaving them out and decomposing first wrote `Αστερίας` as
    // `aster-as`: the bare ι came back with nothing left to read it.
    expect(foldToAscii('ί')).toBe('i');
    expect(foldToAscii('ώ')).toBe('o');
    expect(foldToAscii('ΐ')).toBe('i');
  });

  it('🔴 the digraphs that earn their place', () => {
    // Without them: voylas, aytodiacheirizomeno. With them a reader
    // recognises the name.
    expect(foldToAscii('ού')).toBe('ou');
    expect(foldToAscii('αυ')).toBe('av');
    expect(foldToAscii('ευ')).toBe('ev');
  });

  it('final sigma is the same letter as sigma', () => {
    expect(foldToAscii('ΣΣς')).toBe('sss');
  });
});

describe('🔴 what must NOT change', () => {
  it('a Latin name is untouched by the transliterator', () => {
    for (const name of [
      'Søby Strand Camping',
      'Camping Les Pins',
      'Skåne',
      'Šibensko-Kninska',
      'Großostheim',
    ]) {
      expect(transliterate(name)).toBe(name);
    }
  });

  it('…and still folds exactly as it did before', () => {
    expect(foldToAscii('Skåne')).toBe('skane');
    expect(foldToAscii('Søby Strand Camping')).toBe('soby-strand-camping');
    expect(foldToAscii('Großostheim')).toBe('grossostheim');
    expect(foldToAscii('Šibensko-Kninska')).toBe('sibensko-kninska');
  });

  it('🔴 it transliterates and never translates', () => {
    // «Κάμπινγκ» and «Къмпинг» both mean "camping". Neither becomes the
    // English word: the campsite's name belongs to the campsite.
    expect(foldToAscii('Κάμπινγκ')).toBe('kampingk');
    expect(foldToAscii('Къмпинг')).toBe('kamping');
  });
});
