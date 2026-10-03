/**
 * M5.6b: whether a person may capture leads with their seat. Seats are ranked by when they were
 * given (oldest first); when the allowance shrinks below the seats in use (a package cancelled),
 * the newest seats stand beyond it and capture refuses them until the admin takes some back.
 */
export type LeadSeatStanding = 'licensed' | 'unlicensed' | 'over_allowance';

export function leadSeatStanding(
  seats: readonly { readonly accountId: string; readonly createdAt: Date; readonly id: string }[],
  accountId: string,
  allowance: number,
): LeadSeatStanding {
  const ranked = [...seats].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const i = ranked.findIndex((s) => s.accountId === accountId);
  if (i < 0) return 'unlicensed';
  return i < allowance ? 'licensed' : 'over_allowance';
}
