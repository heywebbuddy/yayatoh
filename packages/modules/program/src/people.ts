import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { safeHref, sanitizeMarkdown } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ExhibitorDto, SpeakerDto, SponsorDto, SponsorTierDto } from './dto.ts';
import { endExhibitorRolesTx } from './exhibitor-portal.ts';
import { exhibitors, speakers, sponsors, sponsorTiers } from './schema.ts';
import { eventOf, programOwnerDeleted } from './shared.ts';
import { cancelSponsorPackagesTx, endSponsorContactsTx } from './sponsor-packages.ts';

export const MAX_SPEAKERS_PER_EVENT = 300;
export const MAX_EXHIBITORS_PER_EVENT = 300;
export const MAX_SPONSORS_PER_EVENT = 200;
export const MAX_SPONSOR_TIERS_PER_EVENT = 20;

const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));
const Markdown = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => sanitizeMarkdown(v, max))
    .default('');
/** http(s) only: anything else (javascript:, data:, mailto:) is refused. */
const WebUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v) && safeHref(v) !== null, 'must be an http(s) link');
const OptionalUrl = z
  .union([WebUrl, z.literal('')])
  .nullable()
  .default(null)
  .transform((v) => (v ? v : null));

async function countOf(
  tx: TenantTx,
  table: typeof speakers | typeof exhibitors | typeof sponsors | typeof sponsorTiers,
  eventId: string,
  max: number,
) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.eventId, eventId));
  if ((row?.n ?? 0) >= max) throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
}

/* ------------------------------------------------------------------------------ speakers ---- */

const SpeakerFields = z.object({
  name: z.string().trim().min(1).max(120),
  title: Text(120),
  company: Text(120),
  bio: Markdown(5000),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(120), url: WebUrl }))
    .max(10)
    .default([]),
});
export const SpeakerInput = SpeakerFields.extend({ eventId: z.uuid() });
export type SpeakerInput = z.input<typeof SpeakerInput>;

export async function speakersOf(tx: TenantTx, eventId: string): Promise<SpeakerDto[]> {
  const rows = await tx
    .select()
    .from(speakers)
    .where(eq(speakers.eventId, eventId))
    .orderBy(asc(speakers.name), asc(speakers.createdAt));
  return rows.map((r) => SpeakerDto.parse(r));
}

export const createSpeakerCommand = tenantCommand({
  name: 'program.createSpeaker',
  input: SpeakerInput,
  output: SpeakerDto,
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await countOf(tx, speakers, input.eventId, MAX_SPEAKERS_PER_EVENT);
    const [row] = await tx
      .insert(speakers)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning();
    if (!row) throw new DomainError('internal');
    return SpeakerDto.parse(row);
  },
  audit: (input, row) => ({
    action: 'program.speaker.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { speakerId: row.id },
  }),
});

export const updateSpeakerCommand = tenantCommand({
  name: 'program.updateSpeaker',
  input: SpeakerFields.extend({ eventId: z.uuid(), speakerId: z.uuid() }),
  output: SpeakerDto,
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, speakerId, ...fields } = input;
    const [row] = await tx
      .update(speakers)
      .set({ ...fields, updatedAt: ctx.now })
      .where(and(eq(speakers.id, speakerId), eq(speakers.eventId, eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return SpeakerDto.parse(row);
  },
  audit: (input) => ({
    action: 'program.speaker.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { speakerId: input.speakerId },
  }),
});

export const deleteSpeakerCommand = tenantCommand({
  name: 'program.deleteSpeaker',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), speakerId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, tx, emit }) => {
    // Their session links go with them (cascade); the sessions stay.
    const rows = await tx
      .delete(speakers)
      .where(and(eq(speakers.id, input.speakerId), eq(speakers.eventId, input.eventId)))
      .returning({ id: speakers.id });
    if (rows.length === 0) throw new DomainError('not_found');
    // Its images (media, a higher tier) are removed by media's subscriber to this event.
    emit(programOwnerDeleted('speaker', input.eventId, input.speakerId));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.speaker.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { speakerId: input.speakerId },
  }),
});

