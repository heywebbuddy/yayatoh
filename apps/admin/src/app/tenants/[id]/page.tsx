import { getUsersByIds, isImpersonationActive, listImpersonations } from '@yayatoh/auth';
import { feeScheduleQuery, getEntitlementsQuery } from '@yayatoh/billing';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  disputesQuery,
  ledgerBalancesQuery,
  payoutAccountQuery,
  reconciliationItemsQuery,
} from '@yayatoh/payments';
import { MODULE_KEYS } from '@yayatoh/platform';
import {
  getOrganizationQuery,
  listDomainsQuery,
  listMembersQuery,
  type OrganizationDto,
  orgStatusActions,
  orgStatusHistoryQuery,
  restoredOrgStatus,
  SUSPENSION_KINDS,
  suspensionHistoryQuery,
} from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Shell } from '@/components/shell.tsx';
import { getTwoFactor } from '@/server/auth.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';
import {
  endImpersonationAction,
  entitlementAction,
  feeOverrideAction,
  orgStatusAction,
  payoutHoldAction,
  resolveReconciliationAction,
  restoreOrgAction,
  startImpersonationAction,
  submitEvidenceAction,
  suspensionAction,
} from './actions.ts';

/** Refusals of a status change with their own message (others use the generic one). */
const STATUS_ERRORS = new Set([
  'status_reason',
  'status_confirm',
  'status_slug',
  'restore_step_up',
  'restore_rate_limited',
  'restore_method',
]);

const STATUS_DOT = {
  active: 'success',
  limited: 'warning',
  suspended: 'danger',
  terminated: 'neutral',
} as const;

