import { type PlatformPage, platformPage } from '@yayatoh/cms';
import { Scale } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Article } from '@/components/blog/article.tsx';
import { headingsOf } from '@/components/blog/model.ts';
import { PageHero, Toc } from '@/components/showcase/page-hero.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';

/** A page staff edit in the admin console ("Site content" → Pages), by slug; null when there is none. */
export const loadPlatformPage = (slug: string): Promise<PlatformPage | null> => platformPage(slug);

export const platformPageMetadata = (page: PlatformPage): Metadata => ({ title: page.title });

/**
 * A legal or static page in the showcase design: the title and "last updated" date, a sticky table
 * of contents beside long text (three or more sections) and the Markdown body typeset for reading.
 */
export async function PlatformPageView({ page, locale }: { page: PlatformPage; locale: string }) {
  const t = await getTranslations('sitePages');
  const items = headingsOf(page.body)
    .filter((h) => h.level === 2)
    .map((h) => ({ id: h.id, title: h.text }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${page.effectiveDate}T00:00:00Z`),
  );
  return (
    <ShowcaseShell width="max-w-6xl">
      <PageHero
        eyebrow={t('legalEyebrow')}
        title={page.title}
        lede={t('lastUpdated', { date, version: page.version })}
        icon={Scale}
      />
      <div
        className={items.length >= 3 ? 'grid grid-cols-1 gap-10 lg:grid-cols-[18rem_1fr]' : 'flex flex-col'}
      >
        <Toc items={items} />
        <Article source={page.body} />
      </div>
    </ShowcaseShell>
  );
}
