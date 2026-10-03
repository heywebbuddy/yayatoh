import { myMeetingsQuery, type PersonDetailDto, personQuery, REPORT_REASONS } from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { Avatar, avatarTone, Card, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { slotLabel } from '@/components/networking/format.ts';
import { initials } from '@/components/networking/initials.ts';
import {
  ActionButton,
  ConnectForm,
  MeetingRequestForm,
  SafetyForms,
} from '@/components/networking/network-forms.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import {
  blockAction,
  connectAction,
  reportAction,
  requestMeetingAction,
  respondConnectionAction,
  withdrawConnectionAction,
} from '../../actions.ts';

type Params = { params: Promise<{ locale: string; slug: string; person: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking');
  return { title: t('person.metaTitle'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One person of the directory (M5.8a): their profile, connect, request a meeting, block or
 * report. Anyone not listed (not opted in, hidden, blocked either way) is a 404.
 */
export default async function NetworkPersonPage({ params }: Params) {
  const { locale, slug, person } = await params;
  pageLocale(locale);
  if (!UUID.test(person)) notFound();
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member') redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('networking');
  let who: PersonDetailDto;
  try {
    who = await executeQuery(personQuery, { ...p.at, personId: person }, p.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const options = p.home.meetingsEnabled ? await executeQuery(myMeetingsQuery, p.at, p.ctx, ports) : null;
  const directory = getPathname({ href: networkPath(slug), locale });
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={who.displayName}
      active="people"
      waiting={p.waiting}
      meetings={p.home.meetingsEnabled}
    >
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Avatar
            initials={initials(who.displayName)}
            label={who.displayName}
            tone={avatarTone(who.id)}
            size={48}
            decorative
          />
          <div className="flex min-w-0 flex-col gap-1">
            {who.headline || who.company ? (
              <p className="text-body font-bold text-ink">
                {[who.headline, who.company].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {who.connection === 'connected' ? (
              <StatusPill tone="success" label={t('status.connected')} className="self-start" />
            ) : null}
          </div>
        </div>
        {who.bio ? <p className="text-prose whitespace-pre-line text-ink">{who.bio}</p> : null}
        {who.interests.length ? (
          <div className="flex flex-col gap-1.5">
            <h2 className="text-label text-ink-2">{t('people.interests')}</h2>
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {who.interests.map((i) => (
                <li key={i} className="rounded-pill bg-surface-3 px-2.5 py-1 text-caption text-ink">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <section aria-labelledby="connect-heading" className="flex flex-col gap-3">
        <h2 id="connect-heading" className="text-section">
          {t('person.connectHeading')}
        </h2>
        {who.connection === 'none' ? (
          <ConnectForm action={connectAction.bind(null, slug, who.id)} personName={who.displayName} />
        ) : who.connection === 'pending_out' && who.connectionId ? (
          <div className="flex flex-col gap-2">
            <StatusPill tone="waiting" label={t('status.pendingOut')} className="self-start" />
            <ActionButton
              action={withdrawConnectionAction.bind(null, slug, who.connectionId)}
              label={t('connections.withdraw')}
              done={t('connections.withdrawn')}
            />
          </div>
        ) : who.connection === 'pending_in' && who.connectionId ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-ink">{t('person.wantsToConnect', { name: who.displayName })}</p>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={respondConnectionAction.bind(null, slug, who.connectionId, true)}
                label={t('connections.accept')}
                done={t('connections.accepted', { name: who.displayName })}
                variant="primary"
              />
              <ActionButton
                action={respondConnectionAction.bind(null, slug, who.connectionId, false)}
                label={t('connections.decline')}
                done={t('connections.declined')}
              />
            </div>
          </div>
        ) : (
          <p className="text-body text-ink-2">{t('person.connectedHelp', { name: who.displayName })}</p>
        )}
      </section>

      {options ? (
        <section aria-labelledby="meet-heading" className="flex flex-col gap-3">
          <h2 id="meet-heading" className="text-section">
            {t('person.meetHeading')}
          </h2>
          {options.slots.length === 0 || options.locations.length === 0 ? (
            <p className="text-body text-ink-2">{t('person.noSlots')}</p>
          ) : (
            <>
              <p className="text-body text-ink-2">
                {t('person.meetHelp', { timezone: p.target.timeZone.replace(/_/g, ' ') })}
              </p>
              <MeetingRequestForm
                action={requestMeetingAction.bind(null, slug, who.id)}
                personName={who.displayName}
                slots={options.slots.map((s) => ({
                  value: s.id,
                  label: slotLabel(locale, p.target.timeZone, s.startsAt, s.endsAt),
                }))}
                locations={options.locations.map((l) => ({
                  value: l.id,
                  label: `${l.name} (${t(`kind.${l.kind}`)})`,
                }))}
              />
            </>
          )}
        </section>
      ) : null}

      <SafetyForms
        block={blockAction.bind(null, slug, who.id)}
        report={reportAction.bind(null, slug, who.id)}
        personName={who.displayName}
        reasons={REPORT_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) }))}
        after={{ blocked: `${directory}?notice=blocked`, reported: `${directory}?notice=reported` }}
      />
    </NetworkShell>
  );
}
