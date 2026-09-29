import { CONSENT_TERM_KEYS } from '@yayatoh/crm';
import { getRegistrationFormQuery, listJobTitlesQuery } from '@yayatoh/forms';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AddPageForm,
  AddQuestionForm,
  BuilderButton,
  type BuilderQuestion,
  JobTitlesForm,
  PageSettingsForm,
  QuestionSettingsForm,
  RegistrationPreview,
} from '@/components/registration-builder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { fromLogic, valueLabel } from '@/lib/registration-conditions.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { consoleRegistrationTypes } from '@/server/registration-types.ts';
import {
  addFieldAction,
  addPageAction,
  moveFieldAction,
  movePageAction,
  removeFieldAction,
  removePageAction,
  setJobTitlesAction,
  updateFieldAction,
  updatePageAction,
} from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registrationForm');
  return { title: t('title') };
}

/**
 * The registration form builder (M5.1b): pages, questions, per-type paths and conditions, all
 * with buttons and forms (move up/down is the keyboard alternative to dragging), a preview per
 * registration type and the org's job title list. Conference profiles with the `registration`
 * module only; viewers see the form but no controls.
 */
export default async function RegistrationFormPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'registration')) notFound();
  const t = await getTranslations('registrationForm');
  const canWrite = roleCan(data.role, 'events:write');
  const [form, jobTitles, types] = await Promise.all([
    executeQuery(getRegistrationFormQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listJobTitlesQuery, {}, data.ctx, ports),
    consoleRegistrationTypes(data, ev.id),
  ]);
  const pages = form?.definition.pages ?? [];
  const typeName = (id: string) => types.find((x) => x.id === id)?.name ?? t('unknownType');
  const q = (f: (typeof pages)[number]['fields'][number]): BuilderQuestion => ({
    key: f.key,
    label: f.label,
    type: f.type,
    options: f.options,
  });
  const all = pages.flatMap((p) => p.fields);
  const yesNo = { yes: t('yes'), no: t('no') };
  const conditionText = (logic: unknown) => {
    const c = fromLogic(logic);
    if (c === null) return null;
    if (c === 'custom') return t('customCondition');
    const field = all.find((x) => x.key === c.key);
    return t('shownWhen', {
      question: field?.label ?? c.key,
      op: t(`ops.${c.op}`),
      value: valueLabel(field, c.value, yesNo),
    });
  };
  const audience = (list: readonly string[] | null) =>
    list === null ? t('forAll') : t('forSome', { types: list.map(typeName).join(', ') });
  const terms = CONSENT_TERM_KEYS.map((key) => ({ key, label: t(`terms.${key}`) }));
  const version = form?.version ?? 0;
  const bind = <A extends unknown[], R>(fn: (org: string, event: string, ...a: A) => R) =>
    fn.bind(null, org, event) as (...a: A) => R;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          form ? (
            <p className="text-caption text-zinc-600">
              {t('summary', {
                version: form.version,
                submitted: form.submitted,
                inProgress: form.inProgress,
              })}
            </p>
          ) : null
        }
      />
      {ev.status === 'published' && pages.length > 0 ? (
        <p className="text-body text-zinc-600">
          {t('publicLink')}{' '}
          <Link href={`/events/${ev.slug}/registration-form`} className="underline underline-offset-2">
            {t('publicLinkText')}
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="rf-pages" className="flex flex-col gap-3">
        <h2 id="rf-pages" className="text-section">
          {t('pagesTitle')}
        </h2>
        {pages.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ol className="flex list-none flex-col gap-4 p-0">
            {pages.map((p, pi) => {
              const earlier = pages.slice(0, pi).flatMap((x) => x.fields);
              return (
                <li key={p.key}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <h3 className="text-section">{t('pageNumbered', { n: pi + 1, title: p.title })}</h3>
                        {p.description ? <p className="text-body text-zinc-600">{p.description}</p> : null}
                        <p className="text-caption text-zinc-600">
                          {[audience(p.registrationTypes), conditionText(p.showIf) ?? t('shownAlways')].join(
                            ' · ',
                          )}
                        </p>
                      </div>
                      {canWrite ? (
                        <div className="flex gap-1">
                          <BuilderButton
                            version={version}
                            action={bind(movePageAction).bind(null, p.key, -1)}
                            label="↑"
                            ariaLabel={t('movePageUp', { title: p.title })}
                            disabled={pi === 0}
                          />
                          <BuilderButton
                            version={version}
                            action={bind(movePageAction).bind(null, p.key, 1)}
                            label="↓"
                            ariaLabel={t('movePageDown', { title: p.title })}
                            disabled={pi === pages.length - 1}
                          />
                          <BuilderButton
                            version={version}
                            action={bind(removePageAction).bind(null, p.key)}
                            label={t('remove')}
                            ariaLabel={t('removePage', { title: p.title })}
                          />
                        </div>
                      ) : null}
                    </div>
                    <ol
                      aria-label={t('questionsOf', { title: p.title })}
                      className="flex list-none flex-col divide-y divide-zinc-100 rounded-card border border-zinc-200 p-0"
                    >
                      {p.fields.map((f, fi) => (
                        <li key={f.key} className="flex flex-col gap-2 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span>{f.label}</span>
                              <span className="text-caption text-zinc-600">
                                {[
                                  t(`types.${f.type}`),
                                  f.required ? t('requiredBadge') : null,
                                  f.sensitive ? t('privateBadge') : null,
                                  f.consent ? t('consentBadge', { version: f.consent.version }) : null,
                                  f.registrationTypes ? audience(f.registrationTypes) : null,
                                  conditionText(f.showIf),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            {canWrite ? (
                              <span className="flex gap-1">
                                <BuilderButton
                                  version={version}
                                  action={bind(moveFieldAction).bind(null, p.key, f.key, -1)}
                                  label="↑"
                                  ariaLabel={t('moveQuestionUp', { label: f.label })}
                                  disabled={fi === 0}
                                />
                                <BuilderButton
                                  version={version}
                                  action={bind(moveFieldAction).bind(null, p.key, f.key, 1)}
                                  label="↓"
                                  ariaLabel={t('moveQuestionDown', { label: f.label })}
                                  disabled={fi === p.fields.length - 1}
                                />
                                <BuilderButton
                                  version={version}
                                  action={bind(removeFieldAction).bind(null, p.key, f.key)}
                                  label={t('remove')}
                                  ariaLabel={t('removeQuestion', { label: f.label })}
                                />
                              </span>
                            ) : null}
                          </div>
                          {canWrite ? (
                            <details className="rounded-card bg-zinc-50 px-3 py-2">
                              <summary className="min-h-6 cursor-pointer text-body">
                                {t('questionSettings', { label: f.label })}
                              </summary>
                              <div className="pt-3">
                                <QuestionSettingsForm
                                  version={version}
                                  action={bind(updateFieldAction).bind(null, p.key, f.key)}
                                  types={types}
                                  initialTypes={f.registrationTypes}
                                  questions={[...earlier, ...p.fields.slice(0, fi)].map(q)}
                                  condition={f.showIf}
                                  required={f.required}
                                  canRequire={f.type !== 'consent'}
                                />
                              </div>
                            </details>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    {canWrite ? (
                      <>
                        <details className="rounded-card border border-zinc-200 px-4 py-3">
                          <summary className="min-h-6 cursor-pointer text-body">
                            {t('pageSettings', { title: p.title })}
                          </summary>
                          <div className="pt-3">
                            <PageSettingsForm
                              version={version}
                              action={bind(updatePageAction).bind(null, p.key)}
                              title={p.title}
                              description={p.description}
                              types={types}
                              initialTypes={p.registrationTypes}
                              questions={earlier.map(q)}
                              condition={p.showIf}
                            />
                          </div>
                        </details>
                        <details className="rounded-card border border-zinc-200 px-4 py-3">
                          <summary className="min-h-6 cursor-pointer text-body">
                            {t('addQuestionTo', { title: p.title })}
                          </summary>
                          <div className="pt-3">
                            <AddQuestionForm
                              version={version}
                              action={bind(addFieldAction).bind(null, p.key)}
                              types={types}
                              questions={[...earlier, ...p.fields].map(q)}
                              terms={terms}
                            />
                          </div>
                        </details>
                      </>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3">
            <h3 className="text-section">{t('addPageTitle')}</h3>
            <AddPageForm version={version} action={bind(addPageAction)} />
          </Card>
        ) : null}
      </section>

      {pages.length > 0 ? (
        <section aria-labelledby="rf-preview" className="flex flex-col gap-3">
          <h2 id="rf-preview" className="text-section">
            {t('previewTitle')}
          </h2>
          <Card>
            <RegistrationPreview
              types={types}
              pages={pages.map((p) => ({
                key: p.key,
                title: p.title,
                showIf: p.showIf,
                registrationTypes: p.registrationTypes,
                fields: p.fields.map((f) => ({
                  ...q(f),
                  required: f.required,
                  showIf: f.showIf,
                  registrationTypes: f.registrationTypes,
                })),
              }))}
            />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="rf-jobs" className="flex flex-col gap-3">
        <h2 id="rf-jobs" className="text-section">
          {t('jobTitlesTitle')}
        </h2>
        <Card className="flex flex-col gap-3">
          {canWrite ? (
            <JobTitlesForm action={bind(setJobTitlesAction)} titles={jobTitles} />
          ) : jobTitles.length === 0 ? (
            <p className="text-body text-zinc-600">{t('jobTitlesEmpty')}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 ps-5">
              {jobTitles.map((j) => (
                <li key={j}>{j}</li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
