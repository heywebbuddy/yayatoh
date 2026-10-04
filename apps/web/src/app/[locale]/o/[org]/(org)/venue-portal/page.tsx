import { executeQuery } from '@yayatoh/kernel';
import { venuePortalQuery } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerForm } from '@/components/venue-portal.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { addPartnerAction, removePartnerAction, setShareAction } from './actions.ts';

const DONE = ['shared', 'unshared', 'removed'] as const;

/**
 * The venue portal (M6.14b): the organizers this venue works with (`venue_partner`), which of its
 * library plans each may use (copy-on-use), and the partner events that use them (name, date,
 * status and organizer only). Owners and admins change sharing; everyone with events access reads.
 */
export default async function VenuePortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, org } = await params;
  const { done } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('venuePortal');
  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Link href={`/o/${org}/venues`} className={buttonClass('secondary')}>
          {t('spaces')}
        </Link>
      }
    />
  );
  if (!data.modules.has('advanced_seating'))
    return (
      <>
        {header}
        <EmptyState
          title={t('offTitle')}
          description={t('offDescription')}
          action={
            <Link href={`/o/${org}/plan`} className={buttonClass('primary', 'md')}>
              {t('offAction')}
            </Link>
          }
        />
      </>
    );
  const canWrite = roleCan(data.role, 'org:update');
  const portal = await executeQuery(venuePortalQuery, {}, data.ctx, ports);
  const partnerName = new Map(portal.partners.map((p) => [p.orgId, p.name]));
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const when = (d: Date, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
  const doneKey = DONE.find((d) => d === done);
  return (
    <>
      {header}
      {doneKey ? (
        <div role="status">
          <Alert tone="success" title={t(`done.${doneKey}`)} />
        </div>
      ) : null}
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="partners-heading" className="flex flex-col gap-3">
        <h2 id="partners-heading" className="text-section">
          {t('partnersTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('partnersDescription')}</p>
        {portal.partners.length === 0 ? (
          <EmptyState
            title={t('partnersEmptyTitle')}
            description={canWrite ? t('partnersEmptyDescription') : t('partnersEmptyViewer')}
            action={
              canWrite ? (
                <Link href="#new-partner" className={buttonClass('primary', 'md')}>
                  {t('addPartner')}
                </Link>
              ) : (
                <Link href={`/o/${org}/team`} className={buttonClass('secondary', 'md')}>
                  {t('findOwner')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('partnersCaption')}
            rowKey={(p) => p.orgId}
            rows={portal.partners}
            columns={[
              { key: 'name', header: t('partnerName'), cell: (p) => p.name },
              { key: 'slug', header: t('partnerAddress'), cell: (p) => p.slug, mono: true },
              { key: 'since', header: t('partnerSince'), cell: (p) => day.format(p.since) },
              ...(canWrite
                ? [
                    {
                      key: 'remove',
                      header: t('actions'),
                      cell: (p: (typeof portal.partners)[number]) => (
                        <form action={removePartnerAction.bind(null, org, p.orgId)}>
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            aria-label={t('removeNamed', { name: p.name })}
                          >
                            {t('remove')}
                          </Button>
                        </form>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {canWrite ? (
          <div id="new-partner">
            <PartnerForm action={addPartnerAction.bind(null, org)} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="plans-heading" className="flex flex-col gap-3">
        <h2 id="plans-heading" className="text-section">
          {t('plansTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('plansDescription')}</p>
        {portal.layouts.length === 0 ? (
          <EmptyState
            title={t('plansEmptyTitle')}
            description={t('plansEmptyDescription')}
            action={
              <Link href={`/o/${org}/seating-library`} className={buttonClass('primary', 'md')}>
                {t('toLibrary')}
              </Link>
            }
          />
        ) : (
          <ul className="grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
            {portal.layouts.map((l) => (
              <li key={l.id}>
                <Card className="flex flex-col gap-3" data-testid="portal-plan">
                  <h3 className="text-body font-medium">{l.name}</h3>
                  <p className="text-caption text-ink-2">
                    {t('seats', { count: l.seatCount })} · {t('usedBy', { count: l.uses })}
                  </p>
                  {l.sharedWith.length > 0 ? (
                    <p className="text-caption">
                      {t('sharedWith', {
                        names: l.sharedWith.map((id) => partnerName.get(id) ?? '').join(', '),
                      })}
                    </p>
                  ) : (
                    <StatusDot status="neutral" label={t('private')} />
                  )}
                  {canWrite && portal.partners.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {portal.partners.map((p) => {
                        const on = l.sharedWith.includes(p.orgId);
                        return (
                          <form key={p.orgId} action={setShareAction.bind(null, org, l.id, p.orgId, !on)}>
                            <Button
                              type="submit"
                              size="sm"
                              variant={on ? 'ghost' : 'secondary'}
                              aria-label={
                                on
                                  ? t('unshareNamed', { plan: l.name, name: p.name })
                                  : t('shareNamed', { plan: l.name, name: p.name })
                              }
                            >
                              {on ? t('unshare', { name: p.name }) : t('share', { name: p.name })}
                            </Button>
                          </form>
                        );
                      })}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="uses-heading" className="flex flex-col gap-3">
        <h2 id="uses-heading" className="text-section">
          {t('usesTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('usesDescription')}</p>
        {portal.uses.length === 0 ? (
          <EmptyState
            title={t('usesEmptyTitle')}
            description={t('usesEmptyDescription')}
            action={
              <Link href="#plans-heading" className={buttonClass('secondary', 'md')}>
                {t('toPlans')}
              </Link>
            }
          />
        ) : (
          <Table
            caption={t('usesCaption')}
            rowKey={(u) => `${u.layoutId}:${u.eventName}:${u.usedAt.toISOString()}`}
            rows={portal.uses}
            columns={[
              { key: 'event', header: t('event'), cell: (u) => u.eventName },
              { key: 'organizer', header: t('organizer'), cell: (u) => u.organizerName },
              { key: 'when', header: t('when'), cell: (u) => when(u.startsAt, u.timezone) },
              {
                key: 'status',
                header: t('status'),
                cell: (u) => (
                  <StatusDot
                    status={
                      u.status === 'published' ? 'success' : u.status === 'cancelled' ? 'danger' : 'neutral'
                    }
                    label={t.has(`eventStatus.${u.status}`) ? t(`eventStatus.${u.status}`) : u.status}
                  />
                ),
              },
              { key: 'plan', header: t('plan'), cell: (u) => u.layoutName },
            ]}
          />
        )}
      </section>
    </>
  );
}
