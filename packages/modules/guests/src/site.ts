import { randomBytes } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { appTokenSecret, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { findVenueTx } from '@yayatoh/venues';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lookupCodeFrom, normalizeLookupCode } from './domain/rsvp.ts';
import {
  BLOCK_CONTENT,
  BLOCK_HEADING_MAX,
  type BlockContent,
  blockHasContent,
  emptyContent,
  FaqItem,
  hashSitePassword,
  MAX_SITE_BLOCKS,
  moveIndex,
  passwordProblem,
  programSubEvents,
  RegistryItem,
  readContent,
  SITE_INTRO_MAX,
  SITE_PASSWORD_MAX,
  SITE_TITLE_MAX,
  siteAccessToken,
  siteAccessValid,
  TravelItem,
  verifySitePassword,
} from './domain/site.ts';
import { eventOfTx } from './rsvp-state.ts';
import { SITE_BLOCK_KINDS, SITE_STATUSES, siteBlocks, sites } from './schema.ts';
import { subEventsOfEventTx } from './sub-events.ts';

/**
 * The guest website (M4.5a, P4-3c). One per event: a title, an intro and blocks (text, the
 * program from the sub-events, travel, registry links, FAQ) at `/w/{code}`, behind a password the
 * host sets (only its scrypt hash is kept). The public page shows nothing but the event's name
 * until the visitor proves the password; the proof is an HMAC of the site and its password
 * version, so a new password locks every earlier visitor out. Never on the marketplace: nothing
 * here emits a domain event, and no guest's name, answer or contact detail is ever read.
 */

/* ------------------------------------------------------------------------------ helpers ---- */

async function siteOfTx(tx: TenantTx, eventId: string, lock = false) {
  const q = tx.select().from(sites).where(eq(sites.eventId, eventId));
  const [row] = await (lock ? q.for('update') : q);
  return row ?? null;
}

/** The event's site, made (a draft titled after the event, with a fresh address) on first use. */
async function ensureSiteTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  const found = await siteOfTx(tx, eventId, true);
  if (found) return found;
  const ev = await eventOfTx(tx, eventId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await tx
      .insert(sites)
      .values({
        orgId: requireOrg(ctx),
        eventId,
        code: lookupCodeFrom(randomBytes(8)),
        title: ev.name.slice(0, SITE_TITLE_MAX),
        contentLocale: /^[a-z]{2}(-[A-Z]{2})?$/.test(ctx.locale ?? '') ? (ctx.locale as string) : 'en',
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const again = await siteOfTx(tx, eventId, true);
    if (again) return again;
  }
  throw new DomainError('conflict', 'Could not allocate a site address', { reason: 'site_code' });
}

async function blocksOfTx(tx: TenantTx, siteId: string) {
  return tx
    .select()
    .from(siteBlocks)
    .where(eq(siteBlocks.siteId, siteId))
    .orderBy(asc(siteBlocks.position), asc(siteBlocks.createdAt), asc(siteBlocks.id));
}

async function blockOfTx(tx: TenantTx, eventId: string, blockId: string) {
  const [row] = await tx
    .select()
    .from(siteBlocks)
    .where(and(eq(siteBlocks.id, blockId), eq(siteBlocks.eventId, eventId)))
    .for('update');
  if (!row) throw new DomainError('not_found', 'Block not found', { field: 'blockId' });
  return row;
}

async function renumberTx(tx: TenantTx, ids: readonly string[], now: Date) {
  for (const [position, id] of ids.entries())
    await tx.update(siteBlocks).set({ position, updatedAt: now }).where(eq(siteBlocks.id, id));
}

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

/** The org and event of a site address, or null (unknown code, draft site, org not live). */
export async function guestSiteTarget(raw: string): Promise<{ orgId: string; eventId: string } | null> {
  const code = normalizeLookupCode(raw);
  if (!code) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string }>(
      sql`select org_id, event_id from guests.site_target(${code})`,
    ),
  );
  return rows[0] ? { orgId: rows[0].org_id, eventId: rows[0].event_id } : null;
}

