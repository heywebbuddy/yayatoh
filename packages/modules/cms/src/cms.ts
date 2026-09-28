import { sanitizeMarkdown } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cmsSlug, nextFreeSlug, slugProblem } from './domain/slug.ts';
import {
  BODY_MAX,
  CreateEntryInput,
  EntryDto,
  EntryKind,
  type NavPageDto,
  navPageSerializer,
  type PublicEntryDto,
  type PublicEntryPageDto,
  publicEntrySerializer,
  publicEntrySummarySerializer,
  UpdateEntryInput,
} from './dto.ts';
import { entries } from './schema.ts';

/** Entries shown per page of a public blog index. */
export const POSTS_PER_PAGE = 10;
/** Pages a tenant site's navigation may link (site settings). */
export const MAX_NAV_PAGES = 8;

/** Read CMS content: every member who can see the org (viewers included). */
export const CMS_READ = 'org:read';
/** Write and publish: the roles that write marketing copy (owner, admin, manager, marketing). */
export const CMS_WRITE = 'marketing:write';

const cleanBody = (body: string) => sanitizeMarkdown(body, BODY_MAX);

function slugOrFail(slug: string): string {
  const problem = slugProblem(slug);
  if (problem)
    throw new DomainError('validation_failed', 'Not a valid address', {
      issues: [{ path: 'slug', code: problem }],
      reason: problem,
    });
  return slug;
}

async function findEntry(tx: TenantTx, entryId: string) {
  const [row] = await tx.select().from(entries).where(eq(entries.id, entryId));
  if (!row) throw new DomainError('not_found');
  return row;
}

async function takenSlugs(tx: TenantTx, kind: EntryKind, base: string): Promise<Set<string>> {
  const rows = await tx
    .select({ slug: entries.slug })
    .from(entries)
    .where(and(eq(entries.kind, kind), sql`${entries.slug} like ${`${base}%`}`));
  return new Set(rows.map((r) => r.slug));
}

const slugConflict = () =>
  new DomainError('conflict', 'Another entry already uses this address', {
    issues: [{ path: 'slug', code: 'taken' }],
    reason: 'taken',
  });

export const createEntryCommand = tenantCommand({
  name: 'cms.createEntry',
  input: CreateEntryInput,
  output: EntryDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    // A typed slug must be free; a derived one takes the next free suffix.
    const slug = input.slug
      ? slugOrFail(input.slug)
      : nextFreeSlug(cmsSlug(input.title), await takenSlugs(tx, input.kind, cmsSlug(input.title)));
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(entries)
          .values({
            orgId,
            kind: input.kind,
            slug,
            title: input.title,
            excerpt: input.excerpt,
            body: cleanBody(input.body),
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            authorUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
            authorName: input.authorName,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      emit({
        type: 'cms.entry_created',
        version: 1,
        aggregateType: 'cms_entry',
        aggregateId: row.id,
        payload: { orgId, entryId: row.id, kind: row.kind, slug: row.slug },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'entries_org_kind_slug_key')) throw slugConflict();
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'cms.entry.create',
    targetType: 'cms_entry',
    targetId: row.id,
    data: { kind: input.kind },
  }),
});

export const updateEntryCommand = tenantCommand({
  name: 'cms.updateEntry',
  input: UpdateEntryInput,
  output: EntryDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const { entryId, slug: rawSlug, body, ...fields } = input;
    const current = await findEntry(tx, entryId);
    let slug: string | undefined;
    if (rawSlug !== undefined && rawSlug !== '' && rawSlug !== current.slug) {
      // Published addresses are public links (and sitemap entries): they never change.
      if (current.publishedAt)
        throw new DomainError('invalid_state', 'The address of a published entry cannot change', {
          issues: [{ path: 'slug', code: 'frozen' }],
          reason: 'frozen',
        });
      slug = slugOrFail(rawSlug);
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .update(entries)
          .set({
            ...fields,
            ...(slug ? { slug } : {}),
            ...(body !== undefined ? { body: cleanBody(body) } : {}),
            updatedAt: ctx.now,
          })
          .where(eq(entries.id, entryId))
          .returning(),
      );
      if (!row) throw new DomainError('not_found');
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'entries_org_kind_slug_key')) throw slugConflict();
      throw err;
    }
  },
  audit: (input) => ({
    action: 'cms.entry.update',
    targetType: 'cms_entry',
    targetId: input.entryId,
    data: { fields: Object.keys(input).filter((k) => k !== 'entryId') },
  }),
});

export const ENTRY_ACTIONS = ['publish', 'unpublish', 'archive'] as const;
const FROM = {
  publish: ['draft', 'archived'],
  unpublish: ['published'],
  archive: ['draft', 'published'],
} as const;
const TO = { publish: 'published', unpublish: 'draft', archive: 'archived' } as const;

/**
 * Publish (draft or archived → published), unpublish (→ draft) or archive. The first publish
 * sets `published_at`, which also freezes the slug; a re-publish keeps the original date.
 */