/* ---------------------------------------------------------------------------- exhibitors ---- */

const ExhibitorFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: Markdown(3000),
  boothLabel: Text(40),
  websiteUrl: OptionalUrl,
});
export const ExhibitorInput = ExhibitorFields.extend({ eventId: z.uuid() });
export type ExhibitorInput = z.input<typeof ExhibitorInput>;

export async function exhibitorsOf(tx: TenantTx, eventId: string): Promise<ExhibitorDto[]> {
  const rows = await tx
    .select()
    .from(exhibitors)
    .where(eq(exhibitors.eventId, eventId))
    .orderBy(asc(exhibitors.name), asc(exhibitors.createdAt));
  return rows.map((r) => ExhibitorDto.parse(r));
}

export const createExhibitorCommand = tenantCommand({
  name: 'program.createExhibitor',
  input: ExhibitorInput,
  output: ExhibitorDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await countOf(tx, exhibitors, input.eventId, MAX_EXHIBITORS_PER_EVENT);
    const [row] = await tx
      .insert(exhibitors)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning();
    if (!row) throw new DomainError('internal');
    return ExhibitorDto.parse(row);
  },
  audit: (input, row) => ({
    action: 'program.exhibitor.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { exhibitorId: row.id },
  }),
});

export const updateExhibitorCommand = tenantCommand({
  name: 'program.updateExhibitor',
  input: ExhibitorFields.extend({ eventId: z.uuid(), exhibitorId: z.uuid() }),
  output: ExhibitorDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, exhibitorId, ...fields } = input;
    const [row] = await tx
      .update(exhibitors)
      .set({ ...fields, updatedAt: ctx.now })
      .where(and(eq(exhibitors.id, exhibitorId), eq(exhibitors.eventId, eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return ExhibitorDto.parse(row);
  },
  audit: (input) => ({
    action: 'program.exhibitor.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { exhibitorId: input.exhibitorId },
  }),
});

export const deleteExhibitorCommand = tenantCommand({
  name: 'program.deleteExhibitor',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), exhibitorId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    // M5.4a: its people's portal accounts are revoked (their sessions and event roles end).
    await endExhibitorRolesTx(tx, ctx, input.eventId, input.exhibitorId);
    const rows = await tx
      .delete(exhibitors)
      .where(and(eq(exhibitors.id, input.exhibitorId), eq(exhibitors.eventId, input.eventId)))
      .returning({ id: exhibitors.id });
    if (rows.length === 0) throw new DomainError('not_found');
    // Its images (media, a higher tier) are removed by media's subscriber to this event.
    emit(programOwnerDeleted('exhibitor', input.eventId, input.exhibitorId));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.exhibitor.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { exhibitorId: input.exhibitorId },
  }),
});

/* ------------------------------------------------------------------------------ sponsors ---- */

export async function sponsorTiersOf(tx: TenantTx, eventId: string): Promise<SponsorTierDto[]> {
  const rows = await tx
    .select()
    .from(sponsorTiers)
    .where(eq(sponsorTiers.eventId, eventId))
    .orderBy(asc(sponsorTiers.position), asc(sponsorTiers.name));
  return rows.map((r) => SponsorTierDto.parse(r));
}

export async function sponsorsOf(tx: TenantTx, eventId: string): Promise<SponsorDto[]> {
  const rows = await tx
    .select()
    .from(sponsors)
    .where(eq(sponsors.eventId, eventId))
    .orderBy(asc(sponsors.name), asc(sponsors.createdAt));
  return rows.map((r) => SponsorDto.parse(r));
}

