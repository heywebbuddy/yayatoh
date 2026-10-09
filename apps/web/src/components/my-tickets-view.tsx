import { formatMoney, money } from '@yayatoh/kernel';
import { guestOrders } from '@yayatoh/orders';
import { Alert, Card, EmptyState, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { orderLinksAction, signInAction, signOutAction } from '@/app/[locale]/my-tickets/actions.ts';
import { OrderLinksForm, SignInForm, SignOutButtons } from '@/components/my-tickets-forms.tsx';
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
    <main
      id="main"
      className={`mx-auto flex w-full flex-col gap-8 px-4 py-8 md:px-6 ${orgId === null ? 'max-w-6xl' : 'min-h-dvh max-w-2xl py-12'}`}
    >
      {orgId === null ? (
        <section className="relative isolate overflow-hidden rounded-[32px] bg-hero px-6 py-10 text-white elevation-card md:px-10 md:py-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-12 -top-24 -z-10 size-80 rounded-full bg-white/20 blur-3xl"
          />
          <div className="relative flex max-w-3xl flex-col gap-3">
            <Label>{siteName}</Label>
            <h1 className="m-0 text-[38px] leading-[1.04] font-extrabold tracking-[-0.045em] md:text-[52px]">
              {t('attendeeSignIn.title')}
            </h1>
            <p className="m-0 max-w-2xl text-[16px] leading-relaxed text-white/85 md:text-[18px]">
              {session ? t('attendeeSignIn.signedInAs', { email: session.email }) : t('attendeeSignIn.intro')}
            </p>
          </div>
        </section>
      ) : (
        <PageHeader
          eyebrow={<Label>{siteName}</Label>}
          title={t('attendeeSignIn.title')}
          description={
            session ? t('attendeeSignIn.signedInAs', { email: session.email }) : t('attendeeSignIn.intro')
          }
        />
      )}
      <section
        className={orgId === null ? 'mx-auto flex w-full max-w-3xl flex-col gap-4' : 'flex flex-col gap-4'}
      >
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
                      <p className="text-caption text-ink-2">
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
                        <span className="text-caption text-ink-2">
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
            <SignOutButtons
              action={signOutAction.bind(null, orgId, false)}
              everywhere={signOutAction.bind(null, orgId, true)}
            />
          </>
        ) : (
          <Card>
            <SignInForm action={signInAction.bind(null, orgId)} />
          </Card>
        )}
        <OrderLinksForm action={orderLinksAction.bind(null, orgId)} />
      </section>
    </main>
  );
}