/* ---------------------------------------------------------------------------------- DTOs ---- */

const Kind = z.enum(SITE_BLOCK_KINDS);

export const SiteBlockDto = z.discriminatedUnion('kind', [
  z.object({
    id: z.uuid(),
    kind: z.literal('text'),
    heading: z.string().nullable(),
    content: BLOCK_CONTENT.text,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal('program'),
    heading: z.string().nullable(),
    content: BLOCK_CONTENT.program,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal('travel'),
    heading: z.string().nullable(),
    content: z.object({ items: z.array(TravelItem) }),
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal('registry'),
    heading: z.string().nullable(),
    content: z.object({ items: z.array(RegistryItem) }),
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal('faq'),
    heading: z.string().nullable(),
    content: z.object({ items: z.array(FaqItem) }),
  }),
]);
export type SiteBlockDto = z.infer<typeof SiteBlockDto>;

/** The host's view (console): never the password or its hash, only whether one is set. */
export const GuestSiteDto = z.object({
  exists: z.boolean(),
  code: z.string().nullable(),
  status: z.enum(SITE_STATUSES),
  title: z.string(),
  intro: z.string().nullable(),
  contentLocale: z.string(),
  hasPassword: z.boolean(),
  publishedAt: z.date().nullable(),
  blocks: z.array(SiteBlockDto),
});
export type GuestSiteDto = z.infer<typeof GuestSiteDto>;

const toBlockDto = (b: typeof siteBlocks.$inferSelect): SiteBlockDto =>
  SiteBlockDto.parse({ id: b.id, heading: b.heading, ...readContent(b.kind as never, b.content) });

async function siteDtoTx(tx: TenantTx, eventId: string): Promise<GuestSiteDto> {
  const row = await siteOfTx(tx, eventId);
  if (!row) {
    const ev = await eventOfTx(tx, eventId);
    return {
      exists: false,
      code: null,
      status: 'draft',
      title: ev.name.slice(0, SITE_TITLE_MAX),
      intro: null,
      contentLocale: 'en',
      hasPassword: false,
      publishedAt: null,
      blocks: [],
    };
  }
  return GuestSiteDto.parse({
    exists: true,
    code: row.code,
    status: row.status,
    title: row.title,
    intro: row.intro,
    contentLocale: row.contentLocale,
    hasPassword: row.passwordHash !== null,
    publishedAt: row.publishedAt,
    blocks: (await blocksOfTx(tx, row.id)).map(toBlockDto),
  });
}

const siteCommand = {
  entitlement: 'website',
  permission: 'guests:write',
} as const;

/* ---------------------------------------------------------------------------- the host ---- */

export const guestSiteQuery = tenantQuery({
  name: 'guests.guestSite',
  input: z.object({ eventId: z.uuid() }),
  output: GuestSiteDto,
  entitlement: 'website',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    return siteDtoTx(tx, input.eventId);
  },
});

/** Whether the event's guest site is live (the wedding checklist's "publish your website"). */
export const guestSitePublishedQuery = tenantQuery({
  name: 'guests.guestSitePublished',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ published: z.boolean() }),
  entitlement: 'website',
  permission: 'guests:read',
  handler: async ({ input, tx }) => ({
    published: (await siteOfTx(tx, input.eventId))?.status === 'published',
  }),
});

const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

export const SaveGuestSiteInput = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1).max(SITE_TITLE_MAX),
  intro: Optional(SITE_INTRO_MAX),
  contentLocale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('en'),
});

/** The site's title, intro and content language (made on first save). */
export const saveGuestSiteCommand = tenantCommand({
  name: 'guests.saveGuestSite',
  input: SaveGuestSiteInput,
  output: GuestSiteDto,
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const row = await ensureSiteTx(tx, ctx, input.eventId);
    await tx
      .update(sites)
      .set({ title: input.title, intro: input.intro, contentLocale: input.contentLocale, updatedAt: ctx.now })
      .where(eq(sites.id, row.id));
    return siteDtoTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'guests.site.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { fields: ['title', 'intro', 'contentLocale'] },
  }),
});

