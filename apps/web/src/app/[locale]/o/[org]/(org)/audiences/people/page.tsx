import { peopleQuery } from '@yayatoh/crm';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, EmptyState, Input, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('title') };
}

const UUID = /^[0-9a-f-]{36}$/;

/** `<iso>_<id>`: the keyset cursor of the people list. */
function parseAfter(v: string | undefined): { at: Date; id: string } | undefined {
  const [iso, id] = (v ?? '').split('_');
  const at = iso ? new Date(iso) : null;
  return at && !Number.isNaN(at.getTime()) && id && UUID.test(id) ? { at, id } : undefined;
}

/** Audiences → People (M6.1a): the org's people, newest first, searchable; each opens a timeline. */
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ q?: string; after?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'contacts:read')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('people');
  const q = (sp.q ?? '').trim().slice(0, 200);
  const page = await executeQuery(
    peopleQuery,
    { ...(q ? { q } : {}), ...(parseAfter(sp.after) ? { after: parseAfter(sp.after) } : {}), limit: 25 },
    data.ctx,
    ports,
  );
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const nextHref = page.next
    ? `/o/${org}/audiences/people?${new URLSearchParams({
        ...(q ? { q } : {}),
        after: `${page.next.at.toISOString()}_${page.next.id}`,
      }).toString()}`
    : null;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences`} className="underline underline-offset-2">
            {t('audiences')}
          </Link>
        }
        title={t('title')}
        description={t('description')}
        actions={
          <Link href={`/o/${org}/audiences/duplicates`} className={buttonClass('secondary')}>
            {t('duplicatesLink')}
          </Link>
        }
      />
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input name="q" type="search" label={t('search.label')} defaultValue={q} maxLength={200} />
        </div>
        <Button type="submit" variant="secondary">
          {t('search.submit')}
        </Button>
      </form>
      {page.rows.length === 0 ? (
        q ? (
          <EmptyState title={t('search.noneTitle')} description={t('search.noneDescription', { q })} />
        ) : (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        )
      ) : (
        <>
          <Table
            caption={t('caption')}
            rowKey={(r) => r.id}
            rows={page.rows}
            columns={[
              {
                key: 'name',
                header: t('columns.name'),
                cell: (r) => (
                  <Link
                    href={`/o/${org}/audiences/people/${r.id}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {r.name ?? r.email}
                  </Link>
                ),
              },
              { key: 'email', header: t('columns.email'), cell: (r) => r.email },
              { key: 'company', header: t('columns.company'), cell: (r) => r.company ?? '' },
              { key: 'added', header: t('columns.added'), cell: (r) => when.format(r.createdAt) },
            ]}
          />
          {nextHref ? (
            <Link href={nextHref} className={`${buttonClass('secondary', 'sm')} self-start`}>
              {t('next')}
            </Link>
          ) : null}
        </>
      )}
    </>
  );
}
