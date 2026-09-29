import 'server-only';
import { createHash } from 'node:crypto';
import {
  type PublicHelpArticleDto,
  type PublicHelpCenterDto,
  type PublicHelpSearchDocDto,
  type PublicSiteSectionDto,
  publicHelpArticle,
  publicHelpCenter,
  publicHelpSearchDocs,
  publicSiteSections,
  type SitePlacement,
} from '@yayatoh/cms';
import type { PublicOrganizer } from '@yayatoh/marketplace';
import { marketplaceContentOrg } from './cms.ts';
import { publicCached } from './public-cache.ts';
import type { RequestHost } from './request-origin.ts';
import { clientKey } from './visitor.ts';

type Raw = Record<string, unknown>;
const date = (v: unknown) => new Date(String(v));
const reviveSummary = <T extends Raw>(a: T) => ({ ...a, updatedAt: date(a.updatedAt) });

/**
 * The platform CMS behind the help center and the marketing pages (M3.11b): the marketplace
 * content org (`MARKETPLACE_CONTENT_ORG`). These pages exist on the marketplace (and dev) hosts
 * only; a tenant host 404s them.
 */
export async function platformContentOrg(req: RequestHost): Promise<PublicOrganizer | null> {
  if (req.kind === 'tenant' || req.kind === 'app') return null;
  return marketplaceContentOrg();
}

export const cachedHelpCenter = (orgId: string, locale: string) =>
  publicCached(
    { org: orgId },
    ['help-center', locale],
    () => publicHelpCenter(orgId, locale),
    (raw) => {
      const r = raw as { categories: PublicHelpCenterDto['categories']; articles: Raw[] };
      return { categories: r.categories, articles: r.articles.map(reviveSummary) } as PublicHelpCenterDto;
    },
  );

export const cachedHelpDocs = (orgId: string, locale: string) =>
  publicCached(
    { org: orgId },
    ['help-docs', locale],
    () => publicHelpSearchDocs(orgId, locale),
    (raw) => (raw as Raw[]).map(reviveSummary) as unknown as PublicHelpSearchDocDto[],
  );

export const cachedHelpArticle = (orgId: string, locale: string, slug: string) =>
  publicCached(
    { org: orgId },
    ['help-article', locale, slug],
    () => publicHelpArticle(orgId, locale, slug),
    (raw) => {
      if (!raw) return null;
      const r = raw as { article: Raw; categoryId: string };
      return {
        categoryId: r.categoryId,
        article: {
          ...reviveSummary(r.article),
          publishedAt: date(r.article.publishedAt),
        } as unknown as PublicHelpArticleDto,
      };
    },
  );

export const cachedSections = (orgId: string, placement: SitePlacement, locale: string) =>
  publicCached(
    { org: orgId },
    ['site-sections', placement, locale],
    () => publicSiteSections(orgId, placement, locale),
    (raw) => raw as PublicSiteSectionDto[],
  );

/** This browser's "was this helpful?" key: a hash of its device-bound client key (no raw cookie). */
export async function helpVoterKey(): Promise<string> {
  return createHash('sha256')
    .update(await clientKey('help-feedback'))
    .digest('hex');
}
