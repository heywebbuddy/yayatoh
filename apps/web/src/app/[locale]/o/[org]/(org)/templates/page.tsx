import { executeQuery } from '@yayatoh/kernel';
import { composeNav, navLabelKey, PROFILES } from '@yayatoh/platform';
import { listTemplatesQuery, STARTER_KEYS, STARTER_TEMPLATES } from '@yayatoh/templates';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyEventForm } from '@/components/copy-forms.tsx';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  copyStarterAction,
  createFromStarterAction,
  createFromTemplateAction,
  deleteTemplateAction,
  duplicateTemplateAction,
  setTemplateArchivedAction,
} from './actions.ts';

/**
 * M1.4b: the org's event templates; each creates a new draft event (never with sales data). U6: a
 * New template builder, edit, duplicate and archive, and starters copied into "Your templates".
 */
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
  const [templates, archived] = await Promise.all([
    executeQuery(listTemplatesQuery, {}, data.ctx, ports),
    executeQuery(listTemplatesQuery, { archived: true }, data.ctx, ports),
  ]);
  return (
    <>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.description')}
        actions={
          canWrite ? (
            <Link href={`/o/${org}/templates/new`} className={buttonClass('primary', 'md')}>
              {t('templates.newTemplate')}
            </Link>
          ) : undefined
        }
      />
      {/* U2: Create › Template lands here (`#new-template`): how a template is made. */}
      <HowItWorks topic="templates" id="new-template" />
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
                  <p className="text-caption text-ink-2">{t('starters.readOnly')}</p>
                  {canWrite ? (
                    <form action={copyStarterAction.bind(null, org, key)}>
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        aria-label={t('starters.copyFor', { name: t(`starters.${key}.name`) })}
                      >
                        {t('starters.copy')}
                      </Button>
                    </form>
                  ) : null}
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
                          timeZone={data.org.timezone}
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
        <EmptyState
          title={t('templates.emptyTitle')}
          description={t('templates.emptyDescription')}
          action={
            canWrite ? (
              <Link href={`/o/${org}/templates/new`} className={buttonClass('primary', 'md')}>
                {t('templates.newTemplate')}
              </Link>
            ) : (
              <Link href={`/o/${org}`} className={buttonClass('secondary', 'md')}>
                {t('emptyActions.seeEvents')}
              </Link>
            )
          }
        />
      ) : (
        <ul className="flex list-none flex-col gap-3.5 p-0">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Label>{t(`profiles.${tpl.profile}`)}</Label>
                    <h2 className="text-section">
                      <Link href={`/o/${org}/templates/${tpl.id}`} className="hover:underline">
                        {tpl.name}
                      </Link>
                    </h2>
                    {tpl.description ? <p className="text-body text-ink-2">{tpl.description}</p> : null}
                    <p className="text-caption text-ink-2">
                      {t('templates.contents', {
                        ticketTypes: tpl.ticketTypes,
                        questions: tpl.questions,
                        seats: tpl.seats,
                      })}
                    </p>
                    <p className="text-caption text-ink-2">
                      {t('templates.summary', { sections: tpl.sections, checklist: tpl.checklist })} ·{' '}
                      {tpl.origin === 'event' ? t('templates.originEvent') : t('templates.originScratch')}
                    </p>
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Link
                        href={`/o/${org}/templates/${tpl.id}`}
                        aria-label={t('templates.editFor', { name: tpl.name })}
                        className={buttonClass('ghost', 'sm')}
                      >
                        {t('templates.edit')}
                      </Link>
                      <form action={duplicateTemplateAction.bind(null, org, tpl.id, tpl.name)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('templates.duplicateFor', { name: tpl.name })}
                        >
                          {t('templates.duplicate')}
                        </Button>
                      </form>
                      <form action={setTemplateArchivedAction.bind(null, org, tpl.id, true)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('templates.archiveFor', { name: tpl.name })}
                        >
                          {t('templates.archive')}
                        </Button>
                      </form>
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
                    </div>
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
                        timeZone={tpl.timezone}
                      />
                    </div>
                  </details>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading">
          <details className="group flex flex-col gap-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
              <h2 id="archived-heading" className="text-section underline">
                {t('templates.archivedTitle', { count: archived.length })}
              </h2>
            </summary>
            <p className="pb-3 text-body text-ink-2">{t('templates.archivedHint')}</p>
            <ul className="flex list-none flex-col gap-2 p-0">
              {archived.map((tpl) => (
                <li
                  key={tpl.id}
                  data-archived-template={tpl.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3"
                >
                  <Link href={`/o/${org}/templates/${tpl.id}`} className="text-body underline">
                    {tpl.name}
                  </Link>
                  {canWrite ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <form action={setTemplateArchivedAction.bind(null, org, tpl.id, false)}>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          aria-label={t('templates.restoreFor', { name: tpl.name })}
                        >
                          {t('templates.restore')}
                        </Button>
                      </form>
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
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </>
  );
}
