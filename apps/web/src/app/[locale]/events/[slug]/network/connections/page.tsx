import { type ConnectionDto, myConnectionsQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { Avatar, avatarTone, buttonClass, Card, EmptyState } from '@yayatoh/ui';
import { Handshake } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { initials } from '@/components/networking/initials.ts';
import { ActionButton } from '@/components/networking/network-forms.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { respondConnectionAction, withdrawConnectionAction } from '../actions.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking');
  return { title: t('connections.metaTitle'), robots: { index: false, follow: false } };
}

/** Requests waiting for you, requests you sent, and your connections (M5.8a). */
export default async function NetworkConnectionsPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('networking');
  const mine = await executeQuery(myConnectionsQuery, p.at, p.ctx, ports);
  const person = (c: ConnectionDto) => (
    <div className="flex min-w-0 items-start gap-3">
      <Avatar
        initials={initials(c.person.displayName)}
        label={c.person.displayName}
        tone={avatarTone(c.person.id)}
        size={42}
        decorative
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-card">
          <Link
            href={networkPath(slug, `/people/${c.person.id}`)}
            className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
          >
            {c.person.displayName}
          </Link>
        </h3>
        {c.person.headline || c.person.company ? (
          <p className="text-body text-ink-2">
            {[c.person.headline, c.person.company].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {c.message ? (
          <blockquote className="mt-1 border-s-2 border-line-strong ps-3 text-body text-ink">
            {c.message}
          </blockquote>
        ) : null}
      </div>
    </div>
  );
  const section = (
    id: string,
    title: string,
    list: ConnectionDto[],
    empty: string,
    actions: (c: ConnectionDto) => React.ReactNode,
  ) => (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-section">
        {title}
      </h2>
      {list.length === 0 ? (
        <p className="text-body text-ink-2">{empty}</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {list.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                {person(c)}
                <div className="flex shrink-0 flex-wrap gap-2">{actions(c)}</div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const nothing = mine.incoming.length + mine.outgoing.length + mine.connected.length === 0;
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('connections.title')}
      active="connections"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      {nothing ? (
        <EmptyState
          icon={<Handshake />}
          title={t('connections.emptyTitle')}
          description={t('connections.emptyDescription')}
          action={
            <Link href={networkPath(slug)} className={buttonClass('primary')}>
              {t('connections.browse')}
            </Link>
          }
        />
      ) : (
        <>
          {section(
            'incoming-heading',
            t('connections.incoming'),
            mine.incoming,
            t('connections.noIncoming'),
            (c) => (
              <>
                <ActionButton
                  action={respondConnectionAction.bind(null, slug, c.id, true)}
                  label={t('connections.accept')}
                  accessibleName={t('connections.acceptFrom', { name: c.person.displayName })}
                  done={t('connections.accepted', { name: c.person.displayName })}
                  variant="primary"
                />
                <ActionButton
                  action={respondConnectionAction.bind(null, slug, c.id, false)}
                  label={t('connections.decline')}
                  accessibleName={t('connections.declineFrom', { name: c.person.displayName })}
                  done={t('connections.declined')}
                />
              </>
            ),
          )}
          {section(
            'outgoing-heading',
            t('connections.outgoing'),
            mine.outgoing,
            t('connections.noOutgoing'),
            (c) => (
              <ActionButton
                action={withdrawConnectionAction.bind(null, slug, c.id)}
                label={t('connections.withdraw')}
                accessibleName={t('connections.withdrawTo', { name: c.person.displayName })}
                done={t('connections.withdrawn')}
              />
            ),
          )}
          {section(
            'connected-heading',
            t('connections.connected'),
            mine.connected,
            t('connections.noConnected'),
            (c) => (
              <ActionButton
                action={withdrawConnectionAction.bind(null, slug, c.id)}
                label={t('connections.remove')}
                accessibleName={t('connections.removeName', { name: c.person.displayName })}
                done={t('connections.removed')}
                variant="ghost"
              />
            ),
          )}
        </>
      )}
    </NetworkShell>
  );
}
