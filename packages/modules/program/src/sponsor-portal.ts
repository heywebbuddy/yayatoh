import { tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { exhibitors, sessions, sponsorTiers } from './schema.ts';
import { sponsorDeliverables, sponsoredSessions, sponsorGrants, sponsorProfiles } from './schema-sponsors.ts';
import { eventOf } from './shared.ts';
import { sponsorPrincipalTx } from './sponsor-allowances.ts';
import { toDeliverable } from './sponsor-deliverables.ts';
import { SponsorPortalDto, sponsorPortalSerializer } from './sponsor-dto.ts';
import { allowancesOf, packagesOfTx } from './sponsor-packages.ts';

/**
 * The sponsor portal (M5.4b, P5-7): what a signed-in sponsor contact sees — only their own
 * sponsor at their one event: its package and allowances (comp code, badges, licenses, logo
 * placements, sponsored sessions), the packages it can buy while it holds none, and its
 * deliverables checklist (due dates in the event's time zone, overdue flagged).
 */
export const sponsorPortalQuery = tenantQuery({
  name: 'program.sponsorPortal',
  input: z.object({}),
  output: SponsorPortalDto,
  entitlement: 'sponsors',
  permission: 'portal:sponsor_contact',
  handler: async ({ ctx, tx }) => {
    const { principal: me, sponsor } = await sponsorPrincipalTx(tx, ctx);
    const event = await eventOf(tx, me.eventId);
    const [tier] = await tx.select().from(sponsorTiers).where(eq(sponsorTiers.id, sponsor.tierId));
    const [profile] = await tx
      .select()
      .from(sponsorProfiles)
      .where(eq(sponsorProfiles.sponsorId, sponsor.id));
    const [exhibitor] = profile?.exhibitorId
      ? await tx
          .select({ name: exhibitors.name })
          .from(exhibitors)
          .where(eq(exhibitors.id, profile.exhibitorId))
      : [];
    const grants = await tx
      .select()
      .from(sponsorGrants)
      .where(
        and(eq(sponsorGrants.sponsorId, sponsor.id), inArray(sponsorGrants.status, ['active', 'pending'])),
      );
    const active = grants.find((g) => g.status === 'active') ?? null;
    const pending =
      grants.find((g) => g.status === 'pending' && g.holdUntil !== null && g.holdUntil > ctx.now) ?? null;
    const packages = await packagesOfTx(tx, me.eventId, ctx.now);
    const mySessions = await tx
      .select({ title: sessions.title, startsAt: sessions.startsAt, endsAt: sessions.endsAt })
      .from(sponsoredSessions)
      .innerJoin(sessions, eq(sessions.id, sponsoredSessions.sessionId))
      .where(eq(sponsoredSessions.sponsorId, sponsor.id))
      .orderBy(asc(sessions.startsAt));
    const deliverables = await tx
      .select()
      .from(sponsorDeliverables)
      .where(eq(sponsorDeliverables.sponsorId, sponsor.id))
      .orderBy(asc(sponsorDeliverables.dueAt), asc(sponsorDeliverables.title), asc(sponsorDeliverables.id));
    return sponsorPortalSerializer.serialize({
      email: me.email,
      event: { name: event.name, timezone: event.timezone, startsAt: event.startsAt, endsAt: event.endsAt },
      sponsor: { name: sponsor.name, tierName: tier?.name ?? '', exhibitorName: exhibitor?.name ?? null },
      grant: active
        ? {
            packageName: packages.find((p) => p.tierId === active.tierId)?.name ?? '',
            source: active.source,
            priceMinor: active.priceMinor,
            currency: active.currency,
            allowances: allowancesOf(active),
            activatedAt: active.activatedAt,
            compCode: active.compCode,
            sessions: mySessions,
          }
        : null,
      pendingUntil: pending?.holdUntil ?? null,
      forSale:
        active || pending
          ? []
          : packages.flatMap((p) =>
              p.terms?.onSale && p.terms.priceMinor !== null
                ? [
                    {
                      tierId: p.tierId,
                      name: p.name,
                      description: p.terms.description,
                      priceMinor: p.terms.priceMinor,
                      currency: p.terms.currency,
                      allowances: p.terms.allowances,
                      soldOut: p.left === 0,
                    },
                  ]
                : [],
            ),
      deliverables: deliverables.map((d) => {
        const {
          sponsorId: _s,
          sponsorName: _n,
          completedBy: _c,
          ...rest
        } = toDeliverable(d, sponsor.name, event.timezone, ctx.now);
        return rest;
      }),
    });
  },
});
