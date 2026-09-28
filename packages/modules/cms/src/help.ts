import { sanitizeMarkdown } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CMS_READ, CMS_WRITE } from './cms.ts';
import { FALLBACK_LOCALE, pickLocale } from './domain/help.ts';
import { cmsSlug, nextFreeSlug, slugProblem } from './domain/slug.ts';
import {
  CategoryTranslation,
  CreateHelpArticleInput,
  CreateHelpCategoryInput,
  HELP_BODY_MAX,
  HelpArticleDto,
  HelpArticleRowDto,
  HelpCategoryDto,
  HelpFeedbackInput,
  helpArticleRowSerializer,
  type PublicHelpArticleDto,
  type PublicHelpCenterDto,
  type PublicHelpSearchDocDto,
  publicHelpArticleSerializer,
  publicHelpArticleSummarySerializer,
  publicHelpCategorySerializer,
  publicHelpSearchDocSerializer,
  UpdateHelpArticleInput,
  UpdateHelpCategoryInput,
} from './dto-help.ts';
import { helpArticles, helpCategories, helpFeedback } from './schema.ts';

const cleanBody = (body: string) => sanitizeMarkdown(body, HELP_BODY_MAX);

function slugOrFail(slug: string): string {
  const problem = slugProblem(slug);
  if (problem)
    throw new DomainError('validation_failed', 'Not a valid address', {
      issues: [{ path: 'slug', code: problem }],
      reason: problem,
    });
  return slug;
}

const slugConflict = () =>
  new DomainError('conflict', 'Another item already uses this address', {
    issues: [{ path: 'slug', code: 'taken' }],
    reason: 'taken',
  });

const translationsOf = (raw: unknown) => z.record(z.string(), CategoryTranslation).catch({}).parse(raw);
const categoryRow = (r: typeof helpCategories.$inferSelect) => ({ ...r, translations: translationsOf(r.translations) });

