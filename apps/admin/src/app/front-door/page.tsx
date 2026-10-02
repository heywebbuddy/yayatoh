import { getUsersByIds } from '@yayatoh/auth';
import { FRONT_DOOR_ROUTES, frontDoorHostList, ROUTE_STATES } from '@yayatoh/platform/front-door';
import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell.tsx';
import { getTwoFactor } from '@/server/auth.ts';
import { frontDoorOverview } from '@/server/front-door-store.ts';
import { requireStaff } from '@/server/staff.ts';
import { setFrontDoorFlagAction } from './actions.ts';

const ERRORS = ['invalid', 'reason', 'step_up', 'rate_limited', 'method'] as const;
const DOT = { legacy: 'neutral', canary: 'warning', next: 'success' } as const;
const field = 'field';

function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Scrollable on narrow screens: focusable and named so keyboard users can scroll it.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
    <section className="overflow-x-auto" tabIndex={0} aria-label={label}>
      {children}
    </section>
  );
}

/**
 * The coexistence front door (M2.4a, roadmap §7.4): the versioned route table with who serves
 * each moved route on each legacy host, the last week's requests, 404s, proxy errors and
 * forwarding latency, the 404 top list and every flag change. Admins move a route (step-up).
 */
export default async function FrontDoorPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff();
  const { done, error } = await searchParams;
  const t = await getTranslations('frontDoor');
  const data = await frontDoorOverview(staff.actor);
  const canChange = staff.can('frontDoor');
  const method = canChange ? await getTwoFactor().method(staff.userId) : null;
  const staffIdOf = (actor: string) => /^staff:([0-9a-f-]{36})$/.exec(actor)?.[1] ?? null;
  const names = await getUsersByIds(
    [...new Set([...data.changes.map((c) => c.actor), ...data.routes.map((r) => r.updatedBy ?? '')])]
      .map(staffIdOf)
      .filter((x): x is string => x !== null),
  );
  const who = (actor: string) => names.get(staffIdOf(actor) ?? '')?.name ?? actor;
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const num = new Intl.NumberFormat('en');
  const ms = (v: number | null) => (v === null ? t('none') : t('ms', { ms: v }));
  const errorCode = ERRORS.find((e) => e === error);
  const hosts = frontDoorHostList();

  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div aria-live="polite">
        {done === 'changed' ? <Alert tone="info" title={t('done')} /> : null}
        {errorCode ? <Alert tone="danger" title={t(`errors.${errorCode}`)} /> : null}
      </div>
      <p className="text-body text-ink-2">{t('summary', { version: data.version, days: data.days })}</p>

      <Card>
        <h2 className="text-section">{t('hosts.title')}</h2>
        <ul aria-label={t('hosts.title')} className="mt-2 flex flex-col gap-1 text-body">
          {hosts.map((h) => (
            <li key={h.host} className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono">{h.host}</span>
              <span className="text-caption text-ink-2">{t(`instance.${h.instance}`)}</span>
              <StatusDot
                status={h.configured ? 'success' : 'neutral'}
                label={h.configured ? t('hosts.configured') : t('hosts.off')}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-0" id="routes">
        <h2 className="px-4 pt-4 text-section">{t('routes.title')}</h2>
        <p className="px-4 text-caption text-ink-2">{t('routes.description')}</p>
        <Scroll label={t('routes.title')}>
          <table className="w-full text-start text-caption">
            <caption className="sr-only">{t('routes.title')}</caption>
            <thead className="text-ink-2">
              <tr>
                {(
                  [
                    'host',
                    'route',
                    'stage',
                    'state',
                    'requests',
                    'notFound',
                    'proxyErrors',
                    'latency',
                    'changed',
                  ] as const
                ).map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 text-start font-normal">
                    {t(`col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r) => (
                <tr key={`${r.host}|${r.route}`} className="border-t border-line align-top">
                  <td className="px-4 py-2 font-mono">{r.host}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono">{r.route}</span>
                    <span className="block text-ink-2">{r.shapes.join(', ')}</span>
                  </td>
                  <td className="px-4 py-2">{r.stage}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <StatusDot status={DOT[r.state]} label={t(`state.${r.state}`)} />
                  </td>
                  <td className="px-4 py-2 tabular-nums">{num.format(r.requests)}</td>
                  <td className="px-4 py-2 tabular-nums">{num.format(r.notFound)}</td>
                  <td className="px-4 py-2 tabular-nums">{num.format(r.proxyErrors)}</td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {t('latency', { avg: ms(r.avgLatencyMs), max: ms(r.maxLatencyMs) })}
                  </td>
                  <td className="px-4 py-2">
                    {r.updatedAt && r.updatedBy
                      ? t('changedBy', { who: who(r.updatedBy), date: date.format(r.updatedAt) })
                      : t('never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Card>

      <Card id="change">
        <h2 className="text-section">{t('change.title')}</h2>
        {!canChange ? (
          <p className="mt-2 text-caption text-ink-2">{t('change.adminsOnly')}</p>
        ) : (
          <form
            aria-label={t('change.title')}
            action={setFrontDoorFlagAction}
            className="mt-2 flex flex-col gap-3"
          >
            <p className="text-caption text-ink-2">{t('change.description')}</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-0 max-w-full flex-col gap-1.5">
                <label htmlFor="fd-host" className="text-[13px] font-bold text-ink">
                  {t('change.host')}
                </label>
                <select id="fd-host" name="host" required className={`${field} w-full max-w-full`}>
                  {hosts.map((h) => (
                    <option key={h.host} value={h.host}>
                      {h.host}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 max-w-full flex-col gap-1.5">
                <label htmlFor="fd-route" className="text-[13px] font-bold text-ink">
                  {t('change.route')}
                </label>
                <select id="fd-route" name="route" required className={`${field} w-full max-w-full`}>
                  {FRONT_DOOR_ROUTES.map((r) => (
                    <option key={r.key} value={r.key}>
                      {t('change.routeOption', {
                        key: r.key,
                        shape: r.shapes[0] ?? '',
                        only: r.instances.length === 1 ? (r.instances[0] ?? '') : 'all',
                      })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-bold text-ink">{t('change.state')}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {ROUTE_STATES.map((s) => (
                  <label key={s} className="flex min-h-6 items-center gap-2 text-body">
                    <input type="radio" name="state" value={s} required className="size-5" />
                    {t(`state.${s}`)}
                  </label>
                ))}
              </div>
              <p className="text-caption text-ink-2">{t('change.stateHelp')}</p>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fd-reason" className="text-[13px] font-bold text-ink">
                {t('change.reason')}
              </label>
              <textarea
                id="fd-reason"
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                className="rounded-card border border-line bg-surface px-4 py-2 text-body"
              />
            </div>
            {method === 'email' ? (
              <p className="text-caption text-ink-2">{t('errors.method')}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fd-proof" className="text-[13px] font-bold text-ink">
                  {method === 'totp' ? t('change.code') : t('change.password')}
                </label>
                {method === 'totp' ? (
                  <input
                    id="fd-proof"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    className={`${field} max-w-xs`}
                  />
                ) : (
                  <input
                    id="fd-proof"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className={`${field} max-w-xs`}
                  />
                )}
              </div>
            )}
            <Button type="submit" variant="primary" className="self-start">
              {t('change.submit')}
            </Button>
          </form>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="px-4 pt-4 text-section">{t('other.title')}</h2>
        <p className="px-4 text-caption text-ink-2">{t('other.description')}</p>
        {data.other.length === 0 ? (
          <p className="p-4 text-body text-ink-2">{t('other.empty')}</p>
        ) : (
          <Scroll label={t('other.title')}>
            <table className="w-full text-start text-caption">
              <caption className="sr-only">{t('other.title')}</caption>
              <thead className="text-ink-2">
                <tr>
                  {(
                    [
                      'host',
                      'route',
                      'servedBy',
                      'requests',
                      'notFound',
                      'proxyErrors',
                      'upstream5xx',
                      'latency',
                    ] as const
                  ).map((k) => (
                    <th key={k} scope="col" className="px-4 py-2 text-start font-normal">
                      {t(`col.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.other.map((r) => (
                  <tr key={`${r.host}|${r.route}|${r.servedBy}`} className="border-t border-line">
                    <td className="px-4 py-2 font-mono">{r.host}</td>
                    <td className="px-4 py-2">
                      {t(`bucket.${r.route === 'platform' ? 'platform' : 'legacy'}`)}
                    </td>
                    <td className="px-4 py-2">{t(`servedBy.${r.servedBy}`)}</td>
                    <td className="px-4 py-2 tabular-nums">{num.format(r.requests)}</td>
                    <td className="px-4 py-2 tabular-nums">{num.format(r.notFound)}</td>
                    <td className="px-4 py-2 tabular-nums">{num.format(r.proxyErrors)}</td>
                    <td className="px-4 py-2 tabular-nums">{num.format(r.upstream5xx)}</td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      {t('latency', { avg: ms(r.avgLatencyMs), max: ms(r.maxLatencyMs) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="px-4 pt-4 text-section">{t('notFound.title')}</h2>
        <p className="px-4 text-caption text-ink-2">{t('notFound.description', { days: data.days })}</p>
        {data.notFound.length === 0 ? (
          <p className="p-4 text-body text-ink-2">{t('notFound.empty')}</p>
        ) : (
          <Scroll label={t('notFound.title')}>
            <table className="w-full text-start text-caption">
              <caption className="sr-only">{t('notFound.title')}</caption>
              <thead className="text-ink-2">
                <tr>
                  {(['host', 'path', 'servedBy', 'count'] as const).map((k) => (
                    <th key={k} scope="col" className="px-4 py-2 text-start font-normal">
                      {t(`col.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.notFound.map((r) => (
                  <tr key={`${r.host}|${r.path}|${r.servedBy}`} className="border-t border-line">
                    <td className="px-4 py-2 font-mono">{r.host}</td>
                    <td className="px-4 py-2 font-mono break-all">{r.path}</td>
                    <td className="px-4 py-2">{t(`servedBy.${r.servedBy}`)}</td>
                    <td className="px-4 py-2 tabular-nums">{num.format(r.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Card>

      <Card>
        <h2 className="text-section">{t('changes.title')}</h2>
        {data.changes.length === 0 ? (
          <p className="mt-2 text-body text-ink-2">{t('changes.empty')}</p>
        ) : (
          <ul aria-label={t('changes.title')} className="mt-2 flex flex-col gap-2 text-body">
            {data.changes.map((c) => (
              <li key={c.id} className="border-t border-line pt-2">
                {t('changes.item', {
                  host: c.host,
                  route: c.route,
                  from: t(`state.${c.fromState as 'legacy'}`),
                  to: t(`state.${c.toState as 'legacy'}`),
                })}
                <span className="block text-caption text-ink-2">
                  {t('changes.meta', { who: who(c.actor), date: date.format(c.at), reason: c.reason })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