/**
 * Set or change the password. Every visitor who unlocked the site with the old one is locked out
 * (the version goes up). The password itself never reaches the audit log or any response.
 */
export const setGuestSitePasswordCommand = tenantCommand({
  name: 'guests.setGuestSitePassword',
  input: z.object({ eventId: z.uuid(), password: z.string().max(SITE_PASSWORD_MAX * 4) }),
  output: z.object({ hasPassword: z.literal(true) }),
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const problem = passwordProblem(input.password);
    if (problem) throw invalid('password', problem);
    const row = await ensureSiteTx(tx, ctx, input.eventId);
    await tx
      .update(sites)
      .set({
        passwordHash: await hashSitePassword(input.password),
        passwordVersion: row.passwordVersion + 1,
        updatedAt: ctx.now,
      })
      .where(eq(sites.id, row.id));
    return { hasPassword: true as const };
  },
  audit: (input) => ({
    action: 'guests.site.password',
    targetType: 'event',
    targetId: input.eventId,
    data: {},
  }),
});

/** Publish (needs a password: P4-3c) or take the site down (its address then answers "not found"). */
export const publishGuestSiteCommand = tenantCommand({
  name: 'guests.publishGuestSite',
  input: z.object({ eventId: z.uuid(), published: z.boolean() }),
  output: GuestSiteDto,
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const row = await ensureSiteTx(tx, ctx, input.eventId);
    if (input.published && !row.passwordHash)
      throw new DomainError('invalid_state', 'Set a password first', {
        reason: 'password_required',
        field: 'password',
      });
    await tx
      .update(sites)
      .set({
        status: input.published ? 'published' : 'draft',
        publishedAt: input.published ? (row.publishedAt ?? ctx.now) : row.publishedAt,
        updatedAt: ctx.now,
      })
      .where(eq(sites.id, row.id));
    return siteDtoTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: input.published ? 'guests.site.publish' : 'guests.site.unpublish',
    targetType: 'event',
    targetId: input.eventId,
    data: {},
  }),
});

export const addGuestSiteBlockCommand = tenantCommand({
  name: 'guests.addGuestSiteBlock',
  input: z.object({ eventId: z.uuid(), kind: Kind }),
  output: SiteBlockDto,
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const site = await ensureSiteTx(tx, ctx, input.eventId);
    const [n] = await tx.select({ n: count() }).from(siteBlocks).where(eq(siteBlocks.siteId, site.id));
    if ((n?.n ?? 0) >= MAX_SITE_BLOCKS)
      throw new DomainError('invalid_state', 'Too many blocks', { reason: 'too_many_blocks' });
    const [row] = await tx
      .insert(siteBlocks)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        siteId: site.id,
        kind: input.kind,
        position: n?.n ?? 0,
        content: emptyContent(input.kind),
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toBlockDto(row);
  },
  audit: (input, r) => ({
    action: 'guests.site.block_add',
    targetType: 'site_block',
    targetId: r?.id ?? input.eventId,
    data: { eventId: input.eventId, kind: input.kind },
  }),
});

export const UpdateGuestSiteBlockInput = z.object({
  eventId: z.uuid(),
  blockId: z.uuid(),
  heading: Optional(BLOCK_HEADING_MAX),
  /** The kind's content (`domain/site.ts`); checked against the block's own kind. */
  content: z.unknown(),
});