export const createSponsorTierCommand = tenantCommand({
  name: 'program.createSponsorTier',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(1).max(60),
    position: z.number().int().min(1).max(99),
  }),
  output: SponsorTierDto,
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await countOf(tx, sponsorTiers, input.eventId, MAX_SPONSOR_TIERS_PER_EVENT);
    try {
      const [row] = await tx
        .insert(sponsorTiers)
        .values({ orgId: requireOrg(ctx), ...input })
        .returning();
      if (!row) throw new DomainError('internal');
      return SponsorTierDto.parse(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Tier exists', { field: 'name' });
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'program.sponsorTier.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { tierId: row.id },
  }),
});

export const deleteSponsorTierCommand = tenantCommand({
  name: 'program.deleteSponsorTier',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), tierId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const [used] = await tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(and(eq(sponsors.eventId, input.eventId), eq(sponsors.tierId, input.tierId)))
      .limit(1);
    // A tier with sponsors is refused: move or remove its sponsors first.
    if (used) throw new DomainError('invalid_state', 'Tier has sponsors', { reason: 'tier_in_use' });
    const rows = await tx
      .delete(sponsorTiers)
      .where(and(eq(sponsorTiers.id, input.tierId), eq(sponsorTiers.eventId, input.eventId)))
      .returning({ id: sponsorTiers.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.sponsorTier.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { tierId: input.tierId },
  }),
});

const SponsorFields = z.object({
  tierId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: Markdown(3000),
  websiteUrl: OptionalUrl,
});
export const SponsorInput = SponsorFields.extend({ eventId: z.uuid() });
export type SponsorInput = z.input<typeof SponsorInput>;

async function checkTier(tx: TenantTx, eventId: string, tierId: string) {
  const [tier] = await tx
    .select({ id: sponsorTiers.id })
    .from(sponsorTiers)
    .where(and(eq(sponsorTiers.id, tierId), eq(sponsorTiers.eventId, eventId)));
  if (!tier)
    throw new DomainError('validation_failed', 'Unknown tier', { field: 'tierId', reason: 'unknown' });
}

export const createSponsorCommand = tenantCommand({
  name: 'program.createSponsor',
  input: SponsorInput,
  output: SponsorDto,
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await checkTier(tx, input.eventId, input.tierId);
    await countOf(tx, sponsors, input.eventId, MAX_SPONSORS_PER_EVENT);
    const [row] = await tx
      .insert(sponsors)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning();
    if (!row) throw new DomainError('internal');
    return SponsorDto.parse(row);
  },
  audit: (input, row) => ({
    action: 'program.sponsor.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: row.id, tierId: input.tierId },
  }),
});

export const updateSponsorCommand = tenantCommand({
  name: 'program.updateSponsor',
  input: SponsorFields.extend({ eventId: z.uuid(), sponsorId: z.uuid() }),
  output: SponsorDto,
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, sponsorId, ...fields } = input;
    await checkTier(tx, eventId, fields.tierId);
    const [row] = await tx
      .update(sponsors)
      .set({ ...fields, updatedAt: ctx.now })
      .where(and(eq(sponsors.id, sponsorId), eq(sponsors.eventId, eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return SponsorDto.parse(row);
  },
  audit: (input) => ({
    action: 'program.sponsor.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId },
  }),
});

export const deleteSponsorCommand = tenantCommand({
  name: 'program.deleteSponsor',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), sponsorId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    // M5.4b: its package ends (the comp code closes) and its contacts' portal access with it.
    await cancelSponsorPackagesTx(tx, ctx, input.sponsorId, emit);
    await endSponsorContactsTx(tx, ctx, input.eventId, input.sponsorId);
    const rows = await tx
      .delete(sponsors)
      .where(and(eq(sponsors.id, input.sponsorId), eq(sponsors.eventId, input.eventId)))
      .returning({ id: sponsors.id });
    if (rows.length === 0) throw new DomainError('not_found');
    // Its images (media, a higher tier) are removed by media's subscriber to this event.
    emit(programOwnerDeleted('sponsor', input.eventId, input.sponsorId));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.sponsor.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId },
  }),
});
