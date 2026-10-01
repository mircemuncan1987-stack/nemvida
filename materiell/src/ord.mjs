// De 50 ordene. k = ordklasse/farge (modifisert Fitzgerald-nøkkel, vanlig i ASK).
// e = emoji, eller "svg:<navn>" for tegnede symboler (se bilde.mjs).
// art = ubestemt artikkel for substantiv (en/et), brukt i setningene i bøkene.

export const KATEGORIER = {
  sosial: { navn: 'Sosiale ord', farge: '#d6247f', lys: '#fde8f2' },
  person: { navn: 'Personer', farge: '#c99a00', lys: '#fff6d6' },
  verb: { navn: 'Handlinger', farge: '#2a8f3a', lys: '#e6f6e8' },
  ting: { navn: 'Ting, mat og steder', farge: '#e8760f', lys: '#fff0e0' },
  fole: { navn: 'Følelser og egenskaper', farge: '#1f66cc', lys: '#e5eefc' },
};

export const ORD = [
  // Sosiale ord
  { w: 'ja', e: '✅', k: 'sosial' },
  { w: 'nei', e: '❌', k: 'sosial' },
  { w: 'mer', e: '➕', k: 'sosial' },
  { w: 'ferdig', e: '🏁', k: 'sosial' },
  { w: 'hjelp', e: '🙋', k: 'sosial' },
  { w: 'stopp', e: '🛑', k: 'sosial' },
  { w: 'takk', e: '🙏', k: 'sosial' },
  { w: 'vil ha', e: '🤲', k: 'sosial' },
  // Personer
  { w: 'jeg', e: '🧒', k: 'person' },
  { w: 'mamma', e: '👩', k: 'person' },
  { w: 'pappa', e: '👨', k: 'person' },
  // Handlinger
  { w: 'spise', e: '🍽️', k: 'verb' },
  { w: 'drikke', e: '🥤', k: 'verb' },
  { w: 'sove', e: '😴', k: 'verb' },
  { w: 'leke', e: '🧸', k: 'verb' },
  { w: 'gå', e: '🚶', k: 'verb' },
  { w: 'sitte', e: '🪑', k: 'verb' },
  { w: 'se', e: '👀', k: 'verb' },
  { w: 'vaske', e: '🧼', k: 'verb' },
  { w: 'tegne', e: '✏️', k: 'verb' },
  // Mat og drikke
  { w: 'vann', e: '💧', k: 'ting', art: 'et' },
  { w: 'melk', e: '🥛', k: 'ting', art: 'en' },
  { w: 'brød', e: '🍞', k: 'ting', art: 'et' },
  { w: 'eple', e: '🍎', k: 'ting', art: 'et' },
  { w: 'banan', e: '🍌', k: 'ting', art: 'en' },
  { w: 'is', e: '🍦', k: 'ting', art: 'en' },
  { w: 'mat', e: '🍲', k: 'ting', art: 'en' },
  // Steder og ting
  { w: 'hjem', e: '🏠', k: 'ting', art: 'et' },
  { w: 'skole', e: '🏫', k: 'ting', art: 'en' },
  { w: 'do', e: '🚽', k: 'ting', art: 'en' },
  { w: 'seng', e: '🛏️', k: 'ting', art: 'en' },
  { w: 'bil', e: '🚗', k: 'ting', art: 'en' },
  { w: 'ute', e: '🌳', k: 'ting' },
  { w: 'ball', e: '⚽', k: 'ting', art: 'en' },
  { w: 'bok', e: '📖', k: 'ting', art: 'en' },
  { w: 'nettbrett', e: 'svg:nettbrett', k: 'ting', art: 'et' },
  { w: 'musikk', e: '🎵', k: 'ting' },
  { w: 'sko', e: '👟', k: 'ting', art: 'en' },
  { w: 'hund', e: '🐶', k: 'ting', art: 'en' },
  // Følelser og egenskaper
  { w: 'glad', e: '😀', k: 'fole' },
  { w: 'trist', e: '😢', k: 'fole' },
  { w: 'sint', e: '😠', k: 'fole' },
  { w: 'redd', e: '😨', k: 'fole' },
  { w: 'trøtt', e: '🥱', k: 'fole' },
  { w: 'vondt', e: '🤕', k: 'fole' },
  { w: 'sulten', e: '🤤', k: 'fole' },
  { w: 'varm', e: '🥵', k: 'fole' },
  { w: 'kald', e: '🥶', k: 'fole' },
  { w: 'stor', e: 'svg:stor', k: 'fole' },
  { w: 'liten', e: 'svg:liten', k: 'fole' },
];

export const finn = (w) => {
  const o = ORD.find((x) => x.w === w);
  if (!o) throw new Error('Ukjent ord: ' + w);
  return o;
};

// Bokstavkort: bokstav + et ord som begynner på den.
export const BOKSTAVER = [
  ['A', 'ananas', '🍍'], ['B', 'bil', '🚗'], ['C', 'cowboy', '🤠'], ['D', 'dusj', '🚿'],
  ['E', 'elefant', '🐘'], ['F', 'fly', '✈️'], ['G', 'gitar', '🎸'], ['H', 'hest', '🐴'],
  ['I', 'is', '🍦'], ['J', 'jakke', '🧥'], ['K', 'katt', '🐱'], ['L', 'løve', '🦁'],
  ['M', 'mus', '🐭'], ['N', 'nese', '👃'], ['O', 'ost', '🧀'], ['P', 'pizza', '🍕'],
  ['Q', 'quiz', '❓'], ['R', 'rev', '🦊'], ['S', 'sol', '☀️'], ['T', 'tog', '🚆'],
  ['U', 'ugle', '🦉'], ['V', 'vott', '🧤'], ['W', 'wc', '🚽'], ['X', 'xylofon', 'svg:xylofon'],
  ['Y', 'yoga', '🧘'], ['Z', 'zebra', '🦓'], ['Æ', 'ærfugl', '🦆'], ['Ø', 'øye', '👁️'],
  ['Å', 'åker', '🌾'],
];
