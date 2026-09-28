import { defineSerializer, LOCALES } from '@yayatoh/contracts';
import { z } from 'zod';
import { ENTRY_STATUSES } from './domain/kinds.ts';
import {
  CONTACT_TOPICS,
  FEEDBACK_REASONS,
  HELP_AUDIENCES,
  SITE_PLACEMENTS,
} from './domain/help.ts';
import { SLUG_MAX } from './domain/slug.ts';

/** Body length of a help article after sanitizing (the M1.4d Markdown subset, as entries). */
export const HELP_BODY_MAX = 20_000;
/** Body length of a marketing section. */
export const SECTION_BODY_MAX = 4_000;

export const HelpAudience = z.enum(HELP_AUDIENCES);
export const ContentLocale = z.enum(LOCALES);
export const SitePlacement = z.enum(SITE_PLACEMENTS);
export const ContactTopic = z.enum(CONTACT_TOPICS);
export const FeedbackReason = z.enum(FEEDBACK_REASONS);
const Status = z.enum(ENTRY_STATUSES);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const Slug = z.string().trim().toLowerCase().max(SLUG_MAX);
const Position = z.coerce.number().int().min(0).max(10_000);

// ── Categories ────────────────────────────────────────────────────────────────────────────────

/** Another locale's name and description of a category. */
export const CategoryTranslation = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().default(null),
});
export const CategoryTranslations = z
  .record(z.string(), CategoryTranslation)
  .refine((m) => Object.keys(m).every((k) => (LOCALES as readonly string[]).includes(k) && k !== 'en'), {
    message: 'unknown locale',
  });

