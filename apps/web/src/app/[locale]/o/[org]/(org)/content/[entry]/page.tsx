import { CMS_WRITE, getEntryQuery } from '@yayatoh/cms';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { publicOrganizerById } from '@yayatoh/marketplace';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EntryControls } from '@/components/cms/entry-controls.tsx';
import { EntryEditor } from '@/components/cms/entry-editor.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { contentPublicUrl } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { deleteEntryAction, entryStatusAction, updateEntryAction } from '../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** Edit one page or post: fields with a preview, publish/unpublish/archive, delete. */
export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; entry: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, org, entry: entryId } = await params;
  setRequestLocale(locale);
  if (!UUID.test(entryId)) notFound();
  const data = await loadConsole(org);
  const entry = await executeQuery(getEntryQuery, { entryId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const created = Boolean((await searchParams).created);
  const organizer = await publicOrganizerById(data.org.id);
  const publicUrl =
    entry.status === 'published' && organizer
      ? contentPublicUrl(await requestHost(), organizer, entry.kind, entry.slug)
      : null;
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const act = (a: 'publish' | 'unpublish' | 'archive') => entryStatusAction.bind(null, org, entry.id, a);
  return (
    <>
      <PageHeader
        eyebrow={t(`kind.${entry.kind}`)}
        title={entry.title}
        description={
          entry.publishedAt
            ? t('publishedOn', {
                date: formatDate(entry.publishedAt.toISOString(), f, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })
            : t('neverPublished')
        }
      />
      <Link href={`/o/${org}/content?kind=${entry.kind}`} className="self-start text-body underline">
        {t('back')}
      </Link>
      {created ? <Alert tone="info" title={t('created')} /> : null}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot status={DOT[entry.status]} label={t(`status.${entry.status}`)} />
          {publicUrl ? (
            <a href={publicUrl} className="text-body underline" dir="ltr">
              {t('viewPublic')}
            </a>
          ) : null}
        </div>
        {canWrite ? (
          <EntryControls
            status={entry.status}
            title={entry.title}
            publish={act('publish')}
            unpublish={act('unpublish')}
            archive={act('archive')}
            remove={deleteEntryAction.bind(null, org, entry.id, entry.kind)}
          />
        ) : null}
      </Card>
      {canWrite ? (
        <Card>
          <EntryEditor
            action={updateEntryAction.bind(null, org, entry.id)}
            kind={entry.kind}
            slugFrozen={entry.publishedAt !== null}
            submitLabel={t('save')}
            values={{
              title: entry.title,
              slug: entry.slug,
              excerpt: entry.excerpt ?? '',
              body: entry.body,
              seoTitle: entry.seoTitle ?? '',
              seoDescription: entry.seoDescription ?? '',
            }}
          />
        </Card>
      ) : (
        <>
          <p
            role="note"
            className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-600"
          >
            {t('readOnly')}
          </p>
          <Card>
            <article aria-label={t('previewLabel')} className="flex flex-col gap-3">
              {entry.excerpt ? <p className="text-body text-zinc-600">{entry.excerpt}</p> : null}
              <Markdown source={entry.body} />
            </article>
          </Card>
        </>
      )}
    </>
  );
}
