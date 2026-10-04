import { randomUUID } from 'node:crypto';
import type { PortalPrincipal } from '@yayatoh/events';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { type AllowancesDto, sponsorPortalQuery } from '@yayatoh/program';
import { sponsorCompUsageQuery } from '@yayatoh/registration';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  SectionHeader,
  StatusPill,
  Tag,
} from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { PortalFrame } from '@/components/portal-shell.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { formatSessionTime } from '@/lib/portal-format.ts';
import { portalRequestCtx } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { buyPackageAction, setDeliverableDoneAction } from './sponsor-actions.ts';

type T = Awaited<ReturnType<typeof getTranslations>>;

function Allowances({ a, t }: { a: AllowancesDto; t: T }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
      <li>{t('allowance.compRegistrations', { count: a.compRegistrations })}</li>
      <li>{t('allowance.exhibitorBadges', { count: a.exhibitorBadges })}</li>
      <li>{t('allowance.leadLicenses', { count: a.leadLicenses })}</li>
      <li>{t('allowance.sessionSlots', { count: a.sessionSlots })}</li>
      <li>
        {a.logoPlacements.length
          ? t('allowance.logo', { places: a.logoPlacements.map((p) => t(`placements.${p}`)).join(', ') })
          : t('allowance.noLogo')}
      </li>
    </ul>
  );
}

/**
 * The sponsor portal (M5.4b; decision P5-7), shown at /event-portal to a signed-in sponsor
 * contact: their package and what it includes (the comp registration code and how much of it is
 * used, sponsored sessions in the event time zone, logo placements), the packages they can buy
 * while they hold none (paid on the provider's page), and their deliverables checklist. Only the
 * signed-in contact's own sponsor at their one event is ever read.
 */