async function findCategory(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(helpCategories).where(eq(helpCategories.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

async function findArticle(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(helpArticles).where(eq(helpArticles.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

/** The category must exist in this org (RLS: another org's id is simply not found). */
async function categoryOrFail(tx: TenantTx, id: string) {
  const [row] = await tx.select({ id: helpCategories.id }).from(helpCategories).where(eq(helpCategories.id, id));
  if (!row)
    throw new DomainError('validation_failed', 'Unknown category', {
      issues: [{ path: 'categoryId', code: 'unknown' }],
    });
}

/** `/help/search` is the search page, never a category. */
export const RESERVED_CATEGORY_SLUGS: ReadonlySet<string> = new Set(['search']);

// ── Categories ────────────────────────────────────────────────────────────────────────────────

export const createHelpCategoryCommand = tenantCommand({
  name: 'cms.createHelpCategory',
  input: CreateHelpCategoryInput,
  output: HelpCategoryDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    let slug: string;
    if (input.slug) {
      slug = slugOrFail(input.slug);
      if (RESERVED_CATEGORY_SLUGS.has(slug))
        throw new DomainError('validation_failed', 'Reserved address', {
          issues: [{ path: 'slug', code: 'reserved' }],
          reason: 'reserved',
        });
    } else {
      const base = cmsSlug(input.title);
      const taken = await tx
        .select({ slug: helpCategories.slug })
        .from(helpCategories)
        .where(sql`${helpCategories.slug} like ${`${base}%`}`);
      slug = nextFreeSlug(base, new Set([...RESERVED_CATEGORY_SLUGS, ...taken.map((r) => r.slug)]));
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(helpCategories)
          .values({
            orgId,
            audience: input.audience,
            slug,
            title: input.title,
            description: input.description,
            translations: input.translations,
            position: input.position,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      return categoryRow(row);
    } catch (err) {
      if (isUniqueViolation(err, 'help_categories_org_slug_key')) throw slugConflict();
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'cms.help_category.create',
    targetType: 'help_category',
    targetId: row.id,
    data: { audience: input.audience },
  }),
});

/** Category addresses are public links from the first published article on: they never change. */
export const updateHelpCategoryCommand = tenantCommand({
  name: 'cms.updateHelpCategory',
  input: UpdateHelpCategoryInput,
  output: HelpCategoryDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const { categoryId, ...fields } = input;
    await findCategory(tx, categoryId);
    const [row] = await tx
      .update(helpCategories)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(helpCategories.id, categoryId))
      .returning();
    if (!row) throw new DomainError('not_found');
    return categoryRow(row);
  },
  audit: (input) => ({
    action: 'cms.help_category.update',
    targetType: 'help_category',
    targetId: input.categoryId,
    data: { fields: Object.keys(input).filter((k) => k !== 'categoryId') },
  }),
});

/** Only an empty category can be deleted (move or delete its articles first). */
export const deleteHelpCategoryCommand = tenantCommand({
  name: 'cms.deleteHelpCategory',
  category: 'delete',
  input: z.object({ categoryId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx }) => {
    await findCategory(tx, input.categoryId);
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(helpArticles)
      .where(eq(helpArticles.categoryId, input.categoryId));
    if ((used?.n ?? 0) > 0)
      throw new DomainError('invalid_state', 'The category still has articles', { reason: 'has_articles' });
    await tx.delete(helpCategories).where(eq(helpCategories.id, input.categoryId));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'cms.help_category.delete',
    targetType: 'help_category',
    targetId: input.categoryId,
  }),
});

// ── Articles ──────────────────────────────────────────────────────────────────────────────────

export const createHelpArticleCommand = tenantCommand({
  name: 'cms.createHelpArticle',
  input: CreateHelpArticleInput,
  output: HelpArticleDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await categoryOrFail(tx, input.categoryId);
    let slug: string;
    if (input.slug) slug = slugOrFail(input.slug);
    else {
      const base = cmsSlug(input.title);
      const taken = await tx
        .select({ slug: helpArticles.slug })
        .from(helpArticles)
        .where(and(eq(helpArticles.locale, input.locale), sql`${helpArticles.slug} like ${`${base}%`}`));
      slug = nextFreeSlug(base, new Set(taken.map((r) => r.slug)));
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(helpArticles)
          .values({
            orgId,
            categoryId: input.categoryId,
            locale: input.locale,
            slug,
            title: input.title,
            summary: input.summary,
            body: cleanBody(input.body),
            keywords: input.keywords,
            position: input.position,
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      emit({
        type: 'cms.help_article_created',
        version: 1,
        aggregateType: 'help_article',
        aggregateId: row.id,
        payload: { orgId, articleId: row.id, locale: row.locale, slug: row.slug },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'help_articles_org_locale_slug_key')) throw slugConflict();
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'cms.help_article.create',
    targetType: 'help_article',
    targetId: row.id,
    data: { locale: input.locale ?? 'en' },
  }),
});

export const updateHelpArticleCommand = tenantCommand({
  name: 'cms.updateHelpArticle',
  input: UpdateHelpArticleInput,
  output: HelpArticleDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const { articleId, slug: rawSlug, body, categoryId, ...fields } = input;
    const current = await findArticle(tx, articleId);
    if (categoryId && categoryId !== current.categoryId) await categoryOrFail(tx, categoryId);
    let slug: string | undefined;
    if (rawSlug !== undefined && rawSlug !== '' && rawSlug !== current.slug) {
      if (current.publishedAt)
        throw new DomainError('invalid_state', 'The address of a published article cannot change', {
          issues: [{ path: 'slug', code: 'frozen' }],
          reason: 'frozen',
        });
      slug = slugOrFail(rawSlug);
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .update(helpArticles)
          .set({
            ...fields,
            ...(categoryId ? { categoryId } : {}),
            ...(slug ? { slug } : {}),
            ...(body !== undefined ? { body: cleanBody(body) } : {}),
            updatedAt: ctx.now,
          })
          .where(eq(helpArticles.id, articleId))
          .returning(),
      );
      if (!row) throw new DomainError('not_found');
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'help_articles_org_locale_slug_key')) throw slugConflict();
      throw err;
    }
  },
  audit: (input) => ({
    action: 'cms.help_article.update',
    targetType: 'help_article',
    targetId: input.articleId,
    data: { fields: Object.keys(input).filter((k) => k !== 'articleId') },
  }),
});

const FROM = {
  publish: ['draft', 'archived'],
  unpublish: ['published'],
  archive: ['draft', 'published'],
} as const;
const TO = { publish: 'published', unpublish: 'draft', archive: 'archived' } as const;
const EVENT = {
  publish: 'cms.help_article_published',
  unpublish: 'cms.help_article_unpublished',
  archive: 'cms.help_article_archived',
} as const;

/** Publish, unpublish or archive (the `entries` lifecycle); the first publish freezes the slug. */
export const setHelpArticleStatusCommand = tenantCommand({
  name: 'cms.setHelpArticleStatus',
  input: z.object({ articleId: z.uuid(), action: z.enum(['publish', 'unpublish', 'archive']) }),
  output: HelpArticleDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findArticle(tx, input.articleId);
    const [row] = await tx
      .update(helpArticles)
      .set({
        status: TO[input.action],
        ...(input.action === 'publish' && !current.publishedAt ? { publishedAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(and(eq(helpArticles.id, input.articleId), inArray(helpArticles.status, [...FROM[input.action]])))
      .returning();
    if (!row) throw new DomainError('invalid_state', `Cannot ${input.action} from ${current.status}`);
    emit({
      type: EVENT[input.action],
      version: 1,
      aggregateType: 'help_article',
      aggregateId: row.id,
      payload: { orgId: row.orgId, articleId: row.id, locale: row.locale, slug: row.slug },
    });
    return row;
  },
  audit: (input) => ({
    action: `cms.help_article.${input.action}`,
    targetType: 'help_article',
    targetId: input.articleId,
  }),
});

export const deleteHelpArticleCommand = tenantCommand({
  name: 'cms.deleteHelpArticle',
  category: 'delete',
  input: z.object({ articleId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx, emit }) => {
    const [row] = await tx.delete(helpArticles).where(eq(helpArticles.id, input.articleId)).returning();
    if (!row) throw new DomainError('not_found');
    emit({
      type: 'cms.help_article_deleted',
      version: 1,
      aggregateType: 'help_article',
      aggregateId: row.id,
      payload: { orgId: row.orgId, articleId: row.id, locale: row.locale, slug: row.slug },
    });
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'cms.help_article.delete', targetType: 'help_article', targetId: input.articleId }),
});

/** The console: every category and every article (any status) with its feedback counts. */
export const listHelpQuery = tenantQuery({
  name: 'cms.listHelp',
  input: z.object({}),
  output: z.object({ categories: z.array(HelpCategoryDto), articles: z.array(HelpArticleRowDto) }),
  entitlement: 'core',
  permission: CMS_READ,
  handler: async ({ tx }) => {
    const categories = await tx
      .select()
      .from(helpCategories)
      .orderBy(asc(helpCategories.audience), asc(helpCategories.position), asc(helpCategories.title))
      .limit(200);
    const articles = await tx
      .select({
        id: helpArticles.id,
        categoryId: helpArticles.categoryId,
        locale: helpArticles.locale,
        slug: helpArticles.slug,
        title: helpArticles.title,
        status: helpArticles.status,
        position: helpArticles.position,
        updatedAt: helpArticles.updatedAt,
        helpfulYes: sql<number>`(select count(*)::int from ${helpFeedback} f where f.article_id = ${helpArticles.id} and f.helpful)`,
        helpfulNo: sql<number>`(select count(*)::int from ${helpFeedback} f where f.article_id = ${helpArticles.id} and not f.helpful)`,
      })
      .from(helpArticles)
      .orderBy(asc(helpArticles.position), asc(helpArticles.title), asc(helpArticles.locale))
      .limit(1000);
    return {
      categories: categories.map(categoryRow),
      articles: helpArticleRowSerializer.serializeMany(articles),
    };
  },
});

export const getHelpArticleQuery = tenantQuery({
  name: 'cms.getHelpArticle',
  input: z.object({ articleId: z.uuid() }),
  output: HelpArticleDto,
  entitlement: 'core',
  permission: CMS_READ,
  handler: ({ input, tx }) => findArticle(tx, input.articleId),
});

export const getHelpCategoryQuery = tenantQuery({
  name: 'cms.getHelpCategory',
  input: z.object({ categoryId: z.uuid() }),
  output: HelpCategoryDto,
  entitlement: 'core',
  permission: CMS_READ,
  handler: async ({ input, tx }) => categoryRow(await findCategory(tx, input.categoryId)),
});

// ── Feedback ──────────────────────────────────────────────────────────────────────────────────

/**
 * "Was this helpful?" from the public article page (rate-limited by the web per device and IP).
 * One answer per browser per article: answering again replaces it. Only published articles.
 */
export const submitHelpFeedbackCommand = tenantCommand({
  name: 'cms.submitHelpFeedback',
  input: HelpFeedbackInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'public:help_feedback',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [article] = await tx
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.slug, input.slug),
          eq(helpArticles.locale, input.locale),
          eq(helpArticles.status, 'published'),
        ),
      );
    if (!article) throw new DomainError('not_found');
    const reason = input.helpful ? null : input.reason;
    await tx
      .insert(helpFeedback)
      .values({ orgId, articleId: article.id, helpful: input.helpful, reason, voterKey: input.voterKey })
      .onConflictDoUpdate({
        target: [helpFeedback.orgId, helpFeedback.articleId, helpFeedback.voterKey],
        set: { helpful: input.helpful, reason, updatedAt: ctx.now },
      });
    return { ok: true as const };
  },
});

