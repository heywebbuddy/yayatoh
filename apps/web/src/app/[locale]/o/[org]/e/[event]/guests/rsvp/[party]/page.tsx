import { guestListQuery, type PartyRsvpDetailDto, partyRsvpQuery, rsvpOverviewQuery } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Card, CardHeader, PageHeader, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { PartyInvite } from '../../invitations/party-invite.tsx';
import { RSVP_STATE_TONE } from '../../party-rsvp.tsx';
import {
  createRsvpLinksAction,
  markRsvpSentAction,
  reopenRsvpAction,
  resetRsvpLinkAction,
  resetRsvpPinAction,
} from '../actions.ts';
import { CopyLink } from '../copy-link.tsx';
import { hubUrl, rsvpFindUrl, rsvpUrl } from '../links.ts';
import { GuestsCrumbs } from '../nav.tsx';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * One party's RSVP (M4.1d): its state and answers per sub-event, and for hosts who edit guests
 * its link (copy), the same link as a QR code with the PIN for the printed invitation, and the
 * tools: mark as sent, reset the PIN, reset the link (old links and QR codes stop working) and
 * reopen after the deadline. Viewers see the state only.
 */
export default async function PartyRsvpPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; party: string }>;
}) {
  const { locale, org, event, party } = await params;
  setRequestLocale(locale);
  if (!UUID.test(party)) notFound();
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('rsvpHost');
  const tr = await getTranslations();
  const canWrite = can('guests:write');
  const [list, ov] = await Promise.all([
    executeQuery(guestListQuery, { eventId: ev.id, limit: 1 }, data.ctx, ports),
    executeQuery(rsvpOverviewQuery, { eventId: ev.id, partyIds: [party] }, data.ctx, ports),
  ]);
  const name = list.partyOptions.find((p) => p.id === party)?.name;
  const summary = ov.parties[0];
  if (!name || !summary) notFound();
  const detail: PartyRsvpDetailDto | null = canWrite
    ? await executeQuery(partyRsvpQuery, { eventId: ev.id, partyId: party }, data.ctx, ports)
    : null;
  const subName = new Map(ov.subEvents.map((s) => [s.id, s.name]));
  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(locale, {
          timeZone: ev.timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(d)
      : null;
  const url = detail?.token ? rsvpUrl(detail.token) : null;
  const qr = url ? qrPath(url) : null;
  const hub = detail?.token ? hubUrl(detail.token) : null;
  const findUrl = ov.settings.nameLookup && detail?.lookupCode ? rsvpFindUrl(detail.lookupCode) : null;
  const act = (action: typeof resetRsvpPinAction, id: string, label: string, done: string, hint?: string) => (
    <div className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
      {hint ? <p className="m-0 text-caption text-ink-2">{hint}</p> : null}
      <ProgramForm
        action={action.bind(null, org, event, party)}
        fields={[]}
        idPrefix={`rsvp-${id}`}
        submitLabel={label}
        successLabel={done}
        errors={{}}
      />
    </div>
  );

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          breadcrumb={
            <GuestsCrumbs
              org={org}
              event={event}
              orgName={data.org.name}
              eventName={ev.name}
              guestsLabel={tr(navLabelKey(profile, nav))}
              trail={[{ label: t('title'), href: `/o/${org}/e/${event}/guests/rsvp` }, { label: name }]}
            />
          }
          title={t('partyTitle', { party: name })}
          description={t('partySubtitle')}
        />
      </div>

      <div className="grid items-start gap-5 print:block lg:grid-cols-2">
        <section aria-labelledby="party-state-heading" className="flex flex-col gap-3 print:hidden">
          <h2 id="party-state-heading" className="m-0 text-section text-ink">
            {t('stateTitle')}
          </h2>
          <Card size="panel" className="flex flex-col gap-3">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span data-testid="party-rsvp-state" className="inline-flex">
                <StatusPill tone={RSVP_STATE_TONE[summary.state]} label={t(`states.${summary.state}`)} />
              </span>
              {summary.reopened ? <StatusPill tone="brand" label={t('reopened')} /> : null}
            </p>
            {detail ? (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption text-ink-2">
                {(
                  [
                    ['sentAt', detail.sentAt],
                    ['viewedAt', detail.viewedAt],
                    ['respondedAt', detail.respondedAt],
                  ] as const
                ).map(([k, v]) =>
                  v ? (
                    <div key={k} className="contents">
                      <dt className="font-bold">{t(k)}</dt>
                      <dd className="m-0 text-ink tabular-nums">{fmt(v)}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            ) : null}
            {summary.subEvents.length ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 border-t border-line p-0 pt-3 text-caption text-ink-2 tabular-nums">
                {summary.subEvents.map((s) => (
                  <li key={s.subEventId}>
                    {t('tally', {
                      name: subName.get(s.subEventId) ?? '',
                      attending: s.attending,
                      declined: s.declined,
                      awaiting: s.awaiting,
                    })}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-caption text-ink-2">{t('notInvited')}</p>
            )}
          </Card>
        </section>

        <PartyInvite
          org={org}
          event={event}
          eventId={ev.id}
          partyId={party}
          partyName={name}
          timeZone={ev.timezone}
          locale={locale}
          canWrite={canWrite}
          ctx={data.ctx}
        />
      </div>

      {detail && !detail.token ? (
        <Card size="panel" className="flex flex-col gap-3 print:hidden">
          <p className="m-0 text-body text-ink">{t('noLinkYet')}</p>
          <ProgramForm
            action={createRsvpLinksAction.bind(null, org, event, party)}
            fields={[]}
            idPrefix="rsvp-create-link"
            submitLabel={t('createLink')}
            successLabel={t('linkCreated')}
            errors={{}}
          />
        </Card>
      ) : null}

      {detail && url && qr ? (
        <div className="grid items-start gap-5 print:block lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="flex min-w-0 flex-col gap-5 print:hidden">
            <section aria-labelledby="party-link-heading" className="flex flex-col gap-3">
              <h2 id="party-link-heading" className="m-0 text-section text-ink">
                {t('linkTitle')}
              </h2>
              <Card size="panel" className="flex flex-col gap-3">
                <CopyLink label={t('linkLabel', { party: name })} url={url} />
                <p className="m-0 text-caption text-ink-2">
                  {t('linkExpires', { date: fmt(detail.linkExpiresAt) ?? '' })}
                </p>
                {/* M4.7a: the party's guest page (same key as the RSVP link). */}
                {hub ? (
                  <>
                    <CopyLink label={t('hubLinkLabel', { party: name })} url={hub} />
                    <p className="m-0 text-caption text-ink-2">{t('hubLinkHint')}</p>
                  </>
                ) : null}
              </Card>
            </section>

            <section aria-labelledby="party-tools-heading" className="flex flex-col gap-3">
              <h2 id="party-tools-heading" className="m-0 text-section text-ink">
                {t('toolsTitle')}
              </h2>
              <Card size="panel" className="flex flex-col gap-4">
                {detail.sentAt
                  ? null
                  : act(markRsvpSentAction, 'sent', t('markSent'), t('markedSent'), t('markSentHint'))}
                {act(resetRsvpPinAction, 'pin', t('resetPin'), t('pinReset'), t('resetPinHint'))}
                {act(resetRsvpLinkAction, 'link', t('resetLink'), t('linkReset'), t('resetLinkHint'))}
                {ov.locked && !summary.reopened
                  ? act(reopenRsvpAction, 'reopen', t('reopen'), t('reopenedDone'), t('reopenHint'))
                  : null}
              </Card>
            </section>
          </div>

          <section aria-labelledby="party-card-heading" className="flex flex-col gap-3">
            <div className="print:hidden">
              <CardHeader
                id="party-card-heading"
                title={t('cardTitle')}
                actions={<PrintButton label={t('print')} />}
              />
            </div>
            <Card
              // Printed on the invitation: always the light theme (ADR 0022).
              data-theme="light"
              size="panel"
              className="flex flex-col items-center gap-4 text-center print:border-0 print:shadow-none"
            >
              <p className="m-0 text-section text-ink">{ev.name}</p>
              <p className="m-0 text-body font-bold text-ink">{name}</p>
              <svg
                role="img"
                aria-label={t('qrLabel', { party: name })}
                data-testid="party-rsvp-qr"
                data-url={url}
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                shapeRendering="crispEdges"
                className="aspect-square w-full max-w-64 text-black"
              >
                <rect width={qr.size} height={qr.size} className="fill-white" />
                <path d={qr.d} fill="currentColor" />
              </svg>
              <p className="m-0 text-body font-bold text-ink">{t('cardScan')}</p>
              {findUrl ? (
                <p className="m-0 text-caption text-ink-2">
                  {t('cardFallback')}{' '}
                  <span data-testid="party-rsvp-find-url" dir="ltr" className="font-mono break-all text-ink">
                    {findUrl}
                  </span>{' '}
                  {t('cardFallbackEnd')}
                </p>
              ) : null}
              <p className="m-0 text-body text-ink">
                {t('pinLabel')}{' '}
                <span
                  data-testid="party-rsvp-pin"
                  dir="ltr"
                  className="font-mono text-section tracking-[0.3em]"
                >
                  {detail.pin}
                </span>
              </p>
            </Card>
          </section>
        </div>
      ) : null}
    </>
  );
}
