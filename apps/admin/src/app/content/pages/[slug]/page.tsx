import { Button, Card, DatePicker, PageHeader } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { getPage, pageVersions } from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';
import { savePageAction } from '../../site-actions.ts';
import { ContentTabs } from '../../tabs.tsx';

/** Edit one page (`new` starts a page): Markdown, last-updated date, draft or published, history. */
export default async function PageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const page = slug === 'new' ? null : await getPage(staff.actor, slug);
  if (slug !== 'new' && !page) notFound();
  const versions = page ? await pageVersions(staff.actor, slug) : [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Shell staff={staff}>
      <PageHeader
        title={page ? page.title : t('pages.new')}
        description={page ? t('pages.liveAt', { path: `/${page.slug}` }) : t('pages.newHint')}
        actions={
          <Link href="/content/pages" className="text-body underline underline-offset-4">
            {t('pages.back')}
          </Link>
        }
      />
      <ContentTabs active="pages" done={sp.done} error={sp.error} />
      <Card size="panel">
        <form action={savePageAction} className="flex flex-col gap-4">
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
                readOnly={Boolean(page)}
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
              defaultValue={page?.effectiveDate ?? today}
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
      {page ? (
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
                      by: v.savedBy.replace(/^staff:/, ''),
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