// ── Public reads ──────────────────────────────────────────────────────────────────────────────

const publicCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'cms.help' } });
const PUBLISHED = eq(helpArticles.status, 'published');
const inLocales = (locale: string) =>
  inArray(helpArticles.locale, locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE]);

function localizedCategory(c: typeof helpCategories.$inferSelect, locale: string) {
  const tr = translationsOf(c.translations)[locale];
  return tr
    ? { title: tr.title, description: tr.description ?? null, locale }
    : { title: c.title, description: c.description, locale: FALLBACK_LOCALE };
}

async function publishedIn(tx: TenantTx, locale: string) {
  const rows = await tx
    .select({
      slug: helpArticles.slug,
      locale: helpArticles.locale,
      categoryId: helpArticles.categoryId,
      title: helpArticles.title,
      summary: helpArticles.summary,
      keywords: helpArticles.keywords,
      position: helpArticles.position,
      updatedAt: helpArticles.updatedAt,
      body: helpArticles.body,
    })
    .from(helpArticles)
    .where(and(PUBLISHED, inLocales(locale)))
    .orderBy(asc(helpArticles.position), asc(helpArticles.title));
  return pickLocale(rows, locale);
}

/**
 * The help center in one locale (English where not translated): the categories that have
 * published articles, with counts, and the published articles' summaries. No drafts, no ids.
 */
