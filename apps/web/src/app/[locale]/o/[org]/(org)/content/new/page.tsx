import { CMS_WRITE } from '@yayatoh/cms';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EntryEditor } from '@/components/cms/entry-editor.tsx';
import { PageAiPanel } from '@/components/cms/page-ai-panel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { aiComposeSetup } from '@/server/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { createEntryAction, createFromAiDraftAction, draftPageAiAction } from '../actions.ts';

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
  // M6.12b: an AI first draft, for writers in orgs with the AI module.
  const ai = canWrite && data.modules.has('ai') ? await aiComposeSetup(data.ctx) : null;
  return (
    <>
      <PageHeader title={t(kind === 'page' ? 'newPage' : 'newPost')} description={t('newDescription')} />
      <Link href={`/o/${org}/content?kind=${kind}`} className="self-start text-body underline">
        {t('back')}
      </Link>
      {ai ? (
        <Card>
          <section aria-labelledby="cms-ai" className="flex flex-col gap-3">
            <h2 id="cms-ai" className="text-section">
              {t('ai.title')}
            </h2>
            <p className="text-body text-ink-2">{t('ai.explainer')}</p>
            <PageAiPanel
              setup={ai}
              draft={draftPageAiAction.bind(null, org)}
              create={createFromAiDraftAction.bind(null, org, kind)}
            />
          </section>
        </Card>
      ) : null}
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
        <p role="alert" className="rounded-card border border-line bg-surface px-4 py-3 text-body text-ink-2">
          {t('notAllowed')}
        </p>
      )}
    </>
  );
}