export async function SponsorPortal({
  principal,
  locale,
  paid,
}: {
  principal: PortalPrincipal;
  locale: string;
  paid: boolean;
}) {
  const ctx = await portalRequestCtx(principal);
  const view = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
  const usage = view.grant
    ? await executeQuery(sponsorCompUsageQuery, {}, ctx, ports).catch((err) => {
        // Registration may be off for this org: the code still shows, its use count does not.
        if (isDomainError(err)) return null;
        throw err;
      })
    : null;
  const t = await getTranslations('sponsorPortal');
  const tz = view.event.timezone;
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium' });
  const dueDay = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`),
    );
  const price = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const g = view.grant;
  const open = view.deliverables.filter((d) => d.status === 'open');
  return (
    <PortalFrame eventName={view.event.name}>
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={view.sponsor.name}
        tag={<Tag>{view.sponsor.tierName}</Tag>}
        description={t('signedInAs', { email: view.email })}
        meta={
          <span>
            {t('eventDates', { start: day.format(view.event.startsAt), end: day.format(view.event.endsAt) })}
          </span>
        }
      />
      {paid && g ? <Alert tone="info" title={t('paidTitle', { name: g.packageName })} /> : null}

      <section aria-labelledby="package-heading" className="flex flex-col gap-3">
        <SectionHeader id="package-heading" title={t('packageHeading')} />
        {g ? (
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-card">{g.packageName}</h3>
              <StatusPill tone="success" label={t('active')} />
            </div>
            <p className="m-0 text-caption text-ink-2">
              {g.source === 'purchase' ? t('paid', { price: price(g.priceMinor, g.currency) }) : t('granted')}
            </p>
            <Allowances a={g.allowances} t={t} />
            {g.allowances.compRegistrations > 0 ? (
              <div className="flex flex-col gap-1 rounded-card border border-line p-3">
                <h4 className="m-0 text-body font-bold">{t('compHeading')}</h4>
                {g.compCode ? (
                  <>
                    <p className="m-0 text-body">
                      {t('compCode')}{' '}
                      <span className="font-mono text-[17px] font-extrabold">{g.compCode}</span>
                    </p>
                    <p className="m-0 text-caption text-ink-2">{t('compHint')}</p>
                    {usage ? (
                      <p className="m-0 text-body tabular-nums" role="status">
                        {t('compUsed', { used: usage.used, allowance: usage.allowance })}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="m-0 text-body">{t('compPending')}</p>
                )}
              </div>
            ) : null}
            {g.allowances.exhibitorBadges > 0 || g.allowances.leadLicenses > 0 ? (
              <p className="m-0 text-caption text-ink-2">
                {view.sponsor.exhibitorName
                  ? t('exhibitorLinked', { name: view.sponsor.exhibitorName })
                  : t('exhibitorMissing')}
              </p>
            ) : null}
            {g.allowances.sessionSlots > 0 ? (
              <div className="flex flex-col gap-1">
                <h4 className="m-0 text-body font-bold">
                  {t('sessionsHeading', { used: g.sessions.length, slots: g.allowances.sessionSlots })}
                </h4>
                {g.sessions.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {g.sessions.map((s) => (
                      <li key={`${s.title}-${s.startsAt.toISOString()}`} className="text-body">
                        {s.title} ·{' '}
                        <span className="tabular-nums">
                          {formatSessionTime(s.startsAt, s.endsAt, locale, tz)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-caption text-ink-2">{t('noSessions')}</p>
                )}
              </div>
            ) : null}
          </Card>
        ) : view.pendingUntil ? (
          <Alert tone="info" title={t('pendingTitle')}>
            {t('pendingDescription')}
          </Alert>
        ) : view.forSale.length === 0 ? (
          <EmptyState title={t('noPackageTitle')} description={t('noPackageDescription')} />
        ) : (
          <>
            <p className="m-0 text-body text-ink-2">{t('chooseIntro')}</p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {view.forSale.map((p) => (
                <li key={p.tierId}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="m-0 text-card">{p.name}</h3>
                      <span className="text-card tabular-nums">{price(p.priceMinor, p.currency)}</span>
                    </div>
                    {p.description ? <p className="m-0 text-body text-ink-2">{p.description}</p> : null}
                    <Allowances a={p.allowances} t={t} />
                    {p.soldOut ? (
                      <StatusPill tone="danger" label={t('soldOut')} />
                    ) : (
                      <ProgramForm
                        action={buyPackageAction.bind(
                          null,
                          p.tierId,
                          `${p.name} · ${view.event.name}`,
                          randomUUID(),
                        )}
                        idPrefix={`buy-${p.tierId}`}
                        fields={[]}
                        submitLabel={t('buy', { name: p.name, price: price(p.priceMinor, p.currency) })}
                        successLabel={t('redirecting')}
                        errors={{
                          sold_out: t('errors.soldOut'),
                          already_granted: t('errors.alreadyGranted'),
                          purchase_pending: t('errors.purchasePending'),
                        }}
                      />
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="deliverables-heading" className="flex flex-col gap-3">
        <SectionHeader id="deliverables-heading" title={t('deliverablesHeading', { count: open.length })} />
        {view.deliverables.length === 0 ? (
          <EmptyState title={t('noDeliverablesTitle')} description={t('noDeliverablesDescription')} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {view.deliverables.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body font-bold text-ink">{d.title}</span>
                    <span className="text-caption text-ink-2">
                      {d.owner === 'sponsor' ? t('ownerYou') : t('ownerOrganizer')}
                      {d.ownerName ? ` (${d.ownerName})` : ''} · {t('due', { date: dueDay(d.dueDate) })}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={d.status === 'done' ? 'success' : d.overdue ? 'danger' : 'waiting'}
                      label={d.status === 'done' ? t('done') : d.overdue ? t('overdue') : t('open')}
                    />
                    {d.owner === 'sponsor' ? (
                      <form action={setDeliverableDoneAction.bind(null, d.id, d.status !== 'done')}>
                        <Button type="submit" variant="secondary" size="sm">
                          {d.status === 'done'
                            ? t('reopen', { title: d.title })
                            : t('markDone', { title: d.title })}
                        </Button>
                      </form>
                    ) : null}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalFrame>
  );
}
