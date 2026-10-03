import {
  type CollectorSubmissionDto,
  collectorQueueQuery,
  collectorSettingsQuery,
  guestListQuery,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Alert, Button, buttonClass, Card, CardHeader, EmptyState, PageHeader, Select, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { CopyLink } from '../rsvp/copy-link.tsx';
import { collectUrl } from '../rsvp/links.ts';
import { GuestsCrumbs } from '../rsvp/nav.tsx';
import { approveSubmissionAction, rejectSubmissionAction, setCollectorAction } from './actions.ts';

const DECIDED_TONE = {
  pending: 'waiting',
  approved: 'success',
  merged: 'info',
  rejected: 'neutral',
} as const;

/**
 * The contact collector (M4.1f): switch the public link on or off, share it (copy, QR code to
 * print), and work the approval queue: approve a household into a new party, compare and merge
 * it into an existing one field by field, or reject it. Nothing reaches the guest list without
 * one of these. `guests:write` decides; viewers read the queue.
 */
export default async function CollectorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ done?: string; party?: string }>;
}) {
  const { locale, org, event } = await params;
  const { done, party: doneParty } = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('collectorHost');
  const tr = await getTranslations();
  const canWrite = can('guests:write');
  const [settings, queue, list] = await Promise.all([
    executeQuery(collectorSettingsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(collectorQueueQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(guestListQuery, { eventId: ev.id, limit: 1 }, data.ctx, ports),
  ]);
  const base = `/o/${org}/e/${event}/guests`;
  const url = settings.code ? collectUrl(settings.code) : null;
  const qr = url && settings.enabled ? qrPath(url) : null;
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: ev.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  const partyName = new Map(list.partyOptions.map((p) => [p.id, p.name]));

  const details = (s: CollectorSubmissionDto) => (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-tile bg-surface-2 px-4 py-3 text-caption text-ink [&_dd]:m-0 [&_dt]:font-bold [&_dt]:text-ink-2">
      <dt>{t('people')}</dt>
      <dd>{s.members.map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join(', ')}</dd>
      {s.address ? (
        <>
          <dt>{t('address')}</dt>
          <dd className="whitespace-pre-line">{s.address}</dd>
        </>
      ) : null}
      {s.email ? (
        <>
          <dt>{t('email')}</dt>
          <dd dir="ltr" className="break-all">
            {s.email}
          </dd>
        </>
      ) : null}
      {s.phone ? (
        <>
          <dt>{t('phone')}</dt>
          <dd dir="ltr">{s.phone}</dd>
        </>
      ) : null}
      {s.note ? (
        <>
          <dt>{t('note')}</dt>
          <dd className="whitespace-pre-line">{s.note}</dd>
        </>
      ) : null}
    </dl>
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
              trail={[{ label: t('title') }]}
            />
          }
          title={t('title')}
          description={t('subtitle')}
        />
      </div>
      {canWrite ? null : (
        <div className="print:hidden">
          <Alert tone="info" title={t('viewerNotice')} />
        </div>
      )}
      {done === 'approved' || done === 'merged' || done === 'rejected' ? (
        <div className="print:hidden" data-testid="collector-done">
          <Alert
            tone={done === 'rejected' ? 'info' : 'success'}
            title={t(`done.${done}`, { party: (doneParty && partyName.get(doneParty)) || '' })}
          >
            {doneParty && partyName.get(doneParty) ? (
              <Link
                href={`${base}/rsvp/${doneParty}`}
                className="inline-flex min-h-6 items-center font-bold text-primary-ink underline underline-offset-2"
              >
                {t('openParty', { party: partyName.get(doneParty) ?? '' })}
              </Link>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <section
        aria-labelledby="collector-link-heading"
        className={`grid items-start gap-5 print:block ${qr && url ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]' : ''}`}
      >
        <Card size="panel" className="flex flex-col gap-4 print:hidden">
          <CardHeader id="collector-link-heading" title={t('linkTitle')} />
          <p
            className="m-0 flex items-start gap-2.5 text-body font-semibold text-ink"
            data-testid="collector-state"
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${settings.enabled ? 'bg-success-dot' : 'bg-ink-3'}`}
            />
            {settings.enabled ? t('on') : t('off')}
          </p>
          {settings.enabled && url ? <CopyLink label={t('linkLabel')} url={url} /> : null}
          {canWrite ? (
            <ProgramForm
              action={setCollectorAction.bind(null, org, event, !settings.enabled)}
              fields={[]}
              idPrefix="collector-toggle"
              submitLabel={settings.enabled ? t('turnOff') : t('turnOn')}
              successLabel={settings.enabled ? t('turnedOn') : t('turnedOff')}
              errors={{}}
            />
          ) : null}
        </Card>
        {qr && url ? (
          <Card
            // Printed and pinned up: always the light theme (ADR 0022).
            data-theme="light"
            size="panel"
            className="flex flex-col items-center gap-4 text-center"
          >
            <p className="m-0 text-section text-ink">{ev.name}</p>
            <p className="m-0 text-body font-bold text-ink">{t('cardText')}</p>
            <svg
              role="img"
              aria-label={t('qrLabel')}
              data-testid="collector-qr"
              data-url={url}
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              shapeRendering="crispEdges"
              className="aspect-square w-full max-w-64 text-black"
            >
              <rect width={qr.size} height={qr.size} className="fill-white" />
              <path d={qr.d} fill="currentColor" />
            </svg>
            <p dir="ltr" className="m-0 font-mono text-caption break-all text-ink">
              {url}
            </p>
            <div className="print:hidden">
              <PrintButton label={t('print')} />
            </div>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="collector-queue-heading" className="flex flex-col gap-3 print:hidden">
        <h2 id="collector-queue-heading" className="m-0 text-section text-ink">
          {t('queueTitle', { count: queue.pending.length })}
        </h2>
        {queue.pending.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={settings.enabled ? t('emptyOn') : t('emptyOff')}
            action={
              settings.enabled || canWrite ? (
                <Link
                  href={`${base}/collector#collector-link-heading`}
                  className={buttonClass('primary', 'md')}
                >
                  {settings.enabled ? t('shareLink') : t('setUpLink')}
                </Link>
              ) : (
                <Link href={base} className={buttonClass('primary', 'md')}>
                  {t('back')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {queue.pending.map((s) => (
              <li key={s.id}>
                <Card size="panel">
                  <article aria-labelledby={`sub-${s.id}`} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id={`sub-${s.id}`} className="m-0 grow text-card text-ink">
                        {s.household}
                      </h3>
                      <span className="text-caption text-ink-2 tabular-nums">
                        {t('submitted', { date: fmt(s.submittedAt) })}
                      </span>
                    </div>
                    {details(s)}
                    {canWrite ? (
                      <div className="flex flex-col gap-4 border-t border-line pt-4">
                        <ProgramForm
                          action={approveSubmissionAction.bind(null, org, event, s.id)}
                          fields={[]}
                          idPrefix={`approve-${s.id}`}
                          submitLabel={t('approve', { household: s.household ?? '' })}
                          successLabel={t('approved')}
                          errors={{ too_many: t('errors.tooMany') }}
                        />
                        {list.partyOptions.length ? (
                          <form
                            method="get"
                            action={`collector/${s.id}`}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <div className="flex flex-col gap-1.5">
                              <label htmlFor={`merge-${s.id}`} className="text-[13px] font-bold text-ink">
                                {t('mergeInto')}
                              </label>
                              <Select id={`merge-${s.id}`} name="party" className="field pe-9">
                                {list.partyOptions.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <Button type="submit" variant="secondary">
                              {t('compare', { household: s.household ?? '' })}
                            </Button>
                          </form>
                        ) : null}
                        <ProgramForm
                          action={rejectSubmissionAction.bind(null, org, event, s.id)}
                          fields={[]}
                          idPrefix={`reject-${s.id}`}
                          submitLabel={t('reject', { household: s.household ?? '' })}
                          successLabel={t('rejected')}
                          errors={{}}
                        />
                      </div>
                    ) : null}
                  </article>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {queue.decided.length ? (
        <section aria-labelledby="collector-decided-heading" className="flex flex-col gap-3 print:hidden">
          <h2 id="collector-decided-heading" className="m-0 text-section text-ink">
            {t('decidedTitle')}
          </h2>
          <ul className="m-0 flex list-none flex-col rounded-card border border-line bg-surface px-4 py-1 text-body elevation-card glass">
            {queue.decided.map((s) => (
              <li
                key={s.id}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-0"
              >
                <StatusPill tone={DECIDED_TONE[s.status]} label={t(`status.${s.status}`)} />
                <span className="text-caption text-ink-2 tabular-nums">
                  {s.decidedAt ? fmt(s.decidedAt) : ''}
                </span>
                {s.partyId && partyName.get(s.partyId) ? (
                  <Link
                    href={`${base}/rsvp/${s.partyId}`}
                    className="inline-flex min-h-6 items-center text-caption font-bold text-primary-ink underline-offset-2 hover:underline"
                  >
                    {partyName.get(s.partyId)}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
