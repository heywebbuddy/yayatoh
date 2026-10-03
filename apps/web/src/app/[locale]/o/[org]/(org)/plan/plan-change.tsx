import type { BillingStandingDto, PlanChangeOptions, PlanChangePreview } from '@yayatoh/billing';
import { formatMoney, money, uuidv7 } from '@yayatoh/kernel';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  Checkbox,
  Radio,
  SectionHeader,
  StatusPill,
  Tag,
} from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { confirmPlanChange, payNow } from './actions.ts';

/*
 * M6.6b plan changes and dunning, composed from @yayatoh/ui primitives (no new shared components
 * while design v2 lands): the payment-failed / read-only notice with "Pay now", the plan picker,
 * and the proration preview the organizer confirms.
 */

type Names = { plan: (key: string, fallback: string) => string; module: (key: string) => string };

/** The org's billing standing: grace (writes still work) or read-only, with the way out. */
export async function StandingNotice({
  standing,
  canManage,
  org,
  locale,
  timeZone,
}: {
  standing: BillingStandingDto;
  canManage: boolean;
  org: string;
  locale: string;
  timeZone: string;
}) {
  if (standing.standing === 'good') return null;
  const t = await getTranslations('billingPlan.dunning');
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone });
  const date = standing.readOnlyFrom ? day.format(standing.readOnlyFrom) : '';
  const grace = standing.standing === 'grace';
  return (
    <div data-testid="billing-standing" data-standing={standing.standing}>
      <Alert tone={grace ? 'warning' : 'danger'} title={t(grace ? 'graceTitle' : 'readOnlyTitle')}>
        <div className="flex flex-col gap-3">
          <p className="m-0">{grace ? t('graceBody', { date }) : t('readOnlyBody')}</p>
          {canManage ? (
            <form action={payNow.bind(null, org, locale)}>
              <input type="hidden" name="idempotencyKey" value={uuidv7()} />
              <Button type="submit">{t('payNow')}</Button>
            </form>
          ) : (
            <p className="m-0 text-ink-2">{t('askOwner')}</p>
          )}
        </div>
      </Alert>
    </div>
  );
}

const DIRECTION_TONE = {
  upgrade: 'success',
  downgrade: 'waiting',
  switch: 'neutral',
  start: 'info',
} as const;

/** Pick a plan to preview (a GET form: the preview is a page of its own, nothing changes yet). */
export async function ChangePlanPicker({
  options,
  names,
  locale,
  error,
}: {
  options: PlanChangeOptions;
  names: Names;
  locale: string;
  error: boolean;
}) {
  const t = await getTranslations('billingPlan.change');
  const offers = options.offers.filter((o) => !o.current);
  return (
    <section aria-labelledby="change-heading" className="flex flex-col gap-3" data-testid="change-plan">
      <SectionHeader id="change-heading" title={t('title')} description={t('description')} />
      {options.discountPercent ? (
        <p className="m-0 text-body text-ink-2" data-testid="discount">
          {t(options.discountSource === 'verified_charity' ? 'discountCharity' : 'discountStaff', {
            percent: options.discountPercent,
          })}
        </p>
      ) : null}
      <Card className="flex flex-col gap-4">
        <form method="get" className="flex flex-col gap-4" noValidate>
          <fieldset
            className="m-0 flex flex-col gap-1 border-0 p-0"
            aria-describedby={error ? 'change-error' : undefined}
          >
            <legend className="mb-2 text-label uppercase text-ink-2">{t('legend')}</legend>
            {offers.map((o) => (
              <Radio
                key={o.lookupKey}
                name="change"
                value={o.lookupKey}
                label={t('offer', {
                  plan: names.plan(o.planKey, o.planName),
                  price: formatMoney(money(o.unitAmountMinor, o.currency), locale),
                  interval: o.interval,
                })}
                hint={
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={DIRECTION_TONE[o.direction]} label={t(`direction.${o.direction}`)} />
                    {o.removedModules.length > 0 ? (
                      <span>{t('turnsOff', { count: o.removedModules.length })}</span>
                    ) : null}
                  </span>
                }
              />
            ))}
          </fieldset>
          {error ? (
            <p id="change-error" role="alert" className="m-0 text-body text-danger">
              {t('chooseError')}
            </p>
          ) : null}
          <input type="hidden" name="at" value={String(Date.now())} />
          <input type="hidden" name="picked" value="1" />
          <Button type="submit" className="self-start">
            {t('preview')}
          </Button>
        </form>
      </Card>
    </section>
  );
}

