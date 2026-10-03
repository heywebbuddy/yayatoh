import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_CATEGORIES, type EventCategory } from './domain/categories.ts';
import {
  CategoryNameError,
  categoryRef,
  isPlatformKey,
  MAX_ORG_CATEGORIES,
  moveInOrder,
  normalizeCategoryName,
} from './domain/org-categories.ts';
import { events, orgCategories, platformCategories } from './schema.ts';

/**
 * U8 (UX-2): org-managed event categories. The list starts as the platform defaults (staff manage
 * them in admin) and is stored for the org on its first change ("seeded"); until then the query
 * shows the defaults. Every category maps to a platform key, which the event keeps in
 * `events.category`, so the marketplace and `/v1` keep the platform taxonomy.
 */
export const OrgCategoryDto = z.object({
  /** Platform key while an unchanged default, else the id (see `categoryRef`). */
  ref: z.string(),
  /** Null until the org's list is stored. */
  id: z.uuid().nullable(),
  platformKey: z.enum(EVENT_CATEGORIES),
  /** Null = the platform label of `platformKey` (translated by the app). */
  name: z.string().nullable(),
  hidden: z.boolean(),
  position: z.number().int(),
  /** Events in this category (any status). */
  eventCount: z.number().int(),
});
export type OrgCategoryDto = z.infer<typeof OrgCategoryDto>;

type Row = typeof orgCategories.$inferSelect;

/** The platform default list (staff-managed): keys in the defaults, in order. */
export async function platformDefaultKeysTx(tx: TenantTx): Promise<EventCategory[]> {
  const rows = await tx
    .select({ key: platformCategories.key })
    .from(platformCategories)
    .where(eq(platformCategories.inDefaults, true))
    .orderBy(asc(platformCategories.position), asc(platformCategories.key));
  return rows.map((r) => r.key as EventCategory);
}

async function storedTx(tx: TenantTx): Promise<Row[]> {
  return tx.select().from(orgCategories).orderBy(asc(orgCategories.position), asc(orgCategories.id));
}

/**
 * Store the org's list from the platform defaults (idempotent; a concurrent seed loses quietly).
 * Keys that existing events use but the defaults leave out are kept, hidden, so history stays.
 * Existing events are linked to their category.
 */
export async function ensureOrgCategoriesTx(tx: TenantTx, orgId: string): Promise<Row[]> {
  const existing = await storedTx(tx);
  if (existing.length) return existing;
  const defaults = await platformDefaultKeysTx(tx);
  const used = await tx
    .selectDistinct({ key: events.category })
    .from(events)
    .where(isNotNull(events.category));
  const extra = used
    .map((r) => r.key as EventCategory)
    .filter((k) => !defaults.includes(k))
    .sort();
  const values = [
    ...defaults.map((platformKey, i) => ({ orgId, platformKey, position: i, hiddenAt: null })),
    ...extra.map((platformKey, i) => ({
      orgId,
      platformKey,
      position: defaults.length + i,
      hiddenAt: sql`now()` as unknown as Date,
    })),
  ];
  if (values.length)
    await tx
      .insert(orgCategories)
      .values(values)
      .onConflictDoNothing({
        target: [orgCategories.orgId, orgCategories.platformKey],
        where: sql`name is null`,
      });
  await tx.execute(sql`
    update ${events} e set org_category_id = c.id
    from ${orgCategories} c
    where e.org_category_id is null and e.category is not null
      and c.name is null and c.platform_key = e.category`);
  return storedTx(tx);
}

/** A stored category by ref (seeding first); null when no such category. */
export async function resolveCategoryTx(tx: TenantTx, orgId: string, ref: string): Promise<Row | null> {
  const rows = await ensureOrgCategoriesTx(tx, orgId);
  if (isPlatformKey(ref))
    return (
      rows.find((r) => r.name === null && r.platformKey === ref) ??
      rows.find((r) => r.platformKey === ref && !r.hiddenAt) ??
      null
    );
  if (!z.uuid().safeParse(ref).success) return null;
  return rows.find((r) => r.id === ref) ?? null;
}

async function requireCategoryTx(tx: TenantTx, orgId: string, ref: string): Promise<Row> {
  const row = await resolveCategoryTx(tx, orgId, ref);
  if (!row) throw new DomainError('not_found', 'Category not found', { field: 'category' });
  return row;
}

function nameOrThrow(raw: string): string {
  let name: string | null;
  try {
    name = normalizeCategoryName(raw);
  } catch (err) {
    if (err instanceof CategoryNameError)
      throw new DomainError('validation_failed', err.message, { reason: err.reason, field: 'name' });
    throw err;
  }
  if (!name)
    throw new DomainError('validation_failed', 'Enter a name', { reason: 'name_required', field: 'name' });
  return name;
}

async function assertNameFreeTx(tx: TenantTx, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: orgCategories.id })
    .from(orgCategories)
    .where(
      and(
        sql`lower(${orgCategories.name}) = lower(${name})`,
        exceptId ? ne(orgCategories.id, exceptId) : undefined,
      ),
    );
  if (clash)
    throw new DomainError('conflict', 'A category with that name exists', {
      reason: 'name_taken',
      field: 'name',
    });
}

async function eventCountsTx(tx: TenantTx) {
  const byId = await tx
    .select({ id: events.orgCategoryId, n: count() })
    .from(events)
    .where(isNotNull(events.orgCategoryId))
    .groupBy(events.orgCategoryId);
  const byKey = await tx
    .select({ key: events.category, n: count() })
    .from(events)
    .where(and(isNull(events.orgCategoryId), isNotNull(events.category)))
    .groupBy(events.category);
  return {
    byId: new Map(byId.map((r) => [r.id as string, r.n])),
    byKey: new Map(byKey.map((r) => [r.key as string, r.n])),
  };
}

