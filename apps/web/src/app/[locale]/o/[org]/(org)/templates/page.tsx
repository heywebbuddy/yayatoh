import { executeQuery } from '@yayatoh/kernel';
import { listTemplatesQuery } from '@yayatoh/templates';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyEventForm } from '@/components/copy-forms.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createFromTemplateAction, deleteTemplateAction } from './actions.ts';

/** M1.4b: the org's event templates; each creates a new draft event (never with sales data). */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const templates = await executeQuery(listTemplatesQuery, {}, data.ctx, ports);
  return (
    <>
      <PageHeader title={t('templates.title')} description={t('templates.description')} />
      {templates.length === 0 ? (
        <EmptyState title={t('templates.emptyTitle')} description={t('templates.emptyDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-3.5 p-0">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Label>{t(`profiles.${tpl.profile}`)}</Label>
                    <h2 className="text-section">{tpl.name}</h2>
                    {tpl.description ? <p className="text-body text-zinc-600">{tpl.description}</p> : null}
                    <p className="text-caption text-zinc-500">
                      {t('templates.contents', {
                        ticketTypes: tpl.ticketTypes,
                        questions: tpl.questions,
                        seats: tpl.seats,
                      })}
                    </p>
                  </div>
                  {canWrite ? (
                    <form action={deleteTemplateAction.bind(null, org, tpl.id)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t('templates.deleteFor', { name: tpl.name })}
                      >
                        {t('templates.delete')}
                      </Button>
                    </form>
                  ) : null}
                </div>
                {canWrite ? (
                  <details className="group">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center text-body underline [&::-webkit-details-marker]:hidden">
                      {t('templates.use', { name: tpl.name })}
                    </summary>
                    <div className="pt-3">
                      <p className="pb-3 text-caption text-zinc-500">
                        {t('templates.timezone', { timezone: tpl.timezone.replace(/_/g, ' ') })}
                      </p>
                      <CopyEventForm
                        idPrefix={`tpl-${tpl.id}`}
                        action={createFromTemplateAction.bind(null, org, tpl.id, tpl.timezone)}
                        defaults={{ name: '', startsAt: '' }}
                        submitLabel={t('templates.createEvent')}
                      />
                    </div>
                  </details>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
