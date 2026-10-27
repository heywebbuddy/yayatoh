import type { TenantTx } from '@yayatoh/db';
import { portalAccountsTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { SponsorDto, SponsorTierDto } from './dto.ts';
import { sponsorsOf, sponsorTiersOf } from './people.ts';
import { sponsorPackages, sponsorTeamMembers } from './schema-sponsors.ts';
import { eventOf } from './shared.ts';

/** How many of the highest tiers get a detail page (and bigger cards). */
export const SPONSOR_PAGE_TIERS = 2;

export type VisibleSponsor = { sponsor: SponsorDto; tier: SponsorTierDto; rank: number };

/**
 * The sponsors the website shows. A tier whose package leaves out the `website` logo placement
 * shows none of its sponsors; a tier without a package keeps showing (sponsors added by hand).
 * `rank` counts the tiers that show someone, highest first (0 = the top tier).
 */
export async function websiteSponsorsTx(tx: TenantTx, eventId: string): Promise<VisibleSponsor[]> {
  const tiers = await sponsorTiersOf(tx, eventId);
  const sponsorList = await sponsorsOf(tx, eventId);
  const packages = await tx
    .select({ tierId: sponsorPackages.tierId, logoPlacements: sponsorPackages.logoPlacements })
    .from(sponsorPackages)
    .where(eq(sponsorPackages.eventId, eventId));
  const hidden = new Set(packages.filter((p) => !p.logoPlacements.includes('website')).map((p) => p.tierId));
  const out: VisibleSponsor[] = [];
  let rank = 0;
  for (const tier of tiers) {
    if (hidden.has(tier.id)) continue;
    const inTier = sponsorList.filter((s) => s.tierId === tier.id);
    if (inTier.length === 0) continue;
    for (const sponsor of inTier) out.push({ sponsor, tier, rank });
    rank += 1;
  }
  return out;
}

export const hasSponsorPage = (rank: number) => rank < SPONSOR_PAGE_TIERS;

/* ------------------------------------------------------------------------------------ team ---- */

export const SponsorTeamMemberDto = z.object({
  id: z.uuid(),
  sponsorId: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  accountId: z.uuid().nullable(),
  /** The linked portal account's email (organizer view only). */
  accountEmail: z.string().nullable(),
});
export type SponsorTeamMemberDto = z.infer<typeof SponsorTeamMemberDto>;

export async function sponsorTeamTx(tx: TenantTx, eventId: string): Promise<SponsorTeamMemberDto[]> {
  const rows = await tx
    .select()
    .from(sponsorTeamMembers)
    .where(eq(sponsorTeamMembers.eventId, eventId))
    .orderBy(asc(sponsorTeamMembers.position), asc(sponsorTeamMembers.createdAt));
  const accounts = new Map(
    (await portalAccountsTx(tx, eventId, 'sponsor', new Date())).map((a) => [a.id, a]),
  );
  return rows.map((r) => ({
    id: r.id,
    sponsorId: r.sponsorId,
    name: r.name,
    title: r.title,
    accountId: r.accountId,
    accountEmail: r.accountId ? (accounts.get(r.accountId)?.email ?? null) : null,
  }));
}

export const sponsorTeamQuery = tenantQuery({
  name: 'program.sponsorTeam',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SponsorTeamMemberDto),
  entitlement: 'sponsors',
  permission: 'events:read',
  handler: ({ input, tx }) => sponsorTeamTx(tx, input.eventId),
});

const TeamInput = z.object({
  eventId: z.uuid(),
  sponsorId: z.uuid(),
  members: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        title: z
          .string()
          .trim()
          .max(120)
          .nullable()
          .default(null)
          .transform((v) => v || null),
        /** The email of one of the sponsor's portal accounts, to link the person to it. */
        accountEmail: z
          .string()
          .trim()
          .max(254)
          .nullable()
          .default(null)
          .transform((v) => v || null),
      }),
    )
    .max(30),
});

/** Replace a sponsor's team at the event (names, titles, optional portal-account links). */
export const setSponsorTeamCommand = tenantCommand({
  name: 'program.setSponsorTeam',
  input: TeamInput,
  output: z.object({ count: z.int() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const accounts = (await portalAccountsTx(tx, input.eventId, 'sponsor', ctx.now)).filter(
      (a) => a.subjectId === input.sponsorId,
    );
    const rows = input.members.map((m, position) => {
      let accountId: string | null = null;
      if (m.accountEmail) {
        const wanted = m.accountEmail.toLowerCase();
        const account = accounts.find((a) => a.email.toLowerCase() === wanted);
        if (!account)
          throw new DomainError('validation_failed', 'Unknown portal account', {
            field: 'team',
            reason: 'unknown_account',
          });
        accountId = account.id;
      }
      return {
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        sponsorId: input.sponsorId,
        name: m.name,
        title: m.title,
        accountId,
        position,
      };
    });
    await tx
      .delete(sponsorTeamMembers)
      .where(
        and(eq(sponsorTeamMembers.eventId, input.eventId), eq(sponsorTeamMembers.sponsorId, input.sponsorId)),
      );
    if (rows.length > 0) await tx.insert(sponsorTeamMembers).values(rows);
    return { count: rows.length };
  },
  audit: (input) => ({
    action: 'program.sponsor.team',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, count: input.members.length },
  }),
});
