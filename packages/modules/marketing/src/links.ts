import { isUniqueViolation, type TenantTx, withoutTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { appTokenSecret, tenantCommand } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { pseudonym } from './domain/click-token.ts';
import { destinationProblem } from './domain/destination.ts';
import { CreateTrackedLinkInput, TrackedLinkDto } from './dto.ts';
import { linkClicks, trackingLinks } from './schema.ts';

/** No 0/o, 1/l/i: codes are read aloud and typed from print (like event short codes). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const LINK_CODE_LENGTH = 8;

export function generateLinkCode(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let s = '';
  while (s.length < LINK_CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(LINK_CODE_LENGTH * 2))) {
      if (b < limit && s.length < LINK_CODE_LENGTH) s += ALPHABET[b % ALPHABET.length];
    }
  }
  return s;
}

type LinkRow = typeof trackingLinks.$inferSelect;

export const toLinkDto = (r: LinkRow): TrackedLinkDto => ({
  id: r.id,
  eventId: r.eventId,
  code: r.code,
  label: r.label,
  source: r.utmSource,
  medium: r.utmMedium,
  campaign: r.utmCampaign,
  content: r.utmContent,
  term: r.utmTerm,
  destinationPath: r.destinationPath,
  campaignId: r.campaignId,
  journeyStepId: r.journeyStepId,
  createdAt: r.createdAt,
});

/**
 * Create a tracked link inside the caller's tenant transaction. The hook for M3.6b campaigns and
 * M3.7a journeys (`campaignId` / `journeyStepId`): they call it from their own commands, which
 * carry the permission and audit. The event must be the org's; the destination must be a safe
 * same-site path (open-redirect guard); the code is global and retried on a clash.
 */
export async function createTrackedLinkTx(
  tx: TenantTx,
  ctx: Ctx,
  raw: CreateTrackedLinkInput,
): Promise<TrackedLinkDto> {
  const input = CreateTrackedLinkInput.parse(raw);
  const orgId = requireOrg(ctx);
  const event = await findEventTx(tx, input.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const path = input.destinationPath?.trim() || null;
  if (path) {
    const problem = destinationProblem(path);
    if (problem)
      throw new DomainError('validation_failed', 'Invalid destination', {
        reason: `destination_${problem}`,
        field: 'destinationPath',
      });
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(trackingLinks)
          .values({
            id: uuidv7(ctx.now.getTime()),
            orgId,
            eventId: event.id,
            code: generateLinkCode(),
            label: input.label ?? null,
            utmSource: input.source,
            utmMedium: input.medium,
            utmCampaign: input.campaign,
            utmContent: input.content ?? null,
            utmTerm: input.term ?? null,
            destinationPath: path,
            campaignId: input.campaignId ?? null,
            journeyStepId: input.journeyStepId ?? null,
            createdBy: actorId(ctx.actor),
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      return toLinkDto(row);
    } catch (err) {
      if (!isUniqueViolation(err, 'tracking_links_code_key')) throw err;
    }
  }
  throw new DomainError('internal', 'Could not allocate a link code');
}

/** Console: create a tracked link for an event (source, medium, campaign; optional extras). */
export const createTrackedLinkCommand = tenantCommand({
  name: 'marketing.createTrackedLink',
  input: CreateTrackedLinkInput,
  output: TrackedLinkDto,
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: ({ input, ctx, tx }) => createTrackedLinkTx(tx, ctx, input),
  audit: (input, r) => ({
    action: 'marketing.tracked_link.create',
    targetType: 'tracked_link',
    targetId: r.id,
    data: { eventId: input.eventId },
  }),
});

export interface TrackedLinkTarget {
  readonly orgId: string;
  readonly linkId: string;
  readonly eventId: string;
  readonly slug: string;
  readonly destinationPath: string | null;
  readonly utm: {
    source: string;
    medium: string;
    campaign: string;
    content: string | null;
    term: string | null;
  };
}

/**
 * `/r/{code}` → the link (cross-tenant, SECURITY DEFINER, allowlisted columns). Only links of
 * live orgs whose event has a public page resolve (drafts and archived events never do).
 */
export async function resolveTrackedLink(code: string): Promise<TrackedLinkTarget | null> {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(normalized)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<Record<string, string | null>>(
      sql`select * from marketing.tracked_link_target(${normalized})`,
    ),
  );
  const r = rows[0];
  if (!r?.org_id || !r.link_id || !r.event_id || !r.slug) return null;
  return {
    orgId: r.org_id,
    linkId: r.link_id,
    eventId: r.event_id,
    slug: r.slug,
    destinationPath: r.destination_path ?? null,
    utm: {
      source: r.utm_source ?? '',
      medium: r.utm_medium ?? '',
      campaign: r.utm_campaign ?? '',
      content: r.utm_content ?? null,
      term: r.utm_term ?? null,
    },
  };
}

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Record one human click (the redirector already filtered bots and rate-limited floods). Public:
 * the org comes from the link lookup, never from the request. Returns the click id to sign.
 */
export const recordClickCommand = tenantCommand({
  name: 'marketing.recordClick',
  input: z.object({
    linkId: z.uuid(),
    /** The `yy_did` device cookie (hashed here, never stored). */
    deviceId: z.string().regex(DEVICE_ID).nullish(),
    /** The client IP (hashed here, never stored). */
    ip: z.string().max(64).nullish(),
  }),
  output: z.object({ clickId: z.uuid() }),
  entitlement: 'marketing',
  permission: 'public:track',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [link] = await tx
      .select({ id: trackingLinks.id, eventId: trackingLinks.eventId })
      .from(trackingLinks)
      .where(eq(trackingLinks.id, input.linkId));
    if (!link) throw new DomainError('not_found');
    const secret = appTokenSecret();
    const clickId = uuidv7(ctx.now.getTime());
    await tx.insert(linkClicks).values({
      id: clickId,
      orgId,
      linkId: link.id,
      eventId: link.eventId,
      clickedAt: ctx.now,
      deviceHash: input.deviceId ? pseudonym('device', input.deviceId, secret) : null,
      ipHash: input.ip?.trim() ? pseudonym('ip', input.ip.trim(), secret) : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return { clickId };
  },
  audit: (input) => ({
    action: 'marketing.tracked_link.click',
    targetType: 'tracked_link',
    targetId: input.linkId,
  }),
});
