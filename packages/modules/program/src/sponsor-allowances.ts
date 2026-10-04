import type { TenantTx } from '@yayatoh/db';
import { type PortalPrincipal, portalPrincipalTx } from '@yayatoh/events';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq } from 'drizzle-orm';
import { sponsors } from './schema.ts';
import { sponsorGrants, sponsorProfiles } from './schema-sponsors.ts';

/**
 * M5.4b: what active sponsor packages add to an exhibitor (the exhibitor the sponsor exhibits as):
 * staff badges and lead licenses. Computed from the active grants, so cancelling a package or
 * relinking the sponsor changes the allowance at once.
 */
async function activeGrantsOfExhibitorTx(tx: TenantTx, exhibitorId: string) {
  return tx
    .select({ badges: sponsorGrants.exhibitorBadges, licenses: sponsorGrants.leadLicenses })
    .from(sponsorGrants)
    .innerJoin(sponsorProfiles, eq(sponsorProfiles.sponsorId, sponsorGrants.sponsorId))
    .where(and(eq(sponsorProfiles.exhibitorId, exhibitorId), eq(sponsorGrants.status, 'active')));
}

export async function packageBadgesTx(tx: TenantTx, exhibitorId: string): Promise<number[]> {
  return (await activeGrantsOfExhibitorTx(tx, exhibitorId)).map((g) => g.badges);
}

export async function packageLicensesTx(tx: TenantTx, exhibitorId: string): Promise<number[]> {
  return (await activeGrantsOfExhibitorTx(tx, exhibitorId)).map((g) => g.licenses);
}

/**
 * The signed-in sponsor contact, re-checked in the command's transaction: a live portal account
 * of this org (`portalPrincipalTx`) with the `sponsor_contact` role, whose sponsor still exists in
 * its event. Anything else is `forbidden` (another sponsor's ids look the same as unknown ones).
 */
export async function sponsorPrincipalTx(
  tx: TenantTx,
  ctx: Ctx,
  lock = false,
): Promise<{ principal: PortalPrincipal; sponsor: typeof sponsors.$inferSelect }> {
  const p = await portalPrincipalTx(tx, ctx);
  const denied = new DomainError('forbidden', 'Not allowed in this portal');
  if (p.subjectKind !== 'sponsor' || p.role !== 'sponsor_contact') throw denied;
  const q = tx
    .select()
    .from(sponsors)
    .where(and(eq(sponsors.id, p.subjectId), eq(sponsors.eventId, p.eventId)));
  const [sponsor] = await (lock ? q.for('update') : q);
  if (!sponsor) throw denied;
  return { principal: p, sponsor };
}
