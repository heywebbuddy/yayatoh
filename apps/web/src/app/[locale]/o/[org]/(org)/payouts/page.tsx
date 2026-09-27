import { executeQuery } from '@yayatoh/kernel';
import { payoutAccountQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { startPayoutOnboarding } from './actions.ts';

const DOT = { none: 'neutral', pending: 'info', restricted: 'warning', active: 'success' } as const;

/**
 * Payouts (M1.3c): connect the organization's payout account with the payment provider. Until
 * the account is fully enabled, orders are charged by the platform and paid out after the event
 * (platform_mor); once active, buyers pay the organizer directly (organizer_mor).
 */
export default async function PayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { locale, org } = await params;
  const { onboarding } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('payouts');
  const account = await executeQuery(payoutAccountQuery, {}, data.ctx, ports);
  const canManage = roleCan(data.role, 'payouts:manage');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {onboarding === 'returned' && account.state !== 'active' ? (
        <p role="status" className="rounded-card border border-zinc-200 bg-zinc-50 px-4 py-3 text-body">
          {t('returned')}
        </p>
      ) : null}
      {account.onHold ? (
        <p
          role="status"
          className="rounded-card border border-accent-700 bg-accent-50 px-4 py-3 text-body text-accent-text"
        >
          {t('onHold')}
        </p>
      ) : null}
      <Card className="flex flex-col gap-4">
        <StatusDot status={DOT[account.state]} label={t(`state.${account.state}`)} />
        <p className="text-body text-zinc-600">{t(`explain.${account.state}`)}</p>
        {account.state === 'restricted' && account.requirementsDue.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-zinc-600">{t('requirements')}</p>
            <ul className="flex list-none flex-col gap-1 p-0">
              {account.requirementsDue.map((r) => (
                <li key={r} className="font-mono text-caption">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-caption text-zinc-500">{t(`flow.${account.fundsFlow}`)}</p>
        {canManage && account.state !== 'active' ? (
          <form action={startPayoutOnboarding.bind(null, org, locale)}>
            <Button type="submit">{account.state === 'none' ? t('start') : t('continue')}</Button>
          </form>
        ) : !canManage ? (
          <p className="text-caption text-zinc-600">{t('noAccess')}</p>
        ) : null}
      </Card>
    </>
  );
}
