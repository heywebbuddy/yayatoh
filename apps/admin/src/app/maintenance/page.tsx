import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell.tsx';
import { getTwoFactor } from '@/server/auth.ts';
import { maintenanceView } from '@/server/maintenance.ts';
import { requireStaff } from '@/server/staff.ts';
import { endFreezeAction, startFreezeAction } from './actions.ts';

const ERRORS = new Set([
  'reason',
  'scope',
  'orgs',
  'orgs_unknown',
  'expected_end',
  'confirm_platform',
  'step_up',
  'step_up_rate_limited',
  'step_up_method',
]);
const field = 'field';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3" id={id}>
      <h2 id={`${id}-heading`} className="text-section">
        {title}
      </h2>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Maintenance (M2.5a, roadmap §7.8; runbook docs/runbooks/cutover.md): the read-only freeze of the
 * new app and the cutover host routes. Admins only. Starting or ending the freeze needs a reason
 * and the staff member confirming it's them; both are audited (access log and change history).
 */
export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; slugs?: string }>;
}) {
  const staff = await requireStaff('maintenance');
  const { done, error, slugs } = await searchParams;
  const t = await getTranslations('maintenance');
  const [view, method] = await Promise.all([maintenanceView(staff), getTwoFactor().method(staff.userId)]);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const f = view.freeze;
  const proof =
    method === 'email' ? (
      <p className="text-caption text-ink-2">{t('errors.step_up_method')}</p>
    ) : (
      <Labelled id="freeze-proof" label={method === 'totp' ? t('code') : t('password')}>
        {method === 'totp' ? (
          <input
            id="freeze-proof"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${field} max-w-xs`}
          />
        ) : (
          <input
            id="freeze-proof"
            name="password"
            type="password"
            autoComplete="current-password"
            className={`${field} max-w-xs`}
          />
        )}
      </Labelled>
    );
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div aria-live="polite">
        {done === 'started' || done === 'ended' ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
        {error ? (
          <Alert
            title={
              ERRORS.has(error)
                ? t(`errors.${error}`, { slugs: slugs ?? '' })
                : t('errors.generic', { code: error })
            }
          />
        ) : null}
      </div>

      <Section id="freeze" title={t('freeze.title')}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot
            status={f ? 'warning' : 'success'}
            label={
              f ? (f.scope === 'platform' ? t('freeze.onPlatform') : t('freeze.onOrgs')) : t('freeze.off')
            }
          />
          {f ? (
            <span className="text-caption text-ink-2">
              {t('freeze.since', { when: when.format(f.since), by: f.by })}
              {f.expectedEndAt ? ` · ${t('freeze.until', { when: when.format(f.expectedEndAt) })}` : ''}
            </span>
          ) : null}
        </div>
        {f?.scope === 'orgs' ? (
          <ul aria-label={t('freeze.frozenOrgs')} className="flex flex-col gap-1 text-body">
            {f.orgs.map((o) => (
              <li key={o.id}>
                {o.name} <span className="font-mono text-caption text-ink-2">{o.slug}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {f ? <p className="text-body">{t('freeze.reason', { reason: f.reason })}</p> : null}
        <p className="text-caption text-ink-2">{t('freeze.effect')}</p>

        <form action={startFreezeAction} className="flex flex-col gap-3" aria-label={t('start.form')}>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-caption text-ink-2">{t('start.scope')}</legend>
            <label className="flex min-h-6 items-center gap-2 text-body">
              <input type="radio" name="scope" value="orgs" defaultChecked className="size-5" />
              {t('start.scopeOrgs')}
            </label>
            <label className="flex min-h-6 items-center gap-2 text-body">
              <input type="radio" name="scope" value="platform" className="size-5" />
              {t('start.scopePlatform')}
            </label>
          </fieldset>
          <Labelled id="freeze-orgs" label={t('start.orgs')}>
            <input
              id="freeze-orgs"
              name="orgs"
              autoComplete="off"
              spellCheck={false}
              className={`${field} font-mono`}
              defaultValue={f?.scope === 'orgs' ? f.orgs.map((o) => o.slug).join(', ') : ''}
            />
          </Labelled>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="confirmPlatform" className="size-5" />
            {t('start.confirmPlatform')}
          </label>
          <Labelled id="freeze-end" label={t('start.expectedEnd')}>
            <input
              id="freeze-end"
              name="expectedEndAt"
              type="datetime-local"
              className={`${field} max-w-xs`}
            />
          </Labelled>
          <Labelled id="freeze-reason" label={t('reason')}>
            <input
              id="freeze-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className={field}
            />
          </Labelled>
          {proof}
          <Button type="submit" variant="primary" className="self-start">
            {f ? t('start.update') : t('start.submit')}
          </Button>
        </form>

        {f ? (
          <form
            action={endFreezeAction}
            className="flex flex-col gap-3 border-t border-line pt-4"
            aria-label={t('end.form')}
          >
            <Labelled id="end-reason" label={t('reason')}>
              <input id="end-reason" name="reason" required minLength={3} maxLength={500} className={field} />
            </Labelled>
            {method === 'email' ? null : (
              <Labelled id="end-proof" label={method === 'totp' ? t('code') : t('password')}>
                {method === 'totp' ? (
                  <input
                    id="end-proof"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={`${field} max-w-xs`}
                  />
                ) : (
                  <input
                    id="end-proof"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    className={`${field} max-w-xs`}
                  />
                )}
              </Labelled>
            )}
            <Button type="submit" variant="secondary" className="self-start">
              {t('end.submit')}
            </Button>
          </form>
        ) : null}
      </Section>

      <Section id="routes" title={t('routes.title')}>
        <p className="text-caption text-ink-2">{t('routes.description')}</p>
        {view.routes.length === 0 ? (
          <p className="text-body text-ink-2">{t('routes.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-body">
            {view.routes.map((r) => (
              <li key={r.host}>
                <span className="font-mono">{r.host}</span> →{' '}
                {r.target === 'next' ? t('routes.next') : t('routes.legacy')}{' '}
                <span className="text-caption text-ink-2">
                  {t('routes.by', { by: r.by, when: when.format(r.at) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="history" title={t('history.title')}>
        {view.changes.length === 0 ? (
          <p className="text-body text-ink-2">{t('history.empty')}</p>
        ) : (
          <ol aria-label={t('history.title')} className="flex flex-col gap-2 text-body">
            {view.changes.map((c) => (
              <li key={c.id} className="flex flex-col">
                <span>
                  {c.key === 'read_only_freeze'
                    ? c.on
                      ? t('history.freezeOn', { summary: c.summary })
                      : t('history.freezeOff')
                    : t('history.route', {
                        host: c.key.slice('host_route:'.length),
                        summary: c.summary || 'off',
                      })}
                </span>
                <span className="text-caption text-ink-2">
                  {t('history.meta', { who: c.actor, when: when.format(c.at), reason: c.reason })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Shell>
  );
}
