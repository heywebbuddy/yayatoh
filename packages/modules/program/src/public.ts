import { withTenant } from '@yayatoh/db';
import type { EventTarget } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { boothPlanTx } from './booths.ts';
import {
  type PublicExhibitorPageDto,
  type PublicProgramDto,
  type PublicSpeakerPageDto,
  type PublicSponsorPageDto,
  publicExhibitorPageSerializer,
  publicProgramSerializer,
  publicSpeakerPageSerializer,
  publicSponsorPageSerializer,
} from './dto.ts';
import { unlistedExhibitorIdsTx } from './exhibitor-portal.ts';
import { exhibitorsOf, speakersOf } from './people.ts';
import { currentPublicSessionsTx, draftOnlySpeakerIdsTx, servedPublicSessionsTx } from './public-session.ts';
import { exhibitorProfiles } from './schema.ts';
import { hasSponsorPage, sponsorTeamTx, websiteSponsorsTx } from './sponsor-pages.ts';

/**
 * The public program of an event that has a public page. Callers resolve the target first
 * (`pageTarget(slug)`, or an access-code–unlocked private event), exactly as for the page's
 * sections. Output goes through the allowlist serializer: no capacities, no org data.
 */
export async function publicProgram(target: EventTarget): Promise<PublicProgramDto> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const eventId = target.eventId;
    // M5.2a: a published agenda serves its snapshot; a draft serves no sessions.
    const sessions = await servedPublicSessionsTx(tx, eventId, () => currentPublicSessionsTx(tx, eventId));
    // M5.3b: a speaker whose only sessions are drafts (an accepted proposal) is not announced yet.
    const unannounced = await draftOnlySpeakerIdsTx(tx, eventId);
    const people = (await speakersOf(tx, eventId)).filter((p) => !unannounced.has(p.id));
    // M5.4a: exhibitors the organizer unlisted never reach the public page.
    const unlisted = await unlistedExhibitorIdsTx(tx, eventId);
    const exhibitorList = (await exhibitorsOf(tx, eventId)).filter((x) => !unlisted.has(x.id));
    const shown = await websiteSponsorsTx(tx, eventId);
    const tierGroups: PublicProgramDto['sponsorTiers'] = [];
    for (const { sponsor, tier, rank } of shown) {
      let group = tierGroups.find((g) => g.name === tier.name);
      if (!group) {
        group = {
          name: tier.name,
          size: rank === 0 ? 'large' : rank === 1 ? 'medium' : 'small',
          sponsors: [],
        };
        tierGroups.push(group);
      }
      group.sponsors.push({
        id: sponsor.id,
        name: sponsor.name,
        description: sponsor.description,
        websiteUrl: sponsor.websiteUrl,
        hasPage: hasSponsorPage(rank),
      });
    }
    return publicProgramSerializer.serialize({
      sessions,
      speakers: people,
      exhibitors: exhibitorList,
      sponsorTiers: tierGroups,
    });
  });
}

/** One speaker's public page: their profile and their sessions. Null for an unknown speaker. */
export async function publicSpeaker(
  target: EventTarget,
  speakerId: string,
): Promise<PublicSpeakerPageDto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(speakerId)) return null;
  const program = await publicProgram(target);
  const speaker = program.speakers.find((s) => s.id === speakerId);
  if (!speaker) return null;
  return publicSpeakerPageSerializer.serialize({
    speaker,
    sessions: program.sessions.filter((s) => s.speakers.some((p) => p.id === speakerId)),
  });
}

/** One sponsor's public page: only sponsors the website shows, in the tiers that get a page. */
export async function publicSponsor(
  target: EventTarget,
  sponsorId: string,
): Promise<PublicSponsorPageDto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sponsorId)) return null;
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const found = (await websiteSponsorsTx(tx, target.eventId)).find((v) => v.sponsor.id === sponsorId);
    if (!found || !hasSponsorPage(found.rank)) return null;
    const team = (await sponsorTeamTx(tx, target.eventId)).filter((m) => m.sponsorId === sponsorId);
    const { sponsor } = found;
    return publicSponsorPageSerializer.serialize({
      id: sponsor.id,
      name: sponsor.name,
      tierName: found.tier.name,
      description: sponsor.description,
      longDescription: sponsor.longDescription,
      websiteUrl: sponsor.websiteUrl,
      contactEmail: sponsor.contactEmail,
      contactPhone: sponsor.contactPhone,
      videoUrl: sponsor.videoUrl,
      team: team.map((m) => ({ name: m.name, title: m.title })),
    });
  });
}

/** One listed exhibitor's public page (null for an unknown or unlisted exhibitor). */
export async function publicExhibitor(
  target: EventTarget,
  exhibitorId: string,
): Promise<PublicExhibitorPageDto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(exhibitorId)) return null;
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const unlisted = await unlistedExhibitorIdsTx(tx, target.eventId);
    if (unlisted.has(exhibitorId)) return null;
    const x = (await exhibitorsOf(tx, target.eventId)).find((e) => e.id === exhibitorId);
    if (!x) return null;
    const [profile] = await tx
      .select({ links: exhibitorProfiles.links, categories: exhibitorProfiles.categories })
      .from(exhibitorProfiles)
      .where(eq(exhibitorProfiles.exhibitorId, exhibitorId));
    const plan = await boothPlanTx(tx, target.eventId);
    return publicExhibitorPageSerializer.serialize({
      id: x.id,
      name: x.name,
      description: x.description,
      boothLabel: x.boothLabel,
      boothNumbers: plan.booths
        .filter((b) => b.exhibitors.some((e) => e.exhibitorId === x.id))
        .map((b) => b.number),
      websiteUrl: x.websiteUrl,
      categories: profile?.categories ?? [],
      links: (profile?.links ?? []) as { label: string; url: string }[],
      contactEmail: x.contactEmail,
      contactPhone: x.contactPhone,
      videoUrl: x.videoUrl,
    });
  });
}
