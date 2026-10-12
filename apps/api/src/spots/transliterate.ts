// CAMP-291: a name in Greek or Cyrillic leaves no letter a URL can carry.
//
// Measured in the database on 12.10.2026:
//
//     campsites whose name is not Latin:   200
//     of those, published as spot-<id>:    188   (94%)
//
//     GR 102 (93 nameless URLs) · BG 91 (89) · RO 4 · CY 1 · ES 1 · LV 1
//
// For Greece that is 93 of the country's 102 campsites and for Bulgaria
// 89 of 91: in a project whose only channel is organic search, almost
// the whole presence in two member states is a page nobody can find.
//
// 🔴 THIS FILE TRANSLITERATES. IT DOES NOT TRANSLATE.
//
// «Κάμπινγκ» means "camping" and «Къмпинг» means "camping", and neither
// is rendered as the English word here. A campsite's name belongs to
// the campsite; turning it into another language is inventing a name
// nobody chose. The letters change, the word does not.
//
// 🔴 AND THE TABLES ARE BUILT FROM THE LETTERS THAT ARE ACTUALLY THERE,
// not from the whole of either standard. The inventory was read out of
// the live rows, so a rule exists here only where a real name needs it:
//
//     Cyrillic: ІАБВГДЕЗИКЛМНОПРСТХЦЧШЮЯабвгдежзийклмнопрстуфхцчшщъьюяі
//     Greek:    ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΧΩαβγδεζηθικλμνοπρςστυφχψω
//
//     Cyrillic (composed): й
//     Greek (accented):    ΆΈ ά έ ή ί ό ύ ώ
//
// 🔴 The accented vowels ARE in the table, and an earlier version of
// this very comment said they were left out "on purpose, because NFD
// splits the tonos off". That was written before the order was
// settled, stayed after it was, and said the opposite of the code 80
// lines below. A comment that contradicts its own file is worse than
// none: the reader believes it.

/**
 * Bulgarian, by the Transliteration Act of 2009.
 *
 * 🔴 ONE SYSTEM, AND THAT IS WHY BULGARIA IS THE EASY HALF. The state
 * legislated a single romanisation — it is what appears on Bulgarian
 * passports and road signs — so there is nothing to choose between.
 */