export const setEntryStatusCommand = tenantCommand({
  name: 'cms.setEntryStatus',
  input: z.object({ entryId: z.uuid(), action: z.enum(ENTRY_ACTIONS) }),
  output: EntryDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findEntry(tx, input.entryId);
    const [row] = await tx
      .update(entries)
      .set({
        status: TO[input.action],
        ...(input.action === 'publish' && !current.publishedAt ? { publishedAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(and(eq(entries.id, input.entryId), inArray(entries.status, [...FROM[input.action]])))
      .returning();
    if (!row) throw new DomainError('invalid_state', `Cannot ${input.action} from ${current.status}`);
    const type =
      input.action === 'publish'
        ? row.kind === 'page'
          ? 'cms.page_published'
          : 'cms.post_published'
        : input.action === 'unpublish'
          ? 'cms.entry_unpublished'
          : 'cms.entry_archived';
    emit({
      type,
      version: 1,
      aggregateType: 'cms_entry',
      aggregateId: row.id,
      payload: { orgId: row.orgId, entryId: row.id, kind: row.kind, slug: row.slug },
    });
    return row;
  },
  audit: (input) => ({
    action: `cms.entry.${input.action}`,
    targetType: 'cms_entry',
    targetId: input.entryId,
  }),
});

export const deleteEntryCommand = tenantCommand({
  name: 'cms.deleteEntry',
  input: z.object({ entryId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx, emit }) => {
    const [row] = await tx.delete(entries).where(eq(entries.id, input.entryId)).returning();
    if (!row) throw new DomainError('not_found');
    emit({
      type: 'cms.entry_deleted',
      version: 1,
      aggregateType: 'cms_entry',
      aggregateId: row.id,
      payload: { orgId: row.orgId, entryId: row.id, kind: row.kind, slug: row.slug },
    });
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'cms.entry.delete', targetType: 'cms_entry', targetId: input.entryId }),
});

export const listEntriesQuery = tenantQuery({
  name: 'cms.listEntries',
  input: z.object({ kind: EntryKind.optional() }),
  output: z.array(EntryDto),
  entitlement: 'core',
  permission: CMS_READ,
  handler: ({ input, tx }) =>
    tx
      .select()
      .from(entries)
      .where(input.kind ? eq(entries.kind, input.kind) : undefined)
      .orderBy(desc(entries.updatedAt))
      .limit(500),
});

export const getEntryQuery = tenantQuery({
  name: 'cms.getEntry',
  input: z.object({ entryId: z.uuid() }),
  output: EntryDto,
  entitlement: 'core',
  permission: CMS_READ,
  handler: ({ input, tx }) => findEntry(tx, input.entryId),
});

/** For higher tiers (site settings) inside their own tenant transaction: which of these ids are pages. */
export async function pageIdsTx(tx: TenantTx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.kind, 'page'), inArray(entries.id, [...ids])));
  return rows.map((r) => r.id);
}

const publicCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'cms.public' } });
const published = (kind: EntryKind) => and(eq(entries.kind, kind), eq(entries.status, 'published'));

/**
 * One org's published posts or pages, newest first (tenant sites and organizer pages: the org
 * comes from the host or the organizer slug, never the request). Read under the org's RLS.
 */
export async function publicEntries(orgId: string, kind: EntryKind, page = 1): Promise<PublicEntryPageDto> {
  return withTenant(publicCtx(orgId), async (tx) => {
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(entries).where(published(kind));
    const total = count?.n ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
    const p = Math.min(Math.max(1, page), pageCount);
    const rows = await tx
      .select()
      .from(entries)
      .where(published(kind))
      .orderBy(desc(entries.publishedAt), asc(entries.slug))
      .limit(POSTS_PER_PAGE)
      .offset((p - 1) * POSTS_PER_PAGE);
    return { items: publicEntrySummarySerializer.serializeMany(rows), page: p, pageCount };
  });
}

/** One published entry, or null (drafts, archived and other orgs' entries are all null: a 404). */
export async function publicEntry(
  orgId: string,
  kind: EntryKind,
  slug: string,
): Promise<PublicEntryDto | null> {
  if (slugProblem(slug)) return null;
  return withTenant(publicCtx(orgId), async (tx) => {
    const [row] = await tx
      .select()
      .from(entries)
      .where(and(published(kind), eq(entries.slug, slug)));
    return row ? publicEntrySerializer.serialize(row) : null;
  });
}

/** The published pages a tenant site's navigation links, in the organizer's order. */
export async function navPages(orgId: string, ids: readonly string[]): Promise<NavPageDto[]> {
  if (ids.length === 0) return [];
  const rows = await withTenant(publicCtx(orgId), (tx) =>
    tx
      .select({ id: entries.id, slug: entries.slug, title: entries.title })
      .from(entries)
      .where(and(published('page'), inArray(entries.id, [...ids]))),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [navPageSerializer.serialize(r)] : [];
  });
}

/** Sitemap entries of one org: kind, slug and lastmod of every published entry. */
export async function sitemapEntries(
  orgId: string,
): Promise<{ kind: EntryKind; slug: string; updatedAt: Date }[]> {
  const rows = await withTenant(publicCtx(orgId), (tx) =>
    tx
      .select({ kind: entries.kind, slug: entries.slug, updatedAt: entries.updatedAt })
      .from(entries)
      .where(eq(entries.status, 'published'))
      .orderBy(asc(entries.kind), asc(entries.slug)),
  );
  return rows.map((r) => ({ kind: EntryKind.parse(r.kind), slug: r.slug, updatedAt: r.updatedAt }));
}
