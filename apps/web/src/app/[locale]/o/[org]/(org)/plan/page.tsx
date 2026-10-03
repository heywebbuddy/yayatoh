import { type PlanSummary, planSummaryQuery } from '@yayatoh/billing';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  CardLabel,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusPill,
  Table,
  Tag,
} from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { testBillingSecret } from '@/server/billing.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { openTestBillingPortal } from './actions.ts';

type Price = NonNullable<PlanSummary['subscription']>['price'];

const STATUS_TONE = {
  active: 'success',
  trialing: 'info',
  past_due: 'waiting',
  unpaid: 'danger',
  paused: 'neutral',
  canceled: 'neutral',
  incomplete: 'waiting',
  incomplete_expired: 'neutral',
} as const;

/**
 * Plan and modules (M6.6a; read-only while subscription billing is dormant): the org's current
 * plan and where it comes from, its subscription, whether its legacy per-ticket fees are kept, the
 * modules it can use and the (placeholder) plan catalog. Owners, admins and finance. In
 * development a test billing portal simulates plan changes through the fake provider's webhooks.
 */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ billing?: string }>;
}) {
  const { locale, org } = await params;
  const { billing } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('billingPlan');
  if (!roleCan(data.role, 'billing:read')) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {t('findOwner')}
            </Link>
          }
        />
      </>
    );
  }
  const s = await executeQuery(planSummaryQuery, {}, data.ctx, ports);
  const planName = (key: string, fallback: string) =>
    t.has(`planName.${key}`) ? t(`planName.${key}`) : fallback;
  const moduleName = (key: string) => (t.has(`module.${key}`) ? t(`module.${key}`) : key);
  const priceText = (p: Price) =>
    !p
      ? '—'
      : p.unitAmountMinor === null
        ? t('priceQuote')
        : t(p.interval === 'month' ? 'pricePerMonth' : 'pricePerYear', {
            price: formatMoney(money(p.unitAmountMinor, p.currency), locale),
          });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: data.org.timezone });
  const canTest = Boolean(testBillingSecret()) && roleCan(data.role, 'org:update');
  const sub = s.subscription;
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {billing === 'updated' ? (
        <Alert tone="success" title={t('updatedTitle')}>
          {t('updatedBody')}
        </Alert>
      ) : null}
      {!s.billingEnabled ? (
        <Alert tone="info" title={t('dormantTitle')}>
          {t('dormantBody')}
        </Alert>
      ) : !s.active ? (
        <Alert tone="info" title={t('inactiveTitle')}>
          {t('inactiveBody')}
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3" data-testid="current-plan">
          <CardLabel>{t('currentPlan')}</CardLabel>
          <p className="text-section font-extrabold" data-testid="plan-name">
            {planName(s.plan.key, s.plan.name)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{t(`source.${s.plan.source}`)}</Tag>
            {sub ? <StatusPill tone={STATUS_TONE[sub.status]} label={t(`status.${sub.status}`)} /> : null}
          </div>
          {sub?.live && sub.price ? <p className="text-body text-ink-2">{priceText(sub.price)}</p> : null}
          {sub?.live && sub.currentPeriodEnd ? (
            <p className="text-caption text-ink-2">
              {t(sub.cancelAtPeriodEnd ? 'endsOn' : 'renews', { date: day.format(sub.currentPeriodEnd) })}
            </p>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-3" data-testid="fees">
          <CardLabel>{t('fees.title')}</CardLabel>
          <p className="text-body">
            {s.legacyFees.grandfathered
              ? t('fees.grandfathered')
              : t('fees.plan', { plan: planName(s.feePlan.key, s.feePlan.name) })}
          </p>
        </Card>
      </div>
      <section aria-labelledby="modules-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="modules-heading"
          title={t('modules.title')}
          description={t('modules.description')}
          count={t('modules.count', { count: s.modules.length })}
        />
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="module-list">
          {s.modules.map((m) => (
            <li key={m} data-module={m}>
              <Tag>{moduleName(m)}</Tag>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="catalog-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="catalog-heading"
          title={t('catalog.title')}
          description={t('catalog.description')}
        />
        <Table
          caption={t('catalog.title')}
          rowKey={(p) => p.key}
          rows={s.catalog}
          empty={t('catalog.empty')}
          columns={[
            { key: 'plan', header: t('catalog.plan'), cell: (p) => planName(p.key, p.name) },
            {
              key: 'price',
              header: t('catalog.price'),
              cell: (p) => priceText(p.prices.find((x) => x.interval === 'month') ?? p.prices[0] ?? null),
            },
            {
              key: 'modules',
              header: t('catalog.modules'),
              cell: (p) => t('modules.count', { count: p.modules.length }),
            },
            {
              key: 'status',
              header: t('catalog.status'),
              cell: (p) => (
                <StatusPill
                  tone={p.active ? 'success' : 'neutral'}
                  label={t(p.active ? 'catalog.onSale' : 'catalog.notOnSale')}
                />
              ),
            },
          ]}
        />
      </section>
      {canTest ? (
        <Card className="flex flex-col gap-3" data-testid="test-billing">
          <CardHeader title={t('test.title')} />
          <p className="text-body text-ink-2">{t('test.body')}</p>
          <form action={openTestBillingPortal.bind(null, org, locale)}>
            <Button type="submit">{t('test.open')}</Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
