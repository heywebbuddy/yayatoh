import { formatMoney, money } from '@yayatoh/kernel';
import type { GuestOrderDto } from '@yayatoh/orders';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { signOutAttendee } from '@/app/[locale]/attendee/actions.ts';
import { signInAction } from '@/app/[locale]/my-tickets/actions.ts';
import { AccountSecurityView } from '@/components/account-security-view.tsx';
import { AttendeeProfile } from '@/components/attendee-profile.tsx';
import { SignInForm } from '@/components/my-tickets-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { type AttendeeSection, attendeeEvents, upcomingOrders } from '@/lib/attendee.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { attendeePreferences, loadAttendee } from '@/server/attendee.ts';
import { scheduleSummary } from '@/server/schedule.ts';

async function BookingCard({
  order,
  locale,
  schedule = false,
}: {
  order: GuestOrderDto;
  locale: string;
  schedule?: boolean;
}) {
  const t = await getTranslations('attendeeDashboard');
  const all = await getTranslations();
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <p className="text-caption text-ink-2">{order.orgName}</p>
      <h2 className="break-words text-section">{order.eventName}</h2>
      <p className="text-body text-ink-2">
        {formatEventDateRange(order.startsAt.toISOString(), order.endsAt.toISOString(), {
          locale,
          currency: order.currency,
          timeZone: order.timeZone,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusDot
          status={order.status === 'paid' ? 'success' : 'warning'}
          label={all(`order.status.${order.status}`)}
        />
        <span className="text-caption">{t('ticketCount', { count: order.tickets })}</span>
        <span className="text-body font-semibold tabular-nums">
          {formatMoney(money(order.totalMinor, order.currency), locale)}
        </span>
      </div>
      <Link
        href={schedule ? `${order.managePath}/schedule` : order.managePath}
        className={buttonClass('secondary', 'sm', 'self-start')}
      >
        {t(schedule ? 'openSchedule' : 'openOrder')}
      </Link>
    </Card>
  );
}

export async function AttendeeView({ locale, section }: { locale: string; section: AttendeeSection }) {
  setRequestLocale(locale);
  const [data, t] = await Promise.all([loadAttendee(), getTranslations('attendeeDashboard')]);
  const heading = <PageHeader title={t(`nav.${section}`)} description={t(`descriptions.${section}`)} />;
  if (!data.identity)
    return (
      <>
        {heading}
        <Card className="flex flex-col gap-4">
          <h2 className="text-section">{t('signInTitle')}</h2>
          <p className="text-body text-ink-2">{t('signInHint')}</p>
          {data.unverified ? <Alert title={t('verifyEmail')} /> : null}
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/sign-in?next=/attendee${section === 'overview' ? '' : `/${section}`}`}
              className={buttonClass('primary')}
            >
              {t('accountSignIn')}
            </Link>
            <Link href="/sign-up" className={buttonClass('secondary')}>
              {t('createAccount')}
            </Link>
          </div>
          <p className="text-body font-bold">{t('guestSignIn')}</p>
          <SignInForm action={signInAction.bind(null, null)} />
        </Card>
      </>
    );
  const identity = data.identity;
  const now = new Date();
  const upcoming = upcomingOrders(data.orders, now);
  const requireAccount = (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('accountRequired')}</h2>
      <p className="text-body text-ink-2">{t('accountRequiredHint')}</p>
      <Link
        href={`/sign-in?next=/attendee/${section}`}
        className={buttonClass('primary', 'md', 'self-start')}
      >
        {t('accountSignIn')}
      </Link>
      <Link href={`/sign-up/${section}`} className="text-body underline">
        {t('createAccount')}
      </Link>
    </Card>
  );
  const empty = (
    <EmptyState
      title={t('emptyTitle')}
      description={t('emptyHint')}
      action={
        <Link href="/events" className={buttonClass('primary')}>
          {t('browse')}
        </Link>
      }
    />
  );
  if (section === 'profile')
    return (
      <>
        {heading}
        {identity.kind === 'account' ? (
          <AttendeeProfile name={identity.name} email={identity.email} image={identity.image} />
        ) : (
          requireAccount
        )}
      </>
    );
  if (section === 'settings')
    return (
      <>
        {identity.kind === 'account' ? (
          <AccountSecurityView
            embedded
            params={Promise.resolve({ locale })}
            searchParams={Promise.resolve({})}
          />
        ) : (
          <>
            {heading}
            {requireAccount}
          </>
        )}
      </>
    );
  if (section === 'notifications') {
    const preferences = await attendeePreferences();
    return (
      <>
        {heading}
        {preferences.length ? (
          preferences.map((org) => (
            <Card key={org.orgId} className="flex flex-col gap-3">
              <h2 className="text-section">{org.name}</h2>
              <p className="text-body text-ink-2">{t('preferencesHint')}</p>
              <div className="flex flex-wrap gap-3">
                {org.href ? (
                  <Link href={org.href} className={buttonClass('secondary', 'sm')}>
                    {t('managePreferences')}
                  </Link>
                ) : (
                  <p className="text-caption text-ink-2">{t('noPreferences')}</p>
                )}
                {org.slug ? (
                  <Link
                    href={`/privacy-request/${org.slug}`}
                    className="inline-flex min-h-10 items-center text-caption underline"
                  >
                    {t('organizationPrivacy')}
                  </Link>
                ) : null}
              </div>
            </Card>
          ))
        ) : (
          <EmptyState title={t('noOrganizations')} description={t('preferencesEmpty')} />
        )}
      </>
    );
  }
  if (section === 'schedule') {
    const entries = await Promise.all(
      data.orders
        .filter((order) => order.status !== 'refunded')
        .map(async (order) => ({
          order,
          summary: await scheduleSummary(order.managePath.slice('/orders/'.length)),
        })),
    );
    const schedules = entries.filter((entry) => entry.summary);
    return (
      <>
        {heading}
        {schedules.length ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {schedules.map(({ order }) => (
              <BookingCard key={order.orderId} order={order} locale={locale} schedule />
            ))}
          </div>
        ) : (
          <EmptyState title={t('noSchedule')} description={t('noScheduleHint')} />
        )}
      </>
    );
  }
  if (section === 'events') {
    const events = attendeeEvents(data.orders);
    const groups = [
      { key: 'upcoming', entries: events.filter((event) => event.endsAt > now) },
      { key: 'past', entries: events.filter((event) => event.endsAt <= now) },
    ];
    return (
      <>
        {heading}
        {events.length
          ? groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-4">
                <h2 className="text-section">{t(group.key)}</h2>
                {group.entries.length ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {group.entries.map((order) => (
                      <BookingCard key={order.eventId} order={order} locale={locale} />
                    ))}
                  </div>
                ) : (
                  <p className="text-body text-ink-2">{t('noneInPeriod')}</p>
                )}
              </section>
            ))
          : empty}
      </>
    );
  }
  if (section === 'tickets')
    return (
      <>
        {heading}
        {data.orders.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.orders.map((order) => (
              <BookingCard key={order.orderId} order={order} locale={locale} />
            ))}
          </div>
        ) : (
          empty
        )}
      </>
    );
  return (
    <>
      {heading}
      <p className="break-words text-body text-ink-2">{t('signedInAs', { email: identity.email })}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'upcomingEvents', count: attendeeEvents(upcoming).length, href: '/attendee/events' },
          { label: 'orders', count: data.orders.length, href: '/attendee/tickets' },
          {
            label: 'eventsAttended',
            count: attendeeEvents(
              data.orders.filter((order) => order.endsAt <= now && order.status !== 'refunded'),
            ).length,
            href: '/attendee/events',
          },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="flex h-full flex-col gap-2">
              <span className="text-caption text-ink-2">{t(stat.label)}</span>
              <span className="text-3xl font-extrabold tabular-nums">{stat.count}</span>
            </Card>
          </Link>
        ))}
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-section">{t('nextEvents')}</h2>
        {upcoming.length
          ? upcoming
              .slice(0, 3)
              .map((order) => <BookingCard key={order.orderId} order={order} locale={locale} />)
          : empty}
      </section>
      <form action={signOutAttendee}>
        <button type="submit" className={buttonClass('secondary', 'sm')}>
          {t('signOut')}
        </button>
      </form>
    </>
  );
}
