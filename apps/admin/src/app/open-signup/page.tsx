import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { openSignupState } from '@/server/open-signup.ts';
import { requireStaff } from '@/server/staff.ts';
import { setOpenSignupAction } from './actions.ts';

const DONE = ['opened', 'closed', 'unchanged'] as const;

/**
 * The open-signup switch (M3.11a): off by default, so organizations are created only with a signup
 * code; on, anyone with a verified email can create one (it starts in setup mode). Admins only;
 * every view and change is in the access log, and each change keeps its reason in the history.
 */
export default async function OpenSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; target?: string }>;
}) {
  const staff = await requireStaff('openSignup');
  const sp = await searchParams;
  const t = await getTranslations('openSignup');
  const state = await openSignupState(staff);
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const done = DONE.find((d) => d === sp.done);
  const error = sp.error === 'reason' || sp.error === 'confirm' ? sp.error : null;
  // The form turns the switch the other way; a replayed form (the switch moved meanwhile) is a no-op.
  const target = !state.enabled;
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div aria-live="polite">
        {done ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
        {error ? <Alert title={t(`error.${error}`)} /> : null}
      </div>
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('current')}</h2>
        <StatusDot
          status={state.enabled ? 'success' : 'neutral'}
          label={state.enabled ? t('state.on') : t('state.off')}
        />
        <p className="text-body text-ink-2">{state.enabled ? t('explain.on') : t('explain.off')}</p>
        {state.updatedAt ? (
          <p className="text-caption text-ink-2">{t('since', { date: date.format(state.updatedAt) })}</p>
        ) : null}
        <form action={setOpenSignupAction} className="flex flex-col gap-3">
          {target ? <input type="hidden" name="enabled" value="on" /> : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="open-signup-reason" className="text-caption text-ink-2">
              {t('reason')}
            </label>
            <textarea
              id="open-signup-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              aria-invalid={error === 'reason' ? true : undefined}
              aria-describedby="open-signup-reason-hint"
              className="rounded-card border border-line bg-surface px-4 py-2 text-body"
            />
            <p id="open-signup-reason-hint" className="text-caption text-ink-2">
              {t('reasonHint')}
            </p>
          </div>
          {target ? (
            <label className="flex min-h-6 items-start gap-2.5 text-body">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                aria-invalid={error === 'confirm' ? true : undefined}
                className="mt-0.5 size-5 shrink-0 accent-primary"
              />
              <span>{t('confirm')}</span>
            </label>
          ) : null}
          <Button type="submit" variant={target ? 'primary' : 'secondary'} className="self-start">
            {target ? t('open') : t('close')}
          </Button>
        </form>
      </Card>
      <Card className="p-0">
        {state.history.length === 0 ? (
          <p className="p-4 text-body text-ink-2">{t('noHistory')}</p>
        ) : (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
          <section className="overflow-x-auto" tabIndex={0} aria-label={t('history')}>
            <table className="w-full text-start text-body">
              <caption className="sr-only">{t('history')}</caption>
              <thead className="text-caption text-ink-2">
                <tr>
                  {(['when', 'change', 'who', 'reason'] as const).map((c) => (
                    <th key={c} scope="col" className="px-4 py-2 text-start font-normal">
                      {t(`col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.history.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <td className="px-4 py-2 whitespace-nowrap">{date.format(h.at)}</td>
                    <td className="px-4 py-2">{h.enabled ? t('change.on') : t('change.off')}</td>
                    <td className="px-4 py-2">{h.changedBy}</td>
                    <td className="px-4 py-2">{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Card>
    </Shell>
  );
}
