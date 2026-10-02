/**
 * First and last name from a ticket's holder name (tickets keep one full-name field). The
 * rules are deliberately plain and predictable for the organizer:
 * - "Lovelace, Ada" (a comma) → last "Lovelace", first "Ada";
 * - otherwise the first word is the first name and the rest is the last name
 *   ("Ludwig van Beethoven" → "Ludwig" / "van Beethoven");
 * - one word is a first name only.
 */
export function splitName(full: string): { first: string; last: string } {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (!clean) return { first: '', last: '' };
  const comma = clean.indexOf(',');
  if (comma > 0) {
    const last = clean.slice(0, comma).trim();
    const first = clean.slice(comma + 1).trim();
    return first ? { first, last } : { first: last, last: '' };
  }
  const space = clean.indexOf(' ');
  return space < 0
    ? { first: clean, last: '' }
    : { first: clean.slice(0, space), last: clean.slice(space + 1) };
}

/** Lower-case particles and Arabic articles that don't decide where a name files. */
const PARTICLES = /^(?:(?:van|von|der|den|de|del|della|da|di|du|la|le|dos|das|ter|ten|bin|ibn)\s+)+/;
const ARTICLE = /^(?:al-|el-|ال)/i;

/** The key a surname sorts by: "van Beethoven" files under B, "Al-Farsi" / "الفارسي" under F. */
export function surnameSortKey(last: string): string {
  let k = last.trim();
  k = k.replace(PARTICLES, '');
  k = k.replace(ARTICLE, '');
  return k;
}
