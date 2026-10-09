/** Hide an accidental stringified missing value in old public venue names. */
export function venueDisplayName(name: string): string {
  return name.replace(/\s+undefined\s*$/i, '').trim() || name.trim();
}
