import { INCIDENT_IMPACTS, INCIDENT_STATUSES, STATUS_COMPONENTS } from '@yayatoh/platform';
import { Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { IncidentUpdateForm, NewIncidentForm } from '@/components/incident-forms.tsx';
import { Shell } from '@/components/shell.tsx';
import { incidentProvider, listIncidents } from '@/server/incidents.ts';
import { requireStaff } from '@/server/staff.ts';
import { postIncidentAction, updateIncidentAction } from './actions.ts';

const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed'];

/**
 * Status-page incidents (M3.11b). With the fake provider staff post and update incidents here;
 * the public status page and the console/marketplace banner read them. With Better Stack they
 * are posted there (docs/runbooks/on-call.md).
 */
export default async function IncidentsPage() {
  const staff = await requireStaff('incidents');
  const t = await getTranslations('incidents');
  const fake = incidentProvider() === 'fake';
  const incidents = fake ? await listIncidents(staff) : [];
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t(fake ? 'descriptionFake' : 'descriptionProvider')} />
      {fake ? (
        <>
          <Card>
            <NewIncidentForm
              action={postIncidentAction}
              impacts={INCIDENT_IMPACTS}
              components={STATUS_COMPONENTS}
            />
          </Card>
          <section aria-labelledby="incidents-list" className="flex flex-col gap-4">
            <h2 id="incidents-list" className="text-section">
              {t('list')}
            </h2>
            {incidents.length === 0 ? <p className="text-body text-zinc-600">{t('empty')}</p> : null}
            {incidents.map((i) => (
              <Card key={i.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-body font-medium break-words">{i.title}</h3>
                  <StatusDot status={i.active ? 'danger' : 'success'} label={t(`status.${i.status}`)} />
                </div>
                <p className="text-caption text-zinc-600">
                  {t(`impact.${i.impact}`)} · {t('started', { date: date.format(i.startedAt) })}
                  {i.components.length > 0
                    ? ` · ${i.components.map((c) => t(`component.${c}`)).join(', ')}`
                    : ''}
                </p>
                <ol className="flex list-none flex-col gap-2 border-s border-zinc-200 p-0 ps-4">
                  {i.updates.map((u) => (
                    <li key={`${u.at.toISOString()}-${u.status}`} className="text-body">
                      <span className="text-caption text-zinc-500">
                        {t(`status.${u.status}`)} · {date.format(u.at)}
                      </span>
                      <p className="break-words whitespace-pre-line">{u.body}</p>
                    </li>
                  ))}
                </ol>
                {i.active ? (
                  <IncidentUpdateForm
                    id={i.id}
                    title={i.title}
                    action={updateIncidentAction.bind(null, i.id)}
                    statuses={INCIDENT_STATUSES.filter((s) =>
                      i.impact === 'maintenance'
                        ? MAINTENANCE_STATUSES.includes(s)
                        : !MAINTENANCE_STATUSES.includes(s),
                    )}
                  />
                ) : null}
              </Card>
            ))}
          </section>
        </>
      ) : (
        <Card>
          <p className="text-body">{t('providerNote')}</p>
        </Card>
      )}
    </Shell>
  );
}
