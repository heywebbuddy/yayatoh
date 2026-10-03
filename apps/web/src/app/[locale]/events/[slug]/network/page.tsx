import { directoryQuery, type MatchesDto, suggestedMatchesQuery } from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  Alert,
  Avatar,
  avatarTone,
  Button,
  buttonClass,
  Card,
  EmptyState,
  Pagination,
  StatusPill,
} from '@yayatoh/ui';
import { Search, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { signInAction } from '@/app/[locale]/my-tickets/actions.ts';
import { SignInForm } from '@/components/my-tickets-forms.tsx';
import { initials } from '@/components/networking/initials.ts';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { profileErrors, profileFields } from '@/components/networking/profile-fields.ts';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { optInAction } from './actions.ts';

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ q?: string; page?: string; notice?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Networking at an event (M5.8a), phone first. Off for everyone until they opt in: a visitor
 * proves their address (the "My tickets" code), then chooses to show a profile; only people who
 * did the same see it. Members browse and search the directory here.
 */
export default async function NetworkPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const { q = '', page = '1', notice } = await searchParams;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  const t = await getTranslations('networking');
  const shell = { slug, eventName: p.target.eventName };
  if (p.kind === 'sign_in')
    return (
      <NetworkShell {...shell} title={t('title')} description={t('signIn.intro')}>
        <Card className="flex flex-col gap-4">
          <h2 className="text-card">{t('signIn.heading')}</h2>
          <p className="text-body text-ink-2">{t('signIn.how')}</p>
          <SignInForm action={signInAction.bind(null, null)} />
        </Card>
      </NetworkShell>
    );
  if (p.kind === 'not_attendee')
    return (
      <NetworkShell {...shell} title={t('title')}>
        <EmptyState
          icon={<Users />}
          title={t('notAttendee.title')}
          description={t('notAttendee.description')}
          action={
            <Link href="/my-tickets" className={buttonClass('secondary')}>
              {t('notAttendee.switch')}
            </Link>
          }
        />
      </NetworkShell>
    );
  if (p.kind === 'opt_in') {
    const hidden = p.home.profile?.hidden ?? false;
    return (
      <NetworkShell {...shell} title={t('title')} description={t('optIn.intro')}>
        {hidden ? (
          <Alert tone="danger" title={t('optIn.hiddenTitle')}>
            {t('optIn.hiddenDescription')}
          </Alert>
        ) : (
          <>
            <EmptyState
              icon={<Users />}
              title={t('optIn.offTitle')}
              description={t('optIn.offDescription')}
            />
            <Card className="flex flex-col gap-4">
              <h2 className="text-card">{t('optIn.heading')}</h2>
              <p className="text-body text-ink-2">{t('optIn.privacy')}</p>
              <ProgramForm
                action={optInAction.bind(null, slug)}
                fields={await profileFields(p.home.profile, p.home.attendeeName, { consent: true })}
                idPrefix="network-optin"
                submitLabel={t('optIn.submit')}
                successLabel={t('optIn.done')}
                errors={await profileErrors()}
              />
            </Card>
          </>
        )}
      </NetworkShell>
    );
  }
  const query = q.trim().slice(0, 80);
  const dir = await executeQuery(
    directoryQuery,
    { ...p.at, q: query, page: Math.max(1, Number.parseInt(page, 10) || 1) },
    p.ctx,
    ports,
  );
  // M6.12b: "Suggested for you" (people with similar profiles; opted-in people only), on the
  // first page of the unfiltered directory.
  let suggested: MatchesDto | null = null;
  if (!query && dir.page === 1)
    try {
      suggested = await executeQuery(suggestedMatchesQuery, { ...p.at, limit: 4 }, p.ctx, ports);
    } catch (err) {
      if (!isDomainError(err)) throw err;
    }
  const pageHref = (n: number) =>
    `${networkPath(slug)}?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(n) })}`;
  const tone = {
    none: null,
    pending_out: { tone: 'waiting', label: t('status.pendingOut') },
    pending_in: { tone: 'info', label: t('status.pendingIn') },
    connected: { tone: 'success', label: t('status.connected') },
  } as const;
  return (
    <NetworkShell
      {...shell}
      title={t('title')}
      description={t('people.intro')}
      active="people"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      {notice === 'blocked' || notice === 'reported' ? (
        <Alert tone="info" title={t(`notice.${notice}`)} />
      ) : null}
      {suggested?.ready ? (
        <section aria-labelledby="network-suggested" className="flex flex-col gap-3">
          <h2 id="network-suggested" className="text-section">
            {t('suggested.title')}
          </h2>
          {suggested.matches.length === 0 ? (
            <p className="text-body text-ink-2">{t('suggested.none')}</p>
          ) : (
            <>
              <p className="text-caption text-ink-2">{t('suggested.why')}</p>
              <ul
                aria-label={t('suggested.listLabel')}
                className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
              >
                {suggested.matches.map((m) => (
                  <li key={m.id}>
                    <Card className="flex h-full flex-col gap-2">
                      <h3 className="text-card">
                        <Link
                          href={networkPath(slug, `/people/${m.id}`)}
                          className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
                        >
                          {m.displayName}
                        </Link>
                      </h3>
                      {m.headline || m.company ? (
                        <p className="text-body text-ink-2">
                          {[m.headline, m.company].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                      <p className="text-caption">{t('suggested.score', { score: m.score })}</p>
                      {m.shared.length ? (
                        <p className="text-caption text-ink-2">
                          {t('suggested.shared', { interests: m.shared.join(', ') })}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
      <search>
        <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="network-q" className="text-[13px] font-bold text-ink">
              {t('people.search')}
            </label>
            <input
              id="network-q"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={80}
              aria-describedby="network-q-hint"
              className="field"
            />
            <p id="network-q-hint" className="text-caption text-ink-2">
              {t('people.searchHint')}
            </p>
          </div>
          <Button type="submit" variant="secondary" icon={<Search aria-hidden="true" />} className="sm:mb-6">
            {t('people.searchButton')}
          </Button>
        </form>
      </search>
      <p role="status" className="text-body text-ink-2">
        {query
          ? t('people.resultsFor', { count: dir.total, q: query })
          : t('people.count', { count: dir.total })}
      </p>
      {dir.people.length === 0 ? (
        query ? (
          <EmptyState
            icon={<Search />}
            title={t('people.noMatchTitle', { q: query })}
            description={t('people.noMatchDescription')}
            action={
              <Link href={networkPath(slug)} className={buttonClass('secondary')}>
                {t('people.clearSearch')}
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={t('people.emptyTitle')}
            description={t('people.emptyDescription')}
          />
        )
      ) : (
        <ul
          aria-label={t('people.listLabel')}
          className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
        >
          {dir.people.map((person) => {
            const status = tone[person.connection];
            return (
              <li key={person.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar
                      initials={initials(person.displayName)}
                      label={person.displayName}
                      tone={avatarTone(person.id)}
                      size={42}
                      decorative
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h2 className="text-card">
                        <Link
                          href={networkPath(slug, `/people/${person.id}`)}
                          className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
                        >
                          {person.displayName}
                        </Link>
                      </h2>
                      {person.headline || person.company ? (
                        <p className="text-body text-ink-2">
                          {[person.headline, person.company].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {person.interests.length ? (
                    <ul aria-label={t('people.interests')} className="flex list-none flex-wrap gap-1.5 p-0">
                      {person.interests.map((i) => (
                        <li key={i} className="rounded-pill bg-surface-3 px-2.5 py-1 text-caption text-ink">
                          {i}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {status ? (
                    <StatusPill tone={status.tone} label={status.label} className="self-start" />
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {dir.pages > 1 ? (
        <Pagination
          label={t('people.pages')}
          link={Link}
          status={t('people.pageOf', { page: dir.page, pages: dir.pages })}
          previous={{ href: dir.page > 1 ? pageHref(dir.page - 1) : null, label: t('people.previous') }}
          next={{ href: dir.page < dir.pages ? pageHref(dir.page + 1) : null, label: t('people.next') }}
        />
      ) : null}
    </NetworkShell>
  );
}