const BULGARIAN: ReadonlyArray<readonly [string, string]> = [
  ['щ', 'sht'],
  ['ж', 'zh'],
  ['ц', 'ts'],
  ['ч', 'ch'],
  ['ш', 'sh'],
  ['ю', 'yu'],
  ['я', 'ya'],
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['д', 'd'],
  ['е', 'e'],
  ['з', 'z'],
  ['и', 'i'],
  ['й', 'y'],
  ['к', 'k'],
  ['л', 'l'],
  ['м', 'm'],
  ['н', 'n'],
  ['о', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['у', 'u'],
  ['ф', 'f'],
  ['х', 'h'],
  // 🔴 `ъ → a`. The Act says so, and it is the letter English speakers
  // meet in "Bulgaria" itself (България). It is not an apostrophe and
  // it is not nothing.
  ['ъ', 'a'],
  ['ь', 'y'],
  // 🔴 `й` IS A COMPOSED LETTER, and that is why it is here rather
  // than left to the decomposition. NFD splits it into `и` + breve and
  // the breve is stripped, so a table that ran afterwards would read it
  // as `и` and write `i`: «Чайка» came out `chaika` instead of
  // `chayka`. Measured on the live row.
  ['й', 'y'],
  // Ukrainian `і`, present on two Romanian border rows whose OSM name
  // is Ukrainian (Піп-Іван Мармароський). Unambiguous in every
  // romanisation of either language.
  ['і', 'i'],
];

/**
 * Greek, by ELOT 743.
 *
 * 🔴 ELOT 743 AND NOT ISO 843, because ELOT is what the Greek state
 * prints on passports and road signs — the spelling a reader has
 * already seen for the same place.
 *
 * 🔴 THE DIGRAPHS THAT EARN THEIR PLACE, AND NO OTHERS. `ου → ou` and
 * `αυ/ευ → av/ev` are here because without them real names come out
 * unreadable: Βούλας becomes "voylas" instead of "voulas", and
 * Αυτοδιαχειριζόμενο becomes "aytodiacheirizomeno" instead of
 * "avtodiacheirizomeno". ELOT's voicing rule (αυ → af before a
 * voiceless consonant) is NOT implemented: it needs the next phoneme,
 * and getting it wrong half the time is worse than one consistent
 * spelling a reader can learn.
 *
 * μπ, ντ, γκ are left letter by letter — "mp", "nt", "gk" — which is
 * ELOT's own general case; the b/d/g readings apply at the start of a
 * word, and that exception is not worth a rule nobody can check.
 */
const GREEK: ReadonlyArray<readonly [string, string]> = [
  // 🔴 THE ACCENTED VOWELS ARE IN THE TABLE, and the first version left
  // them out "because NFD strips the tonos". It does — but only if the
  // decomposition runs first, and then there is no Greek letter left
  // for this table to read: `Αστερίας` came out `aster-as`. A script
  // this table owns, it owns whole.
  ['ού', 'ou'],
  ['ΟΎ', 'ou'],
  ['αύ', 'av'],
  ['εύ', 'ev'],
  ['ου', 'ou'],
  ['ΟΥ', 'ou'],
  ['Ου', 'ou'],
  ['αυ', 'av'],
  ['ΑΥ', 'av'],
  ['Αυ', 'av'],
  ['ευ', 'ev'],
  ['ΕΥ', 'ev'],
  ['Ευ', 'ev'],
  ['θ', 'th'],
  ['χ', 'ch'],
  ['ψ', 'ps'],
  ['ξ', 'x'],
  ['α', 'a'],
  ['β', 'v'],
  ['γ', 'g'],
  ['δ', 'd'],
  ['ε', 'e'],
  ['ζ', 'z'],
  ['η', 'i'],
  ['ι', 'i'],
  ['κ', 'k'],
  ['λ', 'l'],
  ['μ', 'm'],
  ['ν', 'n'],
  ['ο', 'o'],
  ['π', 'p'],
  ['ρ', 'r'],
  // Final sigma is the same letter in a different place in the word.
  ['ς', 's'],
  ['σ', 's'],
  ['τ', 't'],
  ['υ', 'y'],
  ['φ', 'f'],
  ['ω', 'o'],
  ['ά', 'a'],
  ['έ', 'e'],
  ['ή', 'i'],
  ['ί', 'i'],
  ['ό', 'o'],
  ['ύ', 'y'],
  ['ώ', 'o'],
  ['ϊ', 'i'],
  ['ϋ', 'y'],
  ['ΐ', 'i'],
  ['ΰ', 'y'],
  // 🔴 APPENDED HERE ON PURPOSE, at the natural end of the table
  // rather than up with the other digraphs.
  //
  // Review removed the `.sort()` below and all 1 394 tests stayed
  // green: every digraph happened to be hand-placed above its own
  // letters, so the sort was doing nothing and nothing said so. These
  // rows sit where a person would actually append one, which makes the
  // sort load-bearing — and `Ευαγγελικής` proves it.
  ['γγ', 'ng'],
  ['ΓΓ', 'ng'],
  ['Γγ', 'ng'],
  ['γξ', 'nx'],
  ['γχ', 'nch'],
  // The capitalised diphthongs carry the accent on the SECOND vowel,
  // so `Εύβοια` is the capitalised form of `ευ` — and without these it
  // came out `eyvoia`. No row carries one today; the next Greek import
  // with a place like Εύβοια or Ούλα would have got it silently wrong.
  ['Ού', 'ou'],
  ['Αύ', 'av'],
  ['Εύ', 'ev'],
];

/**
 * Rule 5 of the Transliteration Act: word-final «ия» is «ia».
 *
 * 🔴 NOT a letter rule, which is why it sits apart. Bulgaria's own
 * submission to UNGEGN (E/CONF.101/12, p.4) states it as an exception
 * to the table, and five live rows need it: Анастасия, Камчия (twice),
 * Гардения, Селския двор край морето. Letter by letter they come out
 * `…iya`; the Act says `…ia`, which is the spelling on the road signs
 * a reader has already passed.
 *
 * `\p{L}` rather than `\b`, because JavaScript's word boundary is
 * ASCII and would fire in the middle of every Cyrillic word.
 */
const WORD_FINAL_IYA = /ия(?!\p{L})/gu;
const WORD_FINAL_IYA_UPPER = /ИЯ(?!\p{L})/gu;

/** Both tables, longest source first so a digraph wins over its letters. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [...GREEK, ...BULGARIAN]
  .flatMap(([from, to]) =>
    from === from.toUpperCase()
      ? ([[from, to]] as const)
      : ([
          [from, to],
          [from.toUpperCase(), to],
        ] as const),
  )
  .slice()
  .sort((a, b) => b[0].length - a[0].length);

/**
 * A name written in a script this project's URLs cannot carry, written
 * in the letters they can.
 *
 * Returns the text unchanged when there is nothing to transliterate,
 * which is every name in every other member state.
 */
export function transliterate(text: string): string {
  let out = text
    .replace(WORD_FINAL_IYA, 'ia')
    .replace(WORD_FINAL_IYA_UPPER, 'ia');
  for (const [from, to] of PAIRS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}
