import { CMS_WRITE } from '@yayatoh/cms';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EntryEditor } from '@/components/cms/entry-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { createEntryAction } from '../actions.ts';

/** New page or post. Roles without `marketing:write` get a refusal, never the form. */
export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const kind = (await searchParams).kind === 'page' ? 'page' : 'post';
  const data = await loadConsole(org);
  const t = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  return (
    <>
      <PageHeader title={t(kind === 'page' ? 'newPage' : 'newPost')} description={t('newDescription')} />
      <Link href={`/o/${org}/content?kind=${kind}`} className="self-start text-body underline">
        {t('back')}
      </Link>
      {canWrite ? (
        <Card>
          <EntryEditor
            action={createEntryAction.bind(null, org, kind)}
            kind={kind}
            slugFrozen={false}
            submitLabel={t('createDraft')}
          />
        </Card>
      ) : (
        <p
          role="alert"
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-700"
        >
          {t('notAllowed')}
        </p>
      )}
    </>
  );
}
