import { feeScheduleQuery, getEntitlementsQuery } from '@yayatoh/billing';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { payoutAccountQuery } from '@yayatoh/payments';
import { MODULE_KEYS } from '@yayatoh/platform';
import {
  getOrganizationQuery,
  listDomainsQuery,
  listMembersQuery,
  type OrganizationDto,
  SUSPENSION_KINDS,
  suspensionHistoryQuery,
} from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Shell } from '@/components/shell.tsx';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';
import { entitlementAction, feeOverrideAction, payoutHoldAction, suspensionAction } from './actions.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

function Reason({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex min-w-60 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-zinc-600">
        {label}
      </label>
      <input id={id} name="reason" required minLength={3} maxLength={500} className={field} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-section">
        {title}
      </h2>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}

export default async function TenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = await getTranslations('tenant');
  const ctx = staff.ctx(id);
  let org: OrganizationDto;
  try {
    org = await executeQuery(getOrganizationQuery, {}, ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const [members, pauses, payout, entitlements, fee, domains] = await Promise.all([
    executeQuery(listMembersQuery, {}, ctx, ports),
    executeQuery(suspensionHistoryQuery, {}, ctx, ports),
    executeQuery(payoutAccountQuery, {}, ctx, ports),
    executeQuery(getEntitlementsQuery, {}, ctx, ports),
    executeQuery(feeScheduleQuery, { currency: org.currency }, ctx, ports),
    executeQuery(listDomainsQuery, {}, ctx, ports),
  ]);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const active = new Set(pauses.filter((p) => !p.liftedAt).map((p) => p.kind));
  return (
    <Shell staff={staff}>
      <PageHeader eyebrow={<span className="font-mono text-caption">{org.slug}</span>} title={org.name} />
      <div aria-live="polite">
        {done ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
        {error ? <Alert title={t('error', { code: error })} /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body md:grid-cols-4">
        {(
          [
            ['status', org.status],
            ['kind', org.kind],
            ['country', org.country],
            ['currency', org.currency],
            ['timezone', org.timezone],
            ['members', String(members.length)],
            ['profile', org.defaultProfile],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-caption text-zinc-500">{t(`field.${k}`)}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>

      <Section id="switches" title={t('switches.title')}>
        <p className="text-caption text-zinc-600">{t('switches.description')}</p>
        {SUSPENSION_KINDS.map((kind) => {
          const on = active.has(kind);
          return (
            <form
              key={kind}
              action={suspensionAction.bind(null, id, kind, !on)}
              className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4 first-of-type:border-0 first-of-type:pt-0"
            >
              <div className="flex min-w-48 flex-col gap-1">
                <span className="text-body">{t(`switches.kind.${kind}`)}</span>
                <StatusDot
                  status={on ? 'danger' : 'success'}
                  label={on ? t('switches.on') : t('switches.off')}
                />
              </div>
              {staff.can('suspend') ? (
                <>
                  <Reason id={`reason-${kind}`} label={t('reason')} />
                  <Button type="submit" variant={on ? 'secondary' : 'primary'}>
                    {on
                      ? t('switches.resume', { what: t(`switches.kind.${kind}`) })
                      : t('switches.pause', { what: t(`switches.kind.${kind}`) })}
                  </Button>
                </>
              ) : null}
            </form>
          );
        })}
        {pauses.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-caption text-zinc-600">{t('switches.history')}</summary>
            <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-caption">
              {pauses.map((p) => (
                <li key={`${p.kind}-${p.since.toISOString()}`}>
                  {t(`switches.kind.${p.kind}`)} · {when.format(p.since)} · {p.createdBy} · “{p.reason}”
                  {p.liftedAt ? ` → ${when.format(p.liftedAt)} (${p.liftedBy})` : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section id="payouts" title={t('payouts.title')}>
        <StatusDot
          status={
            payout.state === 'active' ? 'success' : payout.state === 'restricted' ? 'warning' : 'neutral'
          }
          label={t(`payouts.state.${payout.state}`)}
        />
        <p className="text-caption text-zinc-600">
          {t(`payouts.flow.${payout.fundsFlow}`)}
          {payout.requirementsDue.length
            ? ` · ${t('payouts.due', { keys: payout.requirementsDue.join(', ') })}`
            : ''}
        </p>
        {payout.state !== 'none' ? (
          <form
            action={payoutHoldAction.bind(null, id, !payout.onHold)}
            className="flex flex-wrap items-end gap-3"
          >
            <StatusDot
              status={payout.onHold ? 'danger' : 'success'}
              label={payout.onHold ? t('payouts.held') : t('payouts.notHeld')}
            />
            {staff.can('payouts') ? (
              <>
                <Reason id="reason-hold" label={t('reason')} />
                <Button type="submit" variant={payout.onHold ? 'secondary' : 'primary'}>
                  {payout.onHold ? t('payouts.release') : t('payouts.hold')}
                </Button>
              </>
            ) : null}
          </form>
        ) : null}
      </Section>

      <Section id="fees" title={t('fees.title')}>
        <p className="text-body">
          {t('fees.current', {
            currency: org.currency,
            percent: (fee.percentBps / 100).toFixed(2),
            fixed: fee.fixedMinor,
          })}{' '}
          <span className="text-caption text-zinc-500">
            {fee.override ? t('fees.override') : t('fees.plan')}
          </span>
        </p>
        {staff.can('fees') ? (
          <form action={feeOverrideAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fee-currency" className="text-caption text-zinc-600">
                {t('fees.currency')}
              </label>
              <input
                id="fee-currency"
                name="currency"
                required
                pattern="[A-Za-z]{3}"
                defaultValue={org.currency}
                className={`${field} w-24`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fee-bps" className="text-caption text-zinc-600">
                {t('fees.bps')}
              </label>
              <input
                id="fee-bps"
                name="percentBps"
                type="number"
                min={0}
                max={5000}
                required
                defaultValue={fee.percentBps}
                className={`${field} w-32`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fee-fixed" className="text-caption text-zinc-600">
                {t('fees.fixed')}
              </label>
              <input
                id="fee-fixed"
                name="fixedMinor"
                type="number"
                min={0}
                required
                defaultValue={fee.fixedMinor}
                className={`${field} w-32`}
              />
            </div>
            <Reason id="reason-fee" label={t('reason')} />
            <Button type="submit">{t('fees.save')}</Button>
          </form>
        ) : null}
      </Section>

      <Section id="entitlements" title={t('entitlements.title')}>
        <p className="text-body">
          {t('entitlements.current')}{' '}
          <span className="font-mono text-caption">{entitlements.modules.join(', ')}</span>
        </p>
        {staff.can('entitlements') ? (
          <form action={entitlementAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ent-module" className="text-caption text-zinc-600">
                {t('entitlements.module')}
              </label>
              <select id="ent-module" name="moduleKey" className={field}>
                {MODULE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ent-effect" className="text-caption text-zinc-600">
                {t('entitlements.effect')}
              </label>
              <select id="ent-effect" name="effect" className={field}>
                <option value="grant">{t('entitlements.grant')}</option>
                <option value="revoke">{t('entitlements.revoke')}</option>
              </select>
            </div>
            <Reason id="reason-ent" label={t('reason')} />
            <Button type="submit">{t('entitlements.save')}</Button>
          </form>
        ) : null}
      </Section>

      <Section id="domains" title={t('domains.title')}>
        <ul className="flex list-none flex-col gap-1 p-0 text-body">
          {domains.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3">
              <span className="font-mono">{d.hostname}</span>
              <span className="text-caption text-zinc-600">
                {d.status}
                {d.isPrimary ? ` · ${t('domains.primary')}` : ''}
                {d.walletsReady ? ` · ${t('domains.wallets')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </Shell>
  );
}