export const HelpCategoryDto = z.object({
  id: z.uuid(),
  audience: z.enum(HELP_AUDIENCES),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  translations: z.record(z.string(), CategoryTranslation),
  position: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type HelpCategoryDto = z.infer<typeof HelpCategoryDto>;
export const helpCategorySerializer = defineSerializer('cms.helpCategory', HelpCategoryDto);

export const CreateHelpCategoryInput = z.object({
  audience: z.enum(HELP_AUDIENCES),
  title: z.string().trim().min(1).max(80),
  slug: Slug.optional(),
  description: optText(300).default(null),
  translations: CategoryTranslations.default({}),
  position: Position.default(0),
});
export type CreateHelpCategoryInput = z.input<typeof CreateHelpCategoryInput>;

export const UpdateHelpCategoryInput = z.object({
  categoryId: z.uuid(),
  audience: z.enum(HELP_AUDIENCES).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: optText(300).optional(),
  translations: CategoryTranslations.optional(),
  position: Position.optional(),
});
export type UpdateHelpCategoryInput = z.input<typeof UpdateHelpCategoryInput>;

// ── Articles ──────────────────────────────────────────────────────────────────────────────────

export const HelpArticleDto = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  locale: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  body: z.string(),
  keywords: z.string().nullable(),
  position: z.number().int(),
  status: Status,
  publishedAt: z.date().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type HelpArticleDto = z.infer<typeof HelpArticleDto>;
export const helpArticleSerializer = defineSerializer('cms.helpArticle', HelpArticleDto);

/** The console list: an article with its "was this helpful?" counts. */
export const HelpArticleRowDto = HelpArticleDto.pick({
  id: true,
  categoryId: true,
  locale: true,
  slug: true,
  title: true,
  status: true,
  position: true,
  updatedAt: true,
}).extend({ helpfulYes: z.number().int(), helpfulNo: z.number().int() });
export type HelpArticleRowDto = z.infer<typeof HelpArticleRowDto>;
export const helpArticleRowSerializer = defineSerializer('cms.helpArticleRow', HelpArticleRowDto);

const ArticleFields = {
  title: z.string().trim().min(1).max(160),
  summary: optText(300),
  body: z.string().max(HELP_BODY_MAX * 2),
  keywords: optText(300),
  position: Position,
  seoTitle: optText(70),
  seoDescription: optText(160),
};

export const CreateHelpArticleInput = z.object({
  categoryId: z.uuid(),
  locale: ContentLocale.default('en'),
  /** Empty or absent: derived from the title. A translation uses its English article's slug. */
  slug: Slug.optional(),
  title: ArticleFields.title,
  summary: ArticleFields.summary.default(null),
  body: ArticleFields.body.default(''),
  keywords: ArticleFields.keywords.default(null),
  position: ArticleFields.position.default(0),
  seoTitle: ArticleFields.seoTitle.default(null),
  seoDescription: ArticleFields.seoDescription.default(null),
});
export type CreateHelpArticleInput = z.input<typeof CreateHelpArticleInput>;

export const UpdateHelpArticleInput = z.object({
  articleId: z.uuid(),
  categoryId: z.uuid().optional(),
  slug: Slug.optional(),
  title: ArticleFields.title.optional(),
  summary: ArticleFields.summary.optional(),
  body: ArticleFields.body.optional(),
  keywords: ArticleFields.keywords.optional(),
  position: ArticleFields.position.optional(),
  seoTitle: ArticleFields.seoTitle.optional(),
  seoDescription: ArticleFields.seoDescription.optional(),
});
export type UpdateHelpArticleInput = z.input<typeof UpdateHelpArticleInput>;

// ── Public help center ─────────────────────────────────────────────────────────────────────────

/** A category as the public sees it, in the reader's locale (English when not translated). */
export const PublicHelpCategoryDto = z.object({
  audience: z.enum(HELP_AUDIENCES),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** The locale the title and description are written in. */
  locale: z.string(),
  articleCount: z.number().int(),
});
export type PublicHelpCategoryDto = z.infer<typeof PublicHelpCategoryDto>;
export const publicHelpCategorySerializer = defineSerializer('cms.publicHelpCategory', PublicHelpCategoryDto);

/** A published article's summary: no ids, no drafts. */
export const PublicHelpArticleSummaryDto = z.object({
  slug: z.string(),
  categorySlug: z.string(),
  locale: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  keywords: z.string().nullable(),
  position: z.number().int(),
  updatedAt: z.date(),
});
export type PublicHelpArticleSummaryDto = z.infer<typeof PublicHelpArticleSummaryDto>;
export const publicHelpArticleSummarySerializer = defineSerializer(
  'cms.publicHelpArticleSummary',
  PublicHelpArticleSummaryDto,
);

/** The article corpus the search ranks (published only; the body for matching and excerpts). */
export const PublicHelpSearchDocDto = PublicHelpArticleSummaryDto.extend({ body: z.string() });
export type PublicHelpSearchDocDto = z.infer<typeof PublicHelpSearchDocDto>;
export const publicHelpSearchDocSerializer = defineSerializer('cms.publicHelpSearchDoc', PublicHelpSearchDocDto);

export const PublicHelpCenterDto = z.object({
  categories: z.array(PublicHelpCategoryDto),
  articles: z.array(PublicHelpArticleSummaryDto),
});
export type PublicHelpCenterDto = z.infer<typeof PublicHelpCenterDto>;

export const PublicHelpArticleDto = PublicHelpArticleSummaryDto.extend({
  body: z.string(),
  publishedAt: z.date(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  /** The other locales this article is published in (for hreflang). */
  locales: z.array(z.string()),
});
export type PublicHelpArticleDto = z.infer<typeof PublicHelpArticleDto>;
export const publicHelpArticleSerializer = defineSerializer('cms.publicHelpArticle', PublicHelpArticleDto);

export const HelpFeedbackInput = z.object({
  slug: Slug,
  /** The locale of the article that was shown (the reader's, or English as the fallback). */
  locale: ContentLocale,
  helpful: z.boolean(),
  reason: FeedbackReason.nullable().default(null),
  /** A hash of the browser's device cookie (one answer per browser per article). */
  voterKey: z.string().regex(/^[0-9a-f]{32,64}$/),
});
export type HelpFeedbackInput = z.input<typeof HelpFeedbackInput>;

// ── Marketing sections ─────────────────────────────────────────────────────────────────────────

export const SiteSectionDto = z.object({
  id: z.uuid(),
  placement: SitePlacement,
  locale: z.string(),
  slug: z.string(),
  position: z.number().int(),
  eyebrow: z.string().nullable(),
  heading: z.string(),
  body: z.string(),
  ctaLabel: z.string().nullable(),
  ctaHref: z.string().nullable(),
  status: Status,
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SiteSectionDto = z.infer<typeof SiteSectionDto>;
export const siteSectionSerializer = defineSerializer('cms.siteSection', SiteSectionDto);

export const PublicSiteSectionDto = SiteSectionDto.pick({
  slug: true,
  locale: true,
  position: true,
  eyebrow: true,
  heading: true,
  body: true,
  ctaLabel: true,
  ctaHref: true,
});
export type PublicSiteSectionDto = z.infer<typeof PublicSiteSectionDto>;
export const publicSiteSectionSerializer = defineSerializer('cms.publicSiteSection', PublicSiteSectionDto);

const SectionFields = {
  eyebrow: optText(60),
  heading: z.string().trim().min(1).max(120),
  body: z.string().max(SECTION_BODY_MAX * 2),
  ctaLabel: optText(40),
  ctaHref: optText(300),
  position: Position,
};

export const CreateSiteSectionInput = z.object({
  placement: SitePlacement,
  locale: ContentLocale.default('en'),
  slug: Slug.optional(),
  eyebrow: SectionFields.eyebrow.default(null),
  heading: SectionFields.heading,
  body: SectionFields.body.default(''),
  ctaLabel: SectionFields.ctaLabel.default(null),
  ctaHref: SectionFields.ctaHref.default(null),
  position: SectionFields.position.default(0),
});
export type CreateSiteSectionInput = z.input<typeof CreateSiteSectionInput>;

export const UpdateSiteSectionInput = z.object({
  sectionId: z.uuid(),
  slug: Slug.optional(),
  eyebrow: SectionFields.eyebrow.optional(),
  heading: SectionFields.heading.optional(),
  body: SectionFields.body.optional(),
  ctaLabel: SectionFields.ctaLabel.optional(),
  ctaHref: SectionFields.ctaHref.optional(),
  position: SectionFields.position.optional(),
});
export type UpdateSiteSectionInput = z.input<typeof UpdateSiteSectionInput>;

// ── Contact requests ───────────────────────────────────────────────────────────────────────────

export const ContactRequestInput = z.object({
  topic: ContactTopic,
  name: z.string().trim().min(1).max(120),
  email: z.email().trim().toLowerCase().max(254),
  company: optText(160).default(null),
  message: z.string().trim().min(10).max(4000),
  locale: ContentLocale.default('en'),
});
export type ContactRequestInput = z.input<typeof ContactRequestInput>;

/** The content org's console list (personal data: org eyes only, CMS writers). */
export const ContactRequestDto = z.object({
  id: z.uuid(),
  topic: ContactTopic,
  name: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  message: z.string(),
  locale: z.string(),
  status: z.enum(['new', 'handled']),
  handledAt: z.date().nullable(),
  createdAt: z.date(),
});
export type ContactRequestDto = z.infer<typeof ContactRequestDto>;
export const contactRequestSerializer = defineSerializer('cms.contactRequest', ContactRequestDto);
