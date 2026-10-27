import { MAX_PICKUP_POINTS, pickupPointsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AddPickupForm, EditPickupForm } from '@/components/pickup-forms.tsx';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { addPickupAction, deletePickupAction, updatePickupAction } from './actions.ts';

/**
 * Tours: the pickup points of a tour (name, address and how many minutes before departure
 * passengers should be there). Buyers choose one at checkout, in a checkout question this page
 * keeps in step with the list, and see it on their order. Departures and their capacity are the
 * event's dates.
 */
export default async function PickupsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'pickups');
  const t = await getTranslations('tourPickups');
  const points = await executeQuery(pickupPointsQuery, { eventId: ev.id }, data.ctx, ports);
  const canEdit = can('events:write');
  return (
    <>
      <PageHeader title={t('title')} description={`${ev.name} · ${t('description')}`} />
      {points.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('title')}>
          {points.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-3">
                {canEdit ? (
                  <EditPickupForm
                    id={p.id}
                    save={updatePickupAction.bind(null, org, event, p.id)}
                    remove={deletePickupAction.bind(null, org, event, p.id)}
                    initial={{ name: p.name, address: p.address, minutesBefore: p.minutesBefore }}
                  />
                ) : (
                  <p className="m-0 text-body">
                    <strong>{p.name}</strong> {p.address ? `· ${p.address}` : ''} ·{' '}
                    {t('beforeDeparture', { minutes: p.minutesBefore })}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {canEdit && points.length < MAX_PICKUP_POINTS ? (
        <section aria-labelledby="add-pickup-heading" className="flex flex-col gap-3">
          <h2 id="add-pickup-heading" className="text-section">
            {t('addTitle')}
          </h2>
          <Card>
            <AddPickupForm action={addPickupAction.bind(null, org, event)} />
          </Card>
        </section>
      ) : null}
      <p className="text-caption text-ink-2">{t('departuresHint')}</p>
    </>
  );
}