function toDto(r: Row, counts: Awaited<ReturnType<typeof eventCountsTx>>): OrgCategoryDto {
  return {
    ref: categoryRef(r),
    id: r.id,
    platformKey: r.platformKey as EventCategory,
    name: r.name,
    hidden: r.hiddenAt !== null,
    position: r.position,
    eventCount: counts.byId.get(r.id) ?? 0,
  };
}

/**
 * The org's categories in order. Pickers ask for the visible ones only (hidden categories leave
 * the pickers); the manage page and labels ask for all.
 */
export const orgCategoriesQuery = tenantQuery({
  name: 'events.orgCategories',
  input: z.object({ includeHidden: z.boolean().default(false) }),
  output: z.array(OrgCategoryDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const counts = await eventCountsTx(tx);
    const stored = await storedTx(tx);
    const list: OrgCategoryDto[] = stored.length
      ? stored.map((r) => toDto(r, counts))
      : (await platformDefaultKeysTx(tx)).map((key, i) => ({
          ref: key,
          id: null,
          platformKey: key,
          name: null,
          hidden: false,
          position: i,
          eventCount: counts.byKey.get(key) ?? 0,
        }));
    return input.includeHidden ? list : list.filter((c) => !c.hidden);
  },
});

const audit = (action: string) => (input: Record<string, unknown>, output?: unknown) => ({
  action,
  targetType: 'org_category',
  targetId: (output as OrgCategoryDto | undefined)?.id ?? String(input.category ?? ''),
  data: Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'category')),
});

async function dtoOfTx(tx: TenantTx, id: string): Promise<OrgCategoryDto> {
  const [row] = await tx.select().from(orgCategories).where(eq(orgCategories.id, id));
  if (!row) throw new DomainError('not_found');
  return toDto(row, await eventCountsTx(tx));
}

/** Add a category at the end of the list; it maps to a platform key (default `other`). */
export const addOrgCategoryCommand = tenantCommand({
  name: 'events.addOrgCategory',
  input: z.object({
    name: z.string().max(200),
    platformKey: z.enum(EVENT_CATEGORIES).default('other'),
  }),
  output: OrgCategoryDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const name = nameOrThrow(input.name);
    const rows = await ensureOrgCategoriesTx(tx, orgId);
    if (rows.length >= MAX_ORG_CATEGORIES)
      throw new DomainError('invalid_state', 'Too many categories', { reason: 'too_many', field: 'name' });
    await assertNameFreeTx(tx, name);
    const position = rows.reduce((m, r) => Math.max(m, r.position + 1), 0);
    const [row] = await tx
      .insert(orgCategories)
      .values({ orgId, name, platformKey: input.platformKey, position })
      .returning({ id: orgCategories.id });
    return dtoOfTx(tx, (row as { id: string }).id);
  },
  audit: audit('org_category.add'),
});

/** Rename a category (a default becomes the org's own name; its platform key stays). */
export const renameOrgCategoryCommand = tenantCommand({
  name: 'events.renameOrgCategory',
  input: z.object({ category: z.string().max(80), name: z.string().max(200) }),
  output: OrgCategoryDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const row = await requireCategoryTx(tx, requireOrg(ctx), input.category);
    const name = nameOrThrow(input.name);
    await assertNameFreeTx(tx, name, row.id);
    await tx.update(orgCategories).set({ name, updatedAt: ctx.now }).where(eq(orgCategories.id, row.id));
    return dtoOfTx(tx, row.id);
  },
  audit: audit('org_category.rename'),
});

/** Hide a category from the pickers (its events keep it) or show it again. */
export const setOrgCategoryHiddenCommand = tenantCommand({
  name: 'events.setOrgCategoryHidden',
  input: z.object({ category: z.string().max(80), hidden: z.boolean() }),
  output: OrgCategoryDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const row = await requireCategoryTx(tx, orgId, input.category);
    if (input.hidden && !row.hiddenAt) {
      const visible = (await storedTx(tx)).filter((r) => !r.hiddenAt && r.id !== row.id);
      if (visible.length === 0)
        throw new DomainError('invalid_state', 'Keep at least one category visible', {
          reason: 'last_visible',
          field: 'category',
        });
    }
    await tx
      .update(orgCategories)
      .set({ hiddenAt: input.hidden ? (row.hiddenAt ?? ctx.now) : null, updatedAt: ctx.now })
      .where(eq(orgCategories.id, row.id));
    return dtoOfTx(tx, row.id);
  },
  audit: audit('org_category.visibility'),
});

/** Move a category one place up or down (buttons: the keyboard alternative to dragging). */
export const moveOrgCategoryCommand = tenantCommand({
  name: 'events.moveOrgCategory',
  input: z.object({ category: z.string().max(80), direction: z.enum(['up', 'down']) }),
  output: z.array(OrgCategoryDto),
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const row = await requireCategoryTx(tx, orgId, input.category);
    const rows = await storedTx(tx);
    const order = moveInOrder(
      rows.map((r) => r.id),
      row.id,
      input.direction,
    );
    for (const [i, id] of order.entries()) {
      if (rows.find((r) => r.id === id)?.position === i) continue;
      await tx.update(orgCategories).set({ position: i, updatedAt: ctx.now }).where(eq(orgCategories.id, id));
    }
    const counts = await eventCountsTx(tx);
    return (await storedTx(tx)).map((r) => toDto(r, counts));
  },
  audit: audit('org_category.move'),
});
