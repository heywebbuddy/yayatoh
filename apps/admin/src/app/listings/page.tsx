import { MODERATION_REASON_MAX } from '@yayatoh/marketplace';
import { Alert, Button, Card, EmptyState, PageHeader, StatusPill, Tabs, tabClass } from '@yayatoh/ui';
import { Store } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { listingQueue } from '@/server/listings.ts';
import { requireStaff } from '@/server/staff.ts';
import { moderateListingAction } from './actions.ts';

export async function generateMetadata() {
  const t = await getTranslations('listings');
  return { title: t('title') };
}

const ERRORS = ['reason_required', 'reason_too_long', 'already_hidden', 'not_hidden', 'not_found'] as const;

/**
 * Marketplace listing moderation (M6.14a): live marketplace listings newest first, and the ones
 * staff hid. Hiding takes a listing off the marketplace and its search (the organizer's own site
 * keeps it); showing it again puts it back. Both need a reason, kept in the org's audit log.
 */
export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; q?: string; done?: string; error?: string; listing?: string }>;
}) {
  const staff = await requireStaff('listings');
  const sp = await searchParams;
  const state = sp.state === 'hidden' ? 'hidden' : 'listed';
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const t = await getTranslations('listings');
  const rows = await listingQueue(staff, state, q);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const web = process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const fieldError = (id: string) =>
    sp.listing === id && (sp.error === 'reason_required' || sp.error === 'reason_too_long') ? sp.error : null;
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs label={t('filter')} className="self-start">
        <Link
          href="/listings"
          aria-current={state === 'listed' ? 'page' : undefined}
          className={tabClass(state === 'listed')}
        >
          {t('tabs.listed')}
        </Link>
        <Link
          href="/listings?state=hidden"
          aria-current={state === 'hidden' ? 'page' : undefined}
          className={tabClass(state === 'hidden')}
        >
          {t('tabs.hidden')}
        </Link>
      </Tabs>
      <search aria-label={t('searchLabel')}>
        <form method="get" action="/listings" className="flex flex-wrap items-end gap-2">
          {state === 'hidden' ? <input type="hidden" name="state" value="hidden" /> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-bold text-ink">
              {t('search')}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              maxLength={100}
              className="field w-72 max-w-full"
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('searchSubmit')}
          </Button>
        </form>
      </search>
      <div aria-live="polite">
        {sp.done === 'hidden' || sp.done === 'shown' ? (
          <Alert tone="info" title={t(`done.${sp.done}`)} />
        ) : null}
        {sp.error ? (
          <Alert
            title={
              (ERRORS as readonly string[]).includes(sp.error)
                ? t(`errors.${sp.error as (typeof ERRORS)[number]}`)
                : t('errors.other', { code: sp.error })
            }
          />
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Store strokeWidth={2} />}
          title={q ? t('emptySearch') : t(`empty.${state}`)}
          description={state === 'listed' ? t('emptyListedDescription') : t('emptyHiddenDescription')}
        />
      ) : (
        <ul aria-label={t(`tabs.${state}`)} className="flex list-none flex-col gap-4 p-0">
          {rows.map((r) => {
            const err = fieldError(r.eventId);
            const name = r.name ?? t('gone');
            return (
              <li key={`${r.orgId}-${r.eventId}`}>
                <Card className="flex flex-col gap-3">
                  <article aria-labelledby={`listing-${r.eventId}`} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id={`listing-${r.eventId}`} className="text-section">
                        {name}
                      </h2>
                      <StatusPill
                        tone={r.hidden ? 'danger' : 'success'}
                        label={r.hidden ? t('status.hidden') : t('status.listed')}
                      />
                    </div>
                    <p className="text-caption text-ink-2">
                      {t('meta', {
                        org: r.orgName,
                        city: r.city ?? '—',
                        at: r.startsAt ? `${when.format(r.startsAt)} UTC` : '—',
                      })}{' '}
                      <Link href={`/tenants/${r.orgId}`} className="underline">
                        {t('tenantLink', { slug: r.orgSlug })}
                      </Link>
                      {r.slug ? (
                        <>
                          {' · '}
                          <a href={`${web}/events/${r.slug}`} className="underline">
                            {t('publicLink')}
                          </a>
                        </>
                      ) : null}
                    </p>
                    {r.reason ? (
                      <p className="text-body">
                        <span className="text-ink-2">{r.hidden ? t('hiddenBecause') : t('lastReason')}</span>{' '}
                        {r.reason}
                        {r.moderatedAt ? ` · ${when.format(r.moderatedAt)} UTC` : ''}
                      </p>
                    ) : null}
                    <form
                      action={moderateListingAction.bind(null, r.orgId, r.eventId, !r.hidden)}
                      aria-label={r.hidden ? t('showLabel', { name }) : t('hideLabel', { name })}
                      className="flex flex-col gap-2"
                    >
                      <label htmlFor={`reason-${r.eventId}`} className="text-[13px] font-bold text-ink">
                        {t('reason')}
                      </label>
                      <textarea
                        id={`reason-${r.eventId}`}
                        name="reason"
                        rows={2}
                        maxLength={MODERATION_REASON_MAX}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `reason-${r.eventId}-error` : `reason-${r.eventId}-hint`}
                        className="rounded-card border border-line bg-surface px-3 py-2 text-body"
                      />
                      {err ? (
                        <p id={`reason-${r.eventId}-error`} className="text-caption text-danger">
                          {t(`errors.${err}`)}
                        </p>
                      ) : (
                        <p id={`reason-${r.eventId}-hint`} className="text-caption text-ink-2">
                          {r.hidden ? t('showHint') : t('hideHint')}
                        </p>
                      )}
                      <div>
                        <Button type="submit" variant={r.hidden ? 'secondary' : 'primary'}>
                          {r.hidden ? t('show') : t('hide')}
                        </Button>
                      </div>
                    </form>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