/** A block's heading and content, checked against its kind (unknown sub-events refused). */
export const updateGuestSiteBlockCommand = tenantCommand({
  name: 'guests.updateGuestSiteBlock',
  input: UpdateGuestSiteBlockInput,
  output: SiteBlockDto,
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const row = await blockOfTx(tx, input.eventId, input.blockId);
    const kind = row.kind as (typeof SITE_BLOCK_KINDS)[number];
    const parsed = BLOCK_CONTENT[kind].safeParse(input.content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError('validation_failed', 'Invalid block content', {
        field: ['content', ...(issue?.path ?? [])].join('.'),
        reason: issue?.message === 'https_only' ? 'https_only' : (issue?.code ?? 'invalid'),
      });
    }
    const content = parsed.data as BlockContent['content'];
    if (kind === 'program') {
      const ids = new Set((await subEventsOfEventTx(tx, input.eventId)).map((s) => s.id));
      const chosen = (content as { subEventIds: string[] }).subEventIds;
      if (chosen.some((id) => !ids.has(id))) throw invalid('content.subEventIds', 'unknown');
      (content as { subEventIds: string[] }).subEventIds = [...new Set(chosen)];
    }
    const [updated] = await tx
      .update(siteBlocks)
      .set({ heading: input.heading, content, updatedAt: ctx.now })
      .where(eq(siteBlocks.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return toBlockDto(updated);
  },
  // Field names only: what the host wrote is content, not audit data.
  audit: (input) => ({
    action: 'guests.site.block_update',
    targetType: 'site_block',
    targetId: input.blockId,
    data: { eventId: input.eventId, fields: ['heading', 'content'] },
  }),
});

export const moveGuestSiteBlockCommand = tenantCommand({
  name: 'guests.moveGuestSiteBlock',
  input: z.object({ eventId: z.uuid(), blockId: z.uuid(), direction: z.enum(['up', 'down']) }),
  output: z.object({ moved: z.boolean() }),
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const row = await blockOfTx(tx, input.eventId, input.blockId);
    const ids = (await blocksOfTx(tx, row.siteId)).map((b) => b.id);
    const from = ids.indexOf(row.id);
    const to = moveIndex(ids.length, from, input.direction);
    if (to === null) return { moved: false };
    ids.splice(from, 1);
    ids.splice(to, 0, row.id);
    await renumberTx(tx, ids, ctx.now);
    return { moved: true };
  },
  audit: (input) => ({
    action: 'guests.site.block_move',
    targetType: 'site_block',
    targetId: input.blockId,
    data: { eventId: input.eventId, direction: input.direction },
  }),
});

export const removeGuestSiteBlockCommand = tenantCommand({
  name: 'guests.removeGuestSiteBlock',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), blockId: z.uuid() }),
  output: z.object({ removed: z.literal(true) }),
  ...siteCommand,
  handler: async ({ input, ctx, tx }) => {
    const row = await blockOfTx(tx, input.eventId, input.blockId);
    await tx.delete(siteBlocks).where(eq(siteBlocks.id, row.id));
    await renumberTx(
      tx,
      (await blocksOfTx(tx, row.siteId)).map((b) => b.id),
      ctx.now,
    );
    return { removed: true as const };
  },
  audit: (input) => ({
    action: 'guests.site.block_remove',
    targetType: 'site_block',
    targetId: input.blockId,
    data: { eventId: input.eventId },
  }),
});

/* ------------------------------------------------------------------------------ guests ---- */

export const PublicProgramItem = z.object({
  name: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  place: z.string().nullable(),
  venueName: z.string().nullable(),
  venueCity: z.string().nullable(),
});

/** A block as guests see it: no ids of sub-events, the program resolved into its items. */
export const PublicSiteBlockDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), heading: z.string().nullable(), body: z.string() }),
  z.object({ kind: z.literal('program'), heading: z.string().nullable(), items: z.array(PublicProgramItem) }),
  z.object({ kind: z.literal('travel'), heading: z.string().nullable(), items: z.array(TravelItem) }),
  z.object({ kind: z.literal('registry'), heading: z.string().nullable(), items: z.array(RegistryItem) }),
  z.object({ kind: z.literal('faq'), heading: z.string().nullable(), items: z.array(FaqItem) }),
]);
export type PublicSiteBlockDto = z.infer<typeof PublicSiteBlockDto>;

