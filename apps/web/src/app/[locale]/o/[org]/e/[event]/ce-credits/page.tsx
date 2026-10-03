import { ceSetupQuery, formatCredits } from '@yayatoh/ce';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import { Award, CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CalculateForm, RuleForm, SettingsForm } from '@/components/ce/ce-forms.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { calculateAction, removeRuleAction, saveRuleAction, saveSettingsAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ce.setup');
  return { title: t('title') };
}

/**
 * CE credits (M6.9b): the credit's name and accreditor, a rule per session (credits, minimum
 * minutes, in person and/or online), the calculation from session door scans, watch time and Zoom
 * attendance, and the certificates it issued. Read with `events:read`; editors (`events:write`)
 * change rules and calculate.
 */
export default async function CeCreditsPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'ceCredits');
  if (!data.modules.has('virtual') || !can('events:read')) notFound();
  const t = await getTranslations('ce.setup');
  const tr = await getTranslations();
  const setup = await executeQuery(ceSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const canEdit = can('events:write');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: ev.timezone });
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const label = setup.creditLabel ?? t('defaultLabel');
  const ruled = setup.sessions.filter((s) => s.rule);
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tr('nav.ceCredits') },
            ]}
          />
        }
        title={t('title')}
        description={t('description', { event: ev.name })}
      />
      {!canEdit ? <Alert tone="info" title={t('readOnly')} /> : null}
      <Card id="new-certificates">
        <h2 className="m-0 mb-1 text-section">{t('calculateTitle')}</h2>
        <p className="mt-0 mb-3 text-caption text-ink-2">
          {setup.calculatedAt
            ? t('lastCalculated', { when: when.format(setup.calculatedAt) })
            : t('calculateHint')}
        </p>
        {ruled.length === 0 ? <Alert tone="info" title={t('noRulesYet')} /> : null}
        <CalculateForm
          canEdit={canEdit}
          disabled={ruled.length === 0}
          calculate={calculateAction.bind(null, org, event)}
        />
      </Card>
      <Card>
        <h2 className="m-0 mb-3 text-section">{t('settingsTitle')}</h2>
        <SettingsForm
          creditLabel={setup.creditLabel}
          accreditor={setup.accreditor}
          canEdit={canEdit}
          save={saveSettingsAction.bind(null, org, event)}
        />
      </Card>
      <section className="flex flex-col gap-3" aria-labelledby="ce-sessions">
        <h2 id="ce-sessions" className="m-0 text-section">
          {t('sessionsTitle')}
        </h2>
        <p className="m-0 text-caption text-ink-2">{t('sessionsHint')}</p>
        {setup.sessions.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title={t('noSessions')}
            description={t('noSessionsHint')}
            action={
              <Link href={`/o/${org}/e/${event}/sessions`} className={buttonClass('secondary')}>
                {t('addSessions')}
              </Link>
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {setup.sessions.map((s) => (
              <li key={s.sessionId}>
                <Card>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <h3 className="m-0 text-body font-semibold">{s.title}</h3>
                      <span className="text-caption text-ink-2">{when.format(s.startsAt)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill
                        tone={s.ended ? 'neutral' : 'waiting'}
                        label={t(s.ended ? 'ended' : 'upcoming')}
                      />
                      {s.rule ? (
                        <StatusPill tone="success" label={t('awarded', { count: s.awarded })} />
                      ) : null}
                    </div>
                  </div>
                  <RuleForm
                    title={s.title}
                    credits={s.rule ? formatCredits(s.rule.credits, 'en') : ''}
                    minMinutes={s.rule?.minMinutes ?? null}
                    countInPerson={s.rule?.countInPerson ?? true}
                    countVirtual={s.rule?.countVirtual ?? true}
                    hasRule={s.rule !== null}
                    canEdit={canEdit}
                    save={saveRuleAction.bind(null, org, event, s.sessionId)}
                    remove={removeRuleAction.bind(null, org, event, s.sessionId)}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="ce-certificates">
        <h2 id="ce-certificates" className="m-0 text-section">
          {t('certificatesTitle')}
        </h2>
        {setup.certificates.length === 0 ? (
          <EmptyState
            icon={<Award />}
            title={t('noCertificates')}
            description={t('noCertificatesHint')}
            action={
              <a href="#new-certificates" className={buttonClass('secondary', 'md')}>
                {t('goCalculate')}
              </a>
            }
          />
        ) : (
          <Table
            caption={t('certificatesTitle')}
            rowKey={(c) => c.id}
            rows={setup.certificates}
            stackOnPhone
            columns={[
              {
                key: 'holder',
                header: t('holder'),
                cell: (c) => <span className="font-medium">{c.holderName}</span>,
              },
              {
                key: 'credits',
                header: t('creditsColumn'),
                align: 'end',
                cell: (c) => `${formatCredits(c.totalCredits, locale)} ${label}`,
              },
              {
                key: 'code',
                header: t('code'),
                cell: (c) => (
                  <span className="font-mono" dir="ltr">
                    {c.code}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('status'),
                cell: (c) =>
                  c.status === 'issued' ? (
                    <StatusPill tone="success" label={t('statusIssued', { revision: c.revision })} />
                  ) : (
                    <StatusPill tone="danger" label={t('statusRevoked')} />
                  ),
              },
              { key: 'issued', header: t('issuedOn'), cell: (c) => day.format(c.issuedAt) },
              {
                key: 'pdf',
                header: t('document'),
                cell: (c) => (
                  <a
                    href={`${prefix}/o/${org}/e/${event}/ce-credits/${c.id}/pdf`}
                    className="underline underline-offset-2"
                    aria-label={t('downloadLabel', { name: c.holderName })}
                  >
                    {t('download')}
                  </a>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