/** The provider's proration preview and the confirmation (one primary action: confirm). */
export async function ChangePreview({
  preview,
  names,
  org,
  locale,
  timeZone,
  at,
  confirmError,
}: {
  preview: PlanChangePreview;
  names: Names;
  org: string;
  locale: string;
  timeZone: string;
  at: number;
  confirmError: boolean;
}) {
  const t = await getTranslations('billingPlan.change');
  const m = (minor: number) => formatMoney(money(minor, preview.currency), locale);
  const o = preview.offer;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone });
  const rows: [string, string, string][] = [
    ['charge', t('rows.charge'), m(preview.chargeMinor)],
    ['credit', t('rows.credit'), preview.creditMinor ? `−${m(preview.creditMinor)}` : m(0)],
    ['discount', t('rows.discount'), preview.discountMinor ? `−${m(preview.discountMinor)}` : m(0)],
    ['tax', t('rows.tax'), m(preview.taxMinor)],
  ];
  return (
    <section aria-labelledby="preview-heading" className="flex flex-col gap-3" data-testid="change-preview">
      <Card className="flex flex-col gap-4">
        <CardHeader
          id="preview-heading"
          title={t('previewTitle', { plan: names.plan(o.planKey, o.planName) })}
        />
        <p className="m-0 text-body text-ink-2">{t(`previewLead.${o.direction}`)}</p>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-body">
          {rows.map(([key, label, value]) => (
            <div key={key} className="contents" data-row={key}>
              <dt className="text-ink-2">{label}</dt>
              <dd className="m-0 text-end tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="contents" data-row="due">
            <dt className="font-bold">{t('rows.due')}</dt>
            <dd className="m-0 text-end font-bold tabular-nums" data-testid="amount-due">
              {m(preview.amountDueMinor)}
            </dd>
          </div>
        </dl>
        {preview.creditBalanceMinor > 0 ? (
          <p className="m-0 text-body text-ink-2">
            {t('creditKept', { amount: m(preview.creditBalanceMinor) })}
          </p>
        ) : null}
        <p className="m-0 text-body text-ink-2" data-testid="next-renewal">
          {preview.nextRenewalAt
            ? t('nextRenewal', {
                amount: m(preview.nextRenewalMinor),
                date: day.format(preview.nextRenewalAt),
              })
            : t('nextRenewalNoDate', { amount: m(preview.nextRenewalMinor) })}
        </p>
        <p className="m-0 text-caption text-ink-2">{t('taxNote')}</p>
        <form action={confirmPlanChange.bind(null, org, locale)} className="flex flex-col gap-4">
          <input type="hidden" name="priceLookupKey" value={o.lookupKey} />
          <input type="hidden" name="at" value={String(at)} />
          <input type="hidden" name="idempotencyKey" value={uuidv7()} />
          {o.removedModules.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="removed-modules">
              <Alert tone="warning" title={t('removedTitle', { count: o.removedModules.length })}>
                <p className="m-0">{t('removedBody')}</p>
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                  {o.removedModules.map((k) => (
                    <li key={k} data-module={k}>
                      <Tag>{names.module(k)}</Tag>
                    </li>
                  ))}
                </ul>
              </Alert>
              <Checkbox
                name="confirmRemoved"
                id="confirmRemoved"
                required
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={confirmError ? 'confirm-error' : undefined}
                label={t('confirmRemoved', { count: o.removedModules.length })}
              />
              {confirmError ? (
                <p id="confirm-error" role="alert" className="m-0 text-body text-danger">
                  {t('confirmError')}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">{t('confirm')}</Button>
            <a href={`/${locale}/o/${org}/plan`} className={buttonClass('ghost', 'md')}>
              {t('cancel')}
            </a>
          </div>
        </form>
      </Card>
    </section>
  );
}
