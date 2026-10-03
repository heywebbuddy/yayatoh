import { guestListQuery, type PartyRsvpDetailDto, partyRsvpQuery, rsvpOverviewQuery } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  createRsvpLinksAction,
  markRsvpSentAction,
  reopenRsvpAction,
  resetRsvpLinkAction,
  resetRsvpPinAction,
} from '../actions.ts';
import { CopyLink } from '../copy-link.tsx';
import { rsvpFindUrl, rsvpUrl } from '../links.ts';

const UUID = /^[0-9a-f-]{36}$/;
const pill = 'rounded-pill px-2 py-px text-caption';

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
  const findUrl = ov.settings.nameLookup && detail?.lookupCode ? rsvpFindUrl(detail.lookupCode) : null;
  const act = (action: typeof resetRsvpPinAction, id: string, label: string, done: string, hint?: string) => (
    <div className="flex flex-col gap-1">
      {hint ? <p className="text-caption text-ink-2">{hint}</p> : null}
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
        <PageHeader title={t('partyTitle', { party: name })} description={t('partySubtitle')} />
      </div>
      <Link
        href={`/o/${org}/e/${event}/guests/rsvp`}
        className="min-h-6 self-start py-1 text-caption underline print:hidden"
      >
        {t('backToRsvp')}
      </Link>

      <section aria-labelledby="party-state-heading" className="flex flex-col gap-3 print:hidden">
        <h2 id="party-state-heading" className="text-section">
          {t('stateTitle')}
        </h2>
        <Card className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2 text-body">
            <span data-testid="party-rsvp-state" className={`${pill} bg-surface-3 text-ink-2`}>
              {t(`states.${summary.state}`)}
            </span>
            {summary.reopened ? (
              <span className={`${pill} bg-primary-soft text-primary-ink`}>{t('reopened')}</span>
            ) : null}
          </p>
          {detail ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption text-ink-2">
              {(
                [
                  ['sentAt', detail.sentAt],
                  ['viewedAt', detail.viewedAt],
                  ['respondedAt', detail.respondedAt],
                ] as const
              ).map(([k, v]) =>
                v ? (
                  <div key={k} className="contents">
                    <dt>{t(k)}</dt>
                    <dd className="text-ink">{fmt(v)}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : null}
          {summary.subEvents.length ? (
            <ul className="flex list-none flex-col gap-0.5 p-0 text-caption text-ink-2">
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
            <p className="text-caption text-ink-2">{t('notInvited')}</p>
          )}
        </Card>
      </section>

      {detail && !detail.token ? (
        <Card size="panel" className="flex flex-col gap-3 print:hidden">
          <p className="text-body">{t('noLinkYet')}</p>
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
        <>
          <section aria-labelledby="party-link-heading" className="flex flex-col gap-3 print:hidden">
            <h2 id="party-link-heading" className="text-section">
              {t('linkTitle')}
            </h2>
            <CopyLink label={t('linkLabel', { party: name })} url={url} />
            <p className="text-caption text-ink-2">
              {t('linkExpires', { date: fmt(detail.linkExpiresAt) ?? '' })}
            </p>
          </section>

          <section aria-labelledby="party-card-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <h2 id="party-card-heading" className="text-section">
                {t('cardTitle')}
              </h2>
              <PrintButton label={t('print')} />
            </div>
            <Card className="flex flex-col items-center gap-4 text-center">
              <p className="text-section">{ev.name}</p>
              <p className="text-body">{name}</p>
              <svg
                role="img"
                aria-label={t('qrLabel', { party: name })}
                data-testid="party-rsvp-qr"
                data-url={url}
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                shapeRendering="crispEdges"
                className="aspect-square w-full max-w-64 text-ink"
              >
                <rect width={qr.size} height={qr.size} className="fill-white" />
                <path d={qr.d} fill="currentColor" />
              </svg>
              <p className="text-body">{t('cardScan')}</p>
              {findUrl ? (
                <p className="text-caption text-ink-2">
                  {t('cardFallback')}{' '}
                  <span data-testid="party-rsvp-find-url" dir="ltr" className="font-mono break-all text-ink">
                    {findUrl}
                  </span>{' '}
                  {t('cardFallbackEnd')}
                </p>
              ) : null}
              <p className="text-body">
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

          <section aria-labelledby="party-tools-heading" className="flex flex-col gap-3 print:hidden">
            <h2 id="party-tools-heading" className="text-section">
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
        </>
      ) : null}
    </>
  );
}