export async function publicHelpCenter(orgId: string, locale: string): Promise<PublicHelpCenterDto> {
  return withTenant(publicCtx(orgId), async (tx) => {
    const articles = await publishedIn(tx, locale);
    const cats = await tx
      .select()
      .from(helpCategories)
      .orderBy(asc(helpCategories.position), asc(helpCategories.title));
    const slugOf = new Map(cats.map((c) => [c.id, c.slug]));
    const counts = new Map<string, number>();
    for (const a of articles) counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
    return {
      categories: cats
        .filter((c) => (counts.get(c.id) ?? 0) > 0)
        .map((c) =>
          publicHelpCategorySerializer.serialize({
            audience: c.audience,
            slug: c.slug,
            ...localizedCategory(c, locale),
            articleCount: counts.get(c.id) ?? 0,
          }),
        ),
      articles: publicHelpArticleSummarySerializer.serializeMany(
        articles.map((a) => ({ ...a, categorySlug: slugOf.get(a.categoryId) ?? '' })),
      ),
    };
  });
}

/** Search bodies are capped: a match deep in a long article adds little. */
const SEARCH_BODY_CHARS = 6_000;

/** The published articles the search ranks, in one locale (English where not translated). */
export async function publicHelpSearchDocs(orgId: string, locale: string): Promise<PublicHelpSearchDocDto[]> {
  return withTenant(publicCtx(orgId), async (tx) => {
    const articles = await publishedIn(tx, locale);
    const cats = await tx.select({ id: helpCategories.id, slug: helpCategories.slug }).from(helpCategories);
    const slugOf = new Map(cats.map((c) => [c.id, c.slug]));
    return publicHelpSearchDocSerializer.serializeMany(
      articles.map((a) => ({
        ...a,
        categorySlug: slugOf.get(a.categoryId) ?? '',
        body: a.body.slice(0, SEARCH_BODY_CHARS),
      })),
    );
  });
}

