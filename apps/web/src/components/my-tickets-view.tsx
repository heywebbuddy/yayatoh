import { formatMoney, money } from '@yayatoh/kernel';
import { guestOrders } from '@yayatoh/orders';
import { Alert, Button, Card, EmptyState, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import {
  orderLinksAction,
  signInAction,
  signOutAction,
  signOutEverywhereAction,
} from '@/app/[locale]/my-tickets/actions.ts';
import { OrderLinksForm, SignInForm } from '@/components/my-tickets-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { currentGuestSession } from '@/server/guest.ts';

/**
 * "My tickets" (M1.5f): on an org's site that org's orders, on the marketplace every org's, for
 * the address the attendee proved. Each order opens the existing manage-token order page.
 */
export async function MyTicketsView({
  orgId,
  siteName,
  locale,
  signedOut,
}: {
  orgId: string | null;
  siteName: string;
  locale: string;
  signedOut?: string;
}) {
  const t = await getTranslations();
  const session = await currentGuestSession(orgId);
  const orders = session ? await guestOrders(session.email, orgId) : [];
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{siteName}</Label>}
        title={t('attendeeSignIn.title')}
        description={
          session ? t('attendeeSignIn.signedInAs', { email: session.email }) : t('attendeeSignIn.intro')
        }
      />
      {signedOut && !session ? (
        <Alert
          tone="info"
          title={signedOut === 'all' ? t('attendeeSignIn.signedOutAll') : t('attendeeSignIn.signedOut')}
        />
      ) : null}
      {session ? (
        <>
          {orders.length === 0 ? (
            <EmptyState
              title={t('attendeeSignIn.noneTitle')}
              description={t('attendeeSignIn.noneDescription')}
            />
          ) : (
            <ul aria-label={t('attendeeSignIn.ordersLabel')} className="flex list-none flex-col gap-3 p-0">
              {orders.map((o) => (
                <li key={o.orderId}>
                  <Card className="flex flex-col gap-2">
                    {orgId ? null : <Label>{o.orgName}</Label>}
                    <h2 className="text-section">{o.eventName}</h2>
                    <p className="text-caption text-zinc-600">
                      {formatEventDateRange(o.startsAt.toISOString(), o.endsAt.toISOString(), {
                        locale,
                        currency: o.currency,
                        timeZone: o.timeZone,
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      <StatusDot
                        status={o.status === 'paid' ? 'success' : 'warning'}
                        label={t(`order.status.${o.status}`)}
                      />
                      <span className="text-caption text-zinc-600">
                        {t('attendeeSignIn.tickets', { count: o.tickets })}
                      </span>
                      <span className="font-mono text-caption tabular-nums">
                        {formatMoney(money(o.totalMinor, o.currency), locale)}
                      </span>
                      <Link
                        href={o.managePath}
                        className="inline-flex min-h-6 items-center text-body underline underline-offset-2"
                      >
                        {t('attendeeSignIn.openOrder', { event: o.eventName })}
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <form action={signOutAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">
                {t('attendeeSignIn.signOut')}
              </Button>
            </form>
            <form action={signOutEverywhereAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">
                {t('attendeeSignIn.signOutEverywhere')}
              </Button>
            </form>
          </div>
        </>
      ) : (
        <Card>
          <SignInForm action={signInAction.bind(null, orgId)} />
        </Card>
      )}
      <OrderLinksForm action={orderLinksAction.bind(null, orgId)} />
    </main>
  );
}