/**
 * The public page (allowlisted): locked, only the event's name; open (the visitor proved the
 * password), the host's content and the program's sub-events (names, times, places). Never a
 * guest, a party, an answer or the password hash.
 */
export const PublicGuestSiteDto = z.discriminatedUnion('state', [
  z.object({ state: z.literal('locked'), eventName: z.string() }),
  z.object({
    state: z.literal('open'),
    eventName: z.string(),
    title: z.string(),
    intro: z.string().nullable(),
    contentLocale: z.string(),
    timezone: z.string(),
    blocks: z.array(PublicSiteBlockDto),
  }),
]);
export type PublicGuestSiteDto = z.infer<typeof PublicGuestSiteDto>;

async function publishedSiteTx(tx: TenantTx, eventId: string) {
  const row = await siteOfTx(tx, eventId);
  if (row?.status !== 'published')
    throw new DomainError('not_found', 'Site not published', { reason: 'site_unpublished' });
  return row;
}

export const publicGuestSiteQuery = tenantQuery({
  name: 'guests.publicGuestSite',
  input: z.object({ eventId: z.uuid(), access: z.string().max(200).nullable().default(null) }),
  output: PublicGuestSiteDto,
  entitlement: 'website',
  permission: 'public:guest_site',
  handler: async ({ input, tx }) => {
    const row = await publishedSiteTx(tx, input.eventId);
    const ev = await eventOfTx(tx, input.eventId);
    if (!siteAccessValid(input.access, row.id, row.passwordVersion, appTokenSecret()))
      return { state: 'locked' as const, eventName: ev.name };
    const subs = await subEventsOfEventTx(tx, input.eventId);
    const venues = new Map<string, { name: string; city: string | null } | null>();
    const venueOf = async (id: string | null) => {
      if (!id) return null;
      if (!venues.has(id)) {
        const v = await findVenueTx(tx, id);
        venues.set(id, v ? { name: v.name, city: v.city } : null);
      }
      return venues.get(id) ?? null;
    };
    const blocks: PublicSiteBlockDto[] = [];
    for (const b of await blocksOfTx(tx, row.id)) {
      const c = readContent(b.kind as never, b.content);
      if (c.kind === 'program') {
        const items = [];
        for (const s of programSubEvents(subs, c.content)) {
          const v = await venueOf(s.venueId);
          items.push({
            name: s.name,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            place: s.place,
            venueName: v?.name ?? null,
            venueCity: v?.city ?? null,
          });
        }
        if (blockHasContent(c, items.length)) blocks.push({ kind: 'program', heading: b.heading, items });
      } else if (blockHasContent(c)) {
        blocks.push(
          c.kind === 'text'
            ? { kind: 'text', heading: b.heading, body: c.content.body }
            : ({ kind: c.kind, heading: b.heading, items: c.content.items } as PublicSiteBlockDto),
        );
      }
    }
    return {
      state: 'open' as const,
      eventName: ev.name,
      title: row.title,
      intro: row.intro,
      contentLocale: row.contentLocale,
      timezone: ev.timezone,
      blocks,
    };
  },
});

/**
 * A visitor's password attempt: the access proof for their cookie, or null. A read (nothing is
 * written); the web action rate-limits it per device, address and site (`guestSitePassword`).
 */
export const unlockGuestSiteQuery = tenantQuery({
  name: 'guests.unlockGuestSite',
  input: z.object({ eventId: z.uuid(), password: z.string().max(SITE_PASSWORD_MAX * 4) }),
  output: z.object({ access: z.string().nullable() }),
  entitlement: 'website',
  permission: 'public:guest_site',
  handler: async ({ input, tx }) => {
    const row = await publishedSiteTx(tx, input.eventId);
    const ok = await verifySitePassword(input.password, row.passwordHash);
    return { access: ok ? siteAccessToken(row.id, row.passwordVersion, appTokenSecret()) : null };
  },
});
