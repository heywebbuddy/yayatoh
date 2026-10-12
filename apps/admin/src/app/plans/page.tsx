import { billingEnabled } from '@yayatoh/billing';
import { currencyExponent, formatMoney, money } from '@yayatoh/kernel';
import { MODULE_KEYS } from '@yayatoh/platform';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CurrencyPicker,
  PageHeader,
  Select,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { type AdminPrice, listAdminPlans } from '@/server/plans.ts';
import { requireStaff } from '@/server/staff.ts';
import { listTenants } from '@/server/tenants.ts';
import { assignPlanAction, savePlanAction } from './actions.ts';

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; done?: string; error?: string; q?: string; org?: string }>;
}) {
  const staff = await requireStaff('plans');
  const t = await getTranslations('plans');
  const sp = await searchParams;
  const [plans, tenants] = await Promise.all([listAdminPlans(staff.actor), listTenants(staff, sp.q ?? '')]);
  const selected = plans.find((p) => p.key === sp.edit && p.key !== 'launch_standard');
  const editing = sp.edit !== undefined && sp.edit !== 'launch_standard';
  const defaultPrices: AdminPrice[] = [
    { lookupKey: '', currency: 'USD', interval: 'month', unitAmountMinor: null, active: true, priceId: null },
    { lookupKey: '', currency: 'USD', interval: 'year', unitAmountMinor: null, active: true, priceId: null },
  ];
  const prices = selected ? [...selected.prices, { ...(defaultPrices[0] as AdminPrice) }] : defaultPrices;
  const label = (id: string, text: string, control: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-bold">
        {text}
      </label>
      {control}
    </div>
  );
  const errors = [
    'invalid_plan',
    'invalid_reason',
    'active_price_required',
    'provider_mismatch',
    'subscription_managed',
    'invalid_assignment',
  ];
  return (
    <Shell staff={staff}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/plans?edit=new" className={buttonClass('primary', 'sm')}>
            {t('create')}
          </Link>
        }
      />
      {!billingEnabled() ? (
        <Alert tone="info" title={t('billingOff')}>
          <p>{t('billingOffBody')}</p>
        </Alert>
      ) : null}
      {sp.done === 'saved' || sp.done === 'assigned' ? (
        <Alert tone="success" title={t(`done.${sp.done}`)} />
      ) : null}
      {sp.error ? (
        <Alert title={t(`errors.${errors.includes(sp.error) ? sp.error : 'invalid_plan'}`)} />
      ) : null}
      <Table
        caption={t('catalog')}
        rows={plans}
        rowKey={(p) => p.key}
        empty={t('empty')}
        columns={[
          {
            key: 'name',
            header: t('name'),
            cell: (p) => (
              <div>
                <strong>{p.name}</strong>
                <p className="text-caption text-ink-2">{p.key}</p>
              </div>
            ),
          },
          {
            key: 'prices',
            header: t('prices'),
            cell: (p) => (
              <div className="flex flex-col gap-1">
                {p.prices
                  .filter((x) => x.active)
                  .map((x) => (
                    <span key={x.lookupKey}>
                      {x.unitAmountMinor === null
                        ? t('quoted')
                        : formatMoney(money(x.unitAmountMinor, x.currency), 'en')}{' '}
                      / {t(x.interval)}
                    </span>
                  ))}
              </div>
            ),
          },
          { key: 'modules', header: t('modules'), cell: (p) => String(p.modules.length) },
          { key: 'organizations', header: t('organizations'), cell: (p) => String(p.organizations) },
          { key: 'subscriptions', header: t('subscriptions'), cell: (p) => String(p.subscriptions) },
          {
            key: 'status',
            header: t('status'),
            cell: (p) => (
              <StatusPill
                tone={p.active ? 'success' : 'neutral'}
                label={p.key === 'launch_standard' ? t('included') : t(p.active ? 'active' : 'draft')}
              />
            ),
          },
          {
            key: 'edit',
            header: t('edit'),
            cell: (p) =>
              p.key === 'launch_standard' ? (
                t('legacy')
              ) : (
                <Link href={`/plans?edit=${p.key}#editor`} className={buttonClass('secondary', 'sm')}>
                  {t('edit')}
                </Link>
              ),
          },
        ]}
      />
      {editing ? (
        <Card className="flex flex-col gap-4" id="editor">
          <h2 className="text-section">{selected ? t('editPlan', { name: selected.name }) : t('create')}</h2>
          <p className="text-body text-ink-2">{t('managedLocally')}</p>
          <form action={savePlanAction} className="flex flex-col gap-5">
            <input type="hidden" name="originalKey" value={selected?.key ?? ''} />
            <div className="grid gap-4 sm:grid-cols-2">
              {label(
                'plan-key',
                t('key'),
                <input
                  id="plan-key"
                  name="key"
                  className="field w-full"
                  required
                  readOnly={Boolean(selected)}
                  defaultValue={selected?.key ?? ''}
                  pattern="[a-z][a-z0-9_]{2,40}"
                />,
              )}
              {label(
                'plan-name',
                t('name'),
                <input
                  id="plan-name"
                  name="name"
                  className="field w-full"
                  required
                  maxLength={100}
                  defaultValue={selected?.name ?? ''}
                />,
              )}
              {label(
                'plan-order',
                t('sortOrder'),
                <input
                  id="plan-order"
                  name="sortOrder"
                  type="number"
                  min={0}
                  max={1000}
                  className="field w-full"
                  required
                  defaultValue={selected?.sortOrder ?? 10}
                />,
              )}
              {label(
                'plan-product',
                t('productId'),
                <input
                  id="plan-product"
                  name="productId"
                  className="field w-full"
                  maxLength={200}
                  defaultValue={selected?.productId ?? ''}
                />,
              )}
            </div>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                name="active"
                value="yes"
                className="size-5 accent-primary"
                defaultChecked={selected?.active ?? false}
              />
              {t('onSale')}
            </label>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-section">{t('modules')}</legend>
              <p className="text-caption text-ink-2">{t('moduleHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MODULE_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      name="module"
                      value={key}
                      className="size-5 shrink-0 accent-primary"
                      defaultChecked={key === 'core' || selected?.modules.includes(key)}
                    />
                    {key.replaceAll('_', ' ')}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-section">{t('prices')}</legend>
              <p className="text-caption text-ink-2">{t('priceHint')}</p>
              {prices.map((price, index) => (
                <div key={price.lookupKey || `new-${index}`} className="rounded-card border border-line p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {label(
                      `price-key-${index}`,
                      t('lookupKey'),
                      <input
                        id={`price-key-${index}`}
                        name="priceKey"
                        className="field w-full"
                        defaultValue={price.lookupKey}
                        readOnly={Boolean(price.lookupKey)}
                        pattern="[a-z0-9][a-z0-9_]{2,80}"
                      />,
                    )}
                    {label(
                      `amount-${index}`,
                      t('amount'),
                      <input
                        id={`amount-${index}`}
                        name="amount"
                        inputMode="decimal"
                        className="field w-full"
                        defaultValue={
                          price.unitAmountMinor === null
                            ? ''
                            : (price.unitAmountMinor / 10 ** currencyExponent(price.currency)).toFixed(
                                currencyExponent(price.currency),
                              )
                        }
                      />,
                    )}
                    {label(
                      `currency-${index}`,
                      t('currency'),
                      <CurrencyPicker
                        id={`currency-${index}`}
                        name="currency"
                        className="field w-full"
                        defaultValue={price.currency}
                      />,
                    )}
                    {label(
                      `interval-${index}`,
                      t('interval'),
                      <Select
                        id={`interval-${index}`}
                        name="interval"
                        className="field w-full"
                        defaultValue={price.interval}
                      >
                        <option value="month">{t('month')}</option>
                        <option value="year">{t('year')}</option>
                      </Select>,
                    )}
                    {label(
                      `provider-price-${index}`,
                      t('priceId'),
                      <input
                        id={`provider-price-${index}`}
                        name="priceId"
                        className="field w-full"
                        maxLength={200}
                        defaultValue={price.priceId ?? ''}
                      />,
                    )}
                    <label className="flex min-h-11 items-center gap-2 self-end text-body">
                      <input
                        type="checkbox"
                        name="priceActive"
                        value={index}
                        className="size-5 accent-primary"
                        defaultChecked={price.active}
                      />
                      {t('activePrice')}
                    </label>
                  </div>
                </div>
              ))}
            </fieldset>
            {label(
              'plan-reason',
              t('reason'),
              <input
                id="plan-reason"
                name="reason"
                required
                minLength={3}
                maxLength={500}
                className="field w-full"
              />,
            )}
            <div className="flex gap-3">
              <Button type="submit">{t('save')}</Button>
              <Link href="/plans" className={buttonClass('ghost')}>
                {t('cancel')}
              </Link>
            </div>
          </form>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('assign')}</h2>
        <p className="text-body text-ink-2">{t('assignHint')}</p>
        <form method="get" className="flex flex-wrap items-center gap-3">
          <input
            name="q"
            aria-label={t('searchOrganizations')}
            defaultValue={sp.q ?? ''}
            className="field"
            placeholder={t('searchOrganizations')}
          />
          <Button variant="secondary" type="submit">
            {t('search')}
          </Button>
        </form>
        <form action={assignPlanAction} className="grid gap-4 sm:grid-cols-2">
          {label(
            'assign-org',
            t('organization'),
            <Select
              id="assign-org"
              name="orgId"
              required
              className="field w-full"
              defaultValue={sp.org ?? ''}
            >
              <option value="">{t('chooseOrganization')}</option>
              {tenants.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.slug})
                </option>
              ))}
            </Select>,
          )}
          {label(
            'assign-plan',
            t('plan'),
            <Select id="assign-plan" name="planKey" required className="field w-full" defaultValue="">
              <option value="">{t('choosePlan')}</option>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>,
          )}
          {label(
            'assign-reason',
            t('reason'),
            <input
              id="assign-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className="field w-full"
            />,
          )}
          <Button type="submit" className="self-end justify-self-start">
            {t('assign')}
          </Button>
        </form>
        {sp.org ? (
          <Link href={`/tenants/${encodeURIComponent(sp.org)}`} className={buttonClass('secondary', 'sm')}>
            {t('viewOrganization')}
          </Link>
        ) : null}
      </Card>
    </Shell>
  );
}