/** Refusals of "Act as a member" with their own message (others use the generic one). */
const IMPERSONATE_ERRORS = new Set([
  'reason_required',
  'member_required',
  'self',
  'staff_target',
  'not_found',
]);

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
  const [members, pauses, payout, entitlements, fee, domains, ledger, disputes, recon, statusHistory] =
    await Promise.all([
      executeQuery(listMembersQuery, {}, ctx, ports),
      executeQuery(suspensionHistoryQuery, {}, ctx, ports),
      executeQuery(payoutAccountQuery, {}, ctx, ports),
      executeQuery(getEntitlementsQuery, {}, ctx, ports),
      executeQuery(feeScheduleQuery, { currency: org.currency }, ctx, ports),
      executeQuery(listDomainsQuery, {}, ctx, ports),
      executeQuery(ledgerBalancesQuery, {}, ctx, ports),
      executeQuery(disputesQuery, {}, ctx, ports),
      executeQuery(reconciliationItemsQuery, { status: 'open' }, ctx, ports),
      executeQuery(orgStatusHistoryQuery, {}, ctx, ports),
    ]);
  // Status changes name the staff member (`system:staff:<id>`): show their name.
  const staffIdOf = (actor: string) => /staff:([0-9a-f-]{36})$/.exec(actor)?.[1] ?? null;
  const [people, impersonations, changers] = await Promise.all([
    getUsersByIds(members.map((m) => m.userId)),
    listImpersonations(id),
    getUsersByIds(statusHistory.map((h) => staffIdOf(h.changedBy)).filter((x): x is string => x !== null)),
  ]);
  const changerName = (actor: string) => changers.get(staffIdOf(actor) ?? '')?.name ?? actor;
  // A terminated org can be restored to the status its termination recorded (newest first).
  const termination = statusHistory.find((h) => h.to === 'terminated');
  const restoreTo = restoredOrgStatus(org.status, termination ? { fromStatus: termination.from } : null);
  const stepUpMethod =
    org.status === 'terminated' && staff.can('status') ? await getTwoFactor().method(staff.userId) : null;
  const now = new Date();
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const active = new Set(pauses.filter((p) => !p.liftedAt).map((p) => p.kind));
  return (
    <Shell staff={staff}>
      <PageHeader eyebrow={<span className="font-mono text-caption">{org.slug}</span>} title={org.name} />
      <p>
        <Link href={`/tenants/${id}/messaging`} className="text-body underline underline-offset-2">
          {t('messagingLink')}
        </Link>
      </p>
      <div aria-live="polite">
        {done ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
        {error ? (
          <Alert
            title={
              IMPERSONATE_ERRORS.has(error)
                ? t(`impersonate.errors.${error}`)
                : STATUS_ERRORS.has(error)
                  ? t(`status.errors.${error}`)
                  : t('error', { code: error })
            }
          />
        ) : null}
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

      <Section id="status" title={t('status.title')}>
        <StatusDot
          status={STATUS_DOT[org.status]}
          label={t('status.current', { status: t(`status.value.${org.status}`) })}
        />
        <p className="text-caption text-zinc-600">{t(`status.explain.${org.status}`)}</p>
        {staff.can('status') ? (
          orgStatusActions(org.status).map((action) => (
            <form
              key={action}
              aria-label={t(`status.form.${action}`)}
              action={orgStatusAction.bind(null, id, action)}
              className="flex flex-col gap-3 border-t border-zinc-100 pt-4"
            >
              <h3 className="text-body font-medium">{t(`status.form.${action}`)}</h3>
              <p className="text-caption text-zinc-600">{t(`status.effect.${action}`)}</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`status-${action}-reason`} className="text-caption text-zinc-600">
                  {t('reason')}
                </label>
                <textarea
                  id={`status-${action}-reason`}
                  name="reason"
                  required
                  maxLength={500}
                  rows={2}
                  className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
                />
              </div>
              {action === 'terminate' ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="status-terminate-slug" className="text-caption text-zinc-600">
                    {t('status.typeSlug', { slug: org.slug })}
                  </label>
                  <input
                    id="status-terminate-slug"
                    name="confirmSlug"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${field} max-w-sm font-mono`}
                  />
                </div>
              ) : (
                <label className="flex min-h-6 items-center gap-2 text-body">
                  <input type="checkbox" name="confirm" value="yes" className="size-5" />
                  {t(`status.confirm.${action}`)}
                </label>
              )}
              <Button
                type="submit"
                variant={action === 'reactivate' ? 'primary' : 'secondary'}
                className="self-start"
              >
                {t(`status.submit.${action}`)}
              </Button>
            </form>
          ))
        ) : (
          <p className="text-caption text-zinc-600">{t('status.adminsOnly')}</p>
        )}
        {org.status === 'terminated' ? (
          <p className="text-caption text-zinc-600">{t('status.final')}</p>
        ) : null}
        <h3 className="text-body font-medium">{t('status.history')}</h3>
        {statusHistory.length === 0 ? (
          <p className="text-caption text-zinc-600">{t('status.empty')}</p>
        ) : (
          <ul aria-label={t('status.history')} className="flex list-none flex-col gap-1 p-0 text-caption">
            {statusHistory.map((h) => (
              <li key={`${h.at.toISOString()}-${h.action}`}>
                {t('status.entry', {
                  when: when.format(h.at),
                  action: t(`status.did.${h.action}`),
                  who: changerName(h.changedBy),
                  reason: h.reason,
                })}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {org.status === 'terminated' ? (
        <Section id="restore" title={t('restore.title')}>
          {!staff.can('status') ? (
            <p className="text-caption text-zinc-600">{t('restore.adminsOnly')}</p>
          ) : !restoreTo ? (
            <p className="text-caption text-zinc-600">{t('restore.noRecord')}</p>
          ) : (
            <form
              aria-label={t('restore.form')}
              action={restoreOrgAction.bind(null, id)}
              className="flex flex-col gap-3"
            >
              <p className="text-caption text-zinc-600">{t('restore.description')}</p>
              <p className="text-caption text-zinc-600">
                {t('restore.effect', { status: t(`status.value.${restoreTo}`) })}
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="restore-reason" className="text-caption text-zinc-600">
                  {t('reason')}
                </label>
                <textarea
                  id="restore-reason"
                  name="reason"
                  required
                  maxLength={500}
                  rows={2}
                  className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="restore-slug" className="text-caption text-zinc-600">
                  {t('status.typeSlug', { slug: org.slug })}
                </label>
                <input
                  id="restore-slug"
                  name="confirmSlug"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${field} max-w-sm font-mono`}
                />
              </div>
              {stepUpMethod === 'email' ? (
                <p className="text-caption text-zinc-600">{t('status.errors.restore_method')}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="restore-proof" className="text-caption text-zinc-600">
                    {stepUpMethod === 'totp' ? t('restore.code') : t('restore.password')}
                  </label>
                  {stepUpMethod === 'totp' ? (
                    <input
                      id="restore-proof"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className={`${field} max-w-xs`}
                    />
                  ) : (
                    <input
                      id="restore-proof"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      className={`${field} max-w-xs`}
                    />
                  )}
                </div>
              )}
              <Button type="submit" variant="primary" className="self-start">
                {t('restore.submit')}
              </Button>
            </form>
          )}
        </Section>
      ) : null}

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

      <Section id="disputes" title={t('disputes.title')}>
        {disputes.length === 0 ? (
          <p className="text-body text-zinc-600">{t('disputes.empty')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {disputes.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
                  <StatusDot
                    status={d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}
                    label={t(`disputes.status.${d.status}`)}
                  />
                  <span className="font-mono">
                    {d.currency} {d.amountMinor}
                  </span>
                  <span className="text-caption text-zinc-600">{d.reason}</span>
                  <span className="text-caption text-zinc-600">{d.fundsFlow}</span>
                  {d.evidenceDueBy ? (
                    <span className="text-caption text-zinc-600">
                      {t('disputes.due', { date: when.format(d.evidenceDueBy) })}
                    </span>
                  ) : null}
                  <a href={`/tenants/${id}/disputes/${d.id}/evidence`} className="text-caption underline">
                    {t('disputes.packet')}
                  </a>
                </div>
                {d.status === 'open' && d.fundsFlow === 'platform_mor' && staff.can('payouts') ? (
                  <form
                    action={submitEvidenceAction.bind(null, id, d.id, d.providerDisputeId)}
                    className="flex flex-col gap-2"
                  >
                    <label htmlFor={`summary-${d.id}`} className="text-caption text-zinc-600">
                      {t('disputes.summary')}
                    </label>
                    <textarea
                      id={`summary-${d.id}`}
                      name="summary"
                      defaultValue={d.evidenceSummary ?? ''}
                      required
                      minLength={20}
                      maxLength={5000}
                      rows={3}
                      className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
                    />
                    <label className="flex min-h-6 items-center gap-2 text-body">
                      <input type="checkbox" name="reviewed" value="yes" required className="size-5" />
                      {t('disputes.reviewed')}
                    </label>
                    <Button type="submit" className="self-start">
                      {t('disputes.submit')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="reconciliation" title={t('reconciliation.title')}>
        <p className="text-caption text-zinc-600">{t('reconciliation.description')}</p>
        {recon.length === 0 ? (
          <p className="text-body text-zinc-600">{t('reconciliation.empty')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {recon.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 border-t border-zinc-100 pt-4 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <StatusDot status="warning" label={t(`reconciliation.kind.${r.kind}`)} />
                  <span className="text-caption text-zinc-600">{r.day}</span>
                  <span className="break-all font-mono text-caption">{r.reference}</span>
                  <span className="font-mono tabular-nums">
                    {t('reconciliation.amounts', {
                      ledger: `${r.currency} ${r.ledgerMinor}`,
                      provider: `${r.currency} ${r.providerMinor}`,
                    })}
                  </span>
                </div>
                {staff.can('payouts') ? (
                  <form
                    action={resolveReconciliationAction.bind(null, id, r.id)}
                    className="flex flex-wrap items-end gap-3"
                  >
                    <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                      <label htmlFor={`recon-${r.id}`} className="text-caption text-zinc-600">
                        {t('reconciliation.note')}
                      </label>
                      <input
                        id={`recon-${r.id}`}
                        name="note"
                        required
                        minLength={3}
                        maxLength={500}
                        className={field}
                      />
                    </div>
                    <Button type="submit" variant="secondary">
                      {t('reconciliation.resolve')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="ledger" title={t('ledger.title')}>
        {ledger.length === 0 ? (
          <p className="text-body text-zinc-600">{t('ledger.empty')}</p>
        ) : (
          <table className="w-full text-start text-body">
            <caption className="sr-only">{t('ledger.title')}</caption>
            <thead className="text-caption text-zinc-500">
              <tr>
                <th scope="col" className="py-1 pe-4 text-start font-normal">
                  {t('ledger.account')}
                </th>
                <th scope="col" className="py-1 text-end font-normal">
                  {t('ledger.balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={`${l.account}:${l.currency}`} className="border-t border-zinc-100">
                  <td className="py-1.5 pe-4 font-mono text-caption">{l.account}</td>
                  <td className="py-1.5 text-end font-mono tabular-nums">
                    {l.currency} {l.balanceMinor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-caption text-zinc-500">{t('ledger.note')}</p>
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

      <Section id="impersonate" title={t('impersonate.title')}>
        <p className="text-caption text-zinc-600">{t('impersonate.description')}</p>
        {staff.can('impersonate') ? (
          <form action={startImpersonationAction.bind(null, id)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="imp-member" className="text-caption text-zinc-600">
                {t('impersonate.member')}
              </label>
              <select id="imp-member" name="userId" required defaultValue="" className={field}>
                <option value="" disabled>
                  {t('impersonate.choose')}
                </option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {t('impersonate.option', {
                      name: people.get(m.userId)?.name ?? m.userId,
                      email: people.get(m.userId)?.email ?? '',
                      role: m.role,
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="imp-reason" className="text-caption text-zinc-600">
                {t('impersonate.reason')}
              </label>
              <textarea
                id="imp-reason"
                name="reason"
                required
                maxLength={500}
                rows={2}
                aria-describedby="imp-reason-hint"
                className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
              />
              <p id="imp-reason-hint" className="text-caption text-zinc-500">
                {t('impersonate.reasonHint')}
              </p>
            </div>
            <Button type="submit" className="self-start">
              {t('impersonate.start')}
            </Button>
          </form>
        ) : (
          <p className="text-caption text-zinc-600">{t('impersonate.adminsOnly')}</p>
        )}
        <h3 className="text-body font-medium">{t('impersonate.history')}</h3>
        {impersonations.length === 0 ? (
          <p className="text-caption text-zinc-600">{t('impersonate.empty')}</p>
        ) : (
          <ul
            aria-label={t('impersonate.history')}
            className="flex list-none flex-col divide-y divide-zinc-100 p-0"
          >
            {impersonations.map((i) => {
              const open = isImpersonationActive(i, now);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-body">
                  <span className="min-w-0 flex-1">
                    {t('impersonate.entry', { staff: i.staffName, member: i.memberName, reason: i.reason })}
                  </span>
                  <span className="text-caption text-zinc-600">
                    {when.format(i.startedAt)} ·{' '}
                    {open
                      ? t('impersonate.until', { at: when.format(i.expiresAt) })
                      : i.endedAt
                        ? t(`impersonate.endedHow.${i.endedReason === 'expired' ? 'expired' : 'ended'}`, {
                            at: when.format(i.endedAt),
                          })
                        : t('impersonate.endedHow.expired', { at: when.format(i.expiresAt) })}
                  </span>
                  <StatusDot
                    status={open ? 'warning' : 'neutral'}
                    label={open ? t('impersonate.open') : t('impersonate.closed')}
                  />
                  {open && staff.can('impersonate') ? (
                    <form action={endImpersonationAction.bind(null, id, i.id)}>
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        aria-label={t('impersonate.endFor', { member: i.memberName })}
                      >
                        {t('impersonate.end')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
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
