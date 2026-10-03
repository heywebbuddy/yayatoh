import { executeQuery } from '@yayatoh/kernel';
import { composeNav, navLabelKey, PROFILES } from '@yayatoh/platform';
import { listTemplatesQuery, STARTER_KEYS, STARTER_TEMPLATES } from '@yayatoh/templates';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyEventForm } from '@/components/copy-forms.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createFromStarterAction, createFromTemplateAction, deleteTemplateAction } from './actions.ts';

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
      {/* M4.2a: starter templates. The profile presets modules, navigation and the checklist. */}
      <section aria-labelledby="starters-heading" className="flex flex-col gap-3">
        <h2 id="starters-heading" className="text-section">
          {t('starters.title')}
        </h2>
        <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2">
          {STARTER_KEYS.map((key) => {
            const profile = STARTER_TEMPLATES[key].profile;
            const nav = composeNav(profile, data.modules).filter((i) => i.group !== 'overview');
            const checklist = PROFILES[profile].checklist ?? [];
            return (
              <li key={key} data-starter={key}>
                <Card className="flex h-full flex-col gap-3">
                  <Label>{t('starters.label')}</Label>
                  <h3 className="text-section">{t(`starters.${key}.name`)}</h3>
                  <p className="text-body text-ink-2">{t(`starters.${key}.description`)}</p>
                  <p className="text-caption text-ink-2">
                    {t('starters.sections', {
                      list: nav.map((i) => t(navLabelKey(profile, i))).join(', '),
                    })}
                  </p>
                  <p className="text-caption text-ink-2">
                    {t('starters.checklist', {
                      list: checklist.map((k) => t(`readiness.${k}`)).join(', '),
                    })}
                  </p>
                  {canWrite ? (
                    <details className="group">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center text-body underline [&::-webkit-details-marker]:hidden">
                        {t('starters.use', { name: t(`starters.${key}.name`) })}
                      </summary>
                      <div className="pt-3">
                        <CopyEventForm
                          idPrefix={`starter-${key}`}
                          action={createFromStarterAction.bind(null, org, key)}
                          defaults={{ name: '', startsAt: '' }}
                          submitLabel={t('templates.createEvent')}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
      <h2 className="text-section">{t('starters.yours')}</h2>
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
                    {tpl.description ? <p className="text-body text-ink-2">{tpl.description}</p> : null}
                    <p className="text-caption text-ink-2">
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
                      <p className="pb-3 text-caption text-ink-2">
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