/** One published article in the reader's locale, else English; null for drafts, archived and unknown. */
export async function publicHelpArticle(
  orgId: string,
  locale: string,
  slug: string,
): Promise<{ article: PublicHelpArticleDto; categoryId: string } | null> {
  if (slugProblem(slug)) return null;
  return withTenant(publicCtx(orgId), async (tx) => {
    const rows = await tx
      .select()
      .from(helpArticles)
      .where(and(PUBLISHED, eq(helpArticles.slug, slug)));
    const row = rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === FALLBACK_LOCALE);
    if (!row) return null;
    const [cat] = await tx
      .select({ slug: helpCategories.slug })
      .from(helpCategories)
      .where(eq(helpCategories.id, row.categoryId));
    return {
      categoryId: row.categoryId,
      article: publicHelpArticleSerializer.serialize({
        ...row,
        categorySlug: cat?.slug ?? '',
        publishedAt: row.publishedAt ?? row.updatedAt,
        locales: rows.map((r) => r.locale).sort(),
      }),
    };
  });
}

/** Sitemap entries: every category with a published article and every published article slug. */
export async function helpSitemapEntries(
  orgId: string,
): Promise<{ categories: { slug: string; updatedAt: Date }[]; articles: { slug: string; categorySlug: string; updatedAt: Date }[] }> {
  return withTenant(publicCtx(orgId), async (tx) => {
    const rows = await tx
      .select({
        slug: helpArticles.slug,
        categorySlug: helpCategories.slug,
        updatedAt: sql<Date>`max(${helpArticles.updatedAt})`.mapWith((v) => new Date(v as string)),
      })
      .from(helpArticles)
      .innerJoin(
        helpCategories,
        and(eq(helpCategories.orgId, helpArticles.orgId), eq(helpCategories.id, helpArticles.categoryId)),
      )
      .where(PUBLISHED)
      .groupBy(helpArticles.slug, helpCategories.slug)
      .orderBy(asc(helpArticles.slug));
    const cats = new Map<string, Date>();
    for (const r of rows) {
      const prev = cats.get(r.categorySlug);
      if (!prev || r.updatedAt > prev) cats.set(r.categorySlug, r.updatedAt);
    }
    return {
      categories: [...cats].map(([slug, updatedAt]) => ({ slug, updatedAt })),
      articles: rows,
    };
  });
}

