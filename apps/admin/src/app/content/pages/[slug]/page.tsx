import { LOCALES } from '@yayatoh/contracts';
import { Button, Card, DatePicker, PageHeader } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getPage, listPages, pageVersions } from '@/server/platform-site.ts';
import { actorNames } from '@/server/signup-codes.ts';
import { requireStaff } from '@/server/staff.ts';
import { savePageAction } from '../../site-actions.ts';
import { ContentTabs } from '../../tabs.tsx';

/**
 * Edit one page in one language (`new` starts a page): Markdown, last-updated date, draft or
 * published, history. A language without a version yet starts from the English text, and visitors
 * in that language see English until it is published.
 */
export default async function PageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ done?: string; error?: string; locale?: string }>;
}) {
  const staff = await requireStaff('content');
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const locale = (LOCALES as readonly string[]).includes(sp.locale ?? '') ? (sp.locale as string) : 'en';
  const isNew = slug === 'new';
  const own = isNew ? null : await getPage(staff.actor, slug, locale);
  const english = isNew || locale === 'en' ? null : await getPage(staff.actor, slug, 'en');
  if (!isNew && !own && !english) notFound();
  const page = own ?? english;
  const have = new Set(
    isNew ? [] : (await listPages(staff.actor)).filter((p) => p.slug === slug).map((p) => p.locale),
  );
  const versions = own ? await pageVersions(staff.actor, slug, locale) : [];
  const names = await actorNames(versions.map((v) => v.savedBy));
  const today = new Date().toISOString().slice(0, 10);
  const langName = new Intl.DisplayNames('en', { type: 'language' });
  return (
    <Shell staff={staff}>
      <PageHeader
        title={page ? page.title : t('pages.new')}
        description={
          own
            ? t('pages.liveAt', { path: `/${slug}` })
            : isNew
              ? t('pages.newHint')
              : t('pages.translationMissing', { language: langName.of(locale) ?? locale })
        }
        actions={
          <Link href="/content/pages" className="text-body underline underline-offset-4">
            {t('pages.back')}
          </Link>
        }
      />
      <ContentTabs active="pages" done={sp.done} error={sp.error} />
      {isNew ? null : (
        <nav aria-label={t('pages.language')} className="flex flex-wrap gap-2">
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/content/pages/${slug}?locale=${l}`}
              aria-current={l === locale ? 'page' : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 py-2 text-body font-bold text-ink-2 hover:bg-surface-3 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
            >
              {langName.of(l) ?? l}
              <span className="text-caption font-normal">
                {have.has(l) ? t('pages.hasVersion') : t('pages.noVersion')}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <Card size="panel">
        <form action={savePageAction} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('pages.fields.title')}
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={page?.title}
                className="field w-full"
              />
            </label>
            <label className="flex flex-col gap-2 text-body font-semibold">
              {t('pages.fields.slug')}
              <input
                name="slug"
                required
                maxLength={60}
                pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
                defaultValue={page?.slug}
                readOnly={!isNew}
                className="field w-full"
              />
              <span className="text-caption font-normal text-ink-2">{t('pages.fields.slugHint')}</span>
            </label>
          </div>
          <label className="flex flex-col gap-2 text-body font-semibold sm:max-w-xs">
            {t('pages.fields.date')}
            <DatePicker
              id="effectiveDate"
              name="effectiveDate"
              required
              defaultValue={today}
              className="field w-full"
            />
            <span className="text-caption font-normal text-ink-2">{t('pages.fields.dateHint')}</span>
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('pages.fields.body')}
            <textarea
              name="body"
              rows={24}
              maxLength={120000}
              defaultValue={page?.body}
              className="field w-full font-mono"
            />
            <span className="text-caption font-normal text-ink-2">{t('pages.fields.bodyHint')}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" name="intent" value="publish">
              {t('pages.publish')}
            </Button>
            <Button type="submit" name="intent" value="draft" variant="secondary">
              {t('pages.saveDraft')}
            </Button>
          </div>
        </form>
      </Card>
      {own ? (
        <Card size="panel" className="flex flex-col gap-3">
          <h2 className="text-section">{t('pages.history')}</h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {versions.map((v) => (
              <li key={v.version} className="py-3">
                <details>
                  <summary className="cursor-pointer text-body font-semibold">
                    {t('pages.versionLine', {
                      version: v.version,
                      status: t(`pages.status.${v.status === 'published' ? 'published' : 'draft'}`),
                      by: names.get(v.savedBy) ?? v.savedBy,
                      when: v.savedAt.toISOString().slice(0, 16).replace('T', ' '),
                    })}
                  </summary>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-control bg-surface-3 p-3 text-caption">
                    {v.body}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Shell>
  );
}
