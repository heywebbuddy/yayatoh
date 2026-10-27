/** Roles a featured person can have on the public page, in the order their sections appear. */
export const SPEAKER_ROLES = [
  'keynote',
  'speaker',
  'panelist',
  'moderator',
  'host',
  'dj',
  'artist',
  'influencer',
  'special_guest',
] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

/** Position of a role in the public order (unknown roles sort last). */
export const speakerRoleRank = (role: string): number => {
  const i = (SPEAKER_ROLES as readonly string[]).indexOf(role);
  return i < 0 ? SPEAKER_ROLES.length : i;
};

/** People grouped by role in the public order; featured people first, then by name. */
export function groupByRole<T extends { role: string; featured: boolean; name: string }>(
  people: readonly T[],
): { role: SpeakerRole; people: T[] }[] {
  const out: { role: SpeakerRole; people: T[] }[] = [];
  for (const role of SPEAKER_ROLES) {
    const inRole = people
      .filter((p) => p.role === role)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
    if (inRole.length > 0) out.push({ role, people: inRole });
  }
  return out;
}
