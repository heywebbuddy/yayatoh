/**
 * Words that name a table or a row in the product's languages. A label an organizer (or a demo
 * seed) typed as "Table 1" is already a full name; every place that adds the word itself
 * ("Table {label}", "Row {label}") would double it, so it uses `bareItemLabel` first.
 */
const PLACE_WORDS = [
  'table',
  'row',
  'tisch',
  'reihe',
  'mesa',
  'fila',
  'tavolo',
  'tafel',
  'rij',
  'rang',
  'rangée',
  'стол',
  'ряд',
  'テーブル',
  '桌',
  '排',
  'طاولة',
  'صف',
  'टेबल',
  'मेज़',
  'पंक्ति',
];

const LEADING_WORD = new RegExp(String.raw`^(?:${PLACE_WORDS.join('|')})(?:\s*[:#.\-–]\s*|\s+)(?=\S)`, 'iu');
const CJK_WORD = /^(?:テーブル|桌|排)(?=[0-9A-Za-z])/u;

/** "Table 1" → "1", "Row A" → "A", "Head table" and "12" are unchanged. */
export function bareItemLabel(label: string): string {
  const s = label.trim();
  const stripped = s.replace(LEADING_WORD, '').replace(CJK_WORD, '');
  return stripped.length > 0 ? stripped : s;
}
