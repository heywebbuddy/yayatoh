import {
  type CollectorSubmissionDto,
  collectorQueueQuery,
  collectorSettingsQuery,
  guestListQuery,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Alert, Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { CopyLink } from '../rsvp/copy-link.tsx';
import { collectUrl } from '../rsvp/links.ts';
import { approveSubmissionAction, rejectSubmissionAction, setCollectorAction } from './actions.ts';

const pill = 'rounded-pill px-2 py-px text-caption';
const control = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

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
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
      <dt className="text-zinc-600">{t('people')}</dt>
      <dd>{s.members.map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join(', ')}</dd>
      {s.address ? (
        <>
          <dt className="text-zinc-600">{t('address')}</dt>
          <dd className="whitespace-pre-line">{s.address}</dd>
        </>
      ) : null}
      {s.email ? (
        <>
          <dt className="text-zinc-600">{t('email')}</dt>
          <dd dir="ltr" className="break-all">
            {s.email}
          </dd>
        </>
      ) : null}
      {s.phone ? (
        <>
          <dt className="text-zinc-600">{t('phone')}</dt>
          <dd dir="ltr">{s.phone}</dd>
        </>
      ) : null}
      {s.note ? (
        <>
          <dt className="text-zinc-600">{t('note')}</dt>
          <dd className="whitespace-pre-line">{s.note}</dd>
        </>
      ) : null}
    </dl>
  );

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t('title')} description={t('subtitle')} />
      </div>
      <Link href={base} className="min-h-6 self-start py-1 text-caption underline print:hidden">
        {t('back')}
      </Link>
      {canWrite ? null : <p className="text-body text-zinc-500 print:hidden">{t('viewerNotice')}</p>}
      {done === 'approved' || done === 'merged' || done === 'rejected' ? (
        <div className="print:hidden" data-testid="collector-done">
          <Alert
            tone="info"
            title={t(`done.${done}`, { party: (doneParty && partyName.get(doneParty)) || '' })}
          >
            {doneParty && partyName.get(doneParty) ? (
              <Link href={`${base}/rsvp/${doneParty}`} className="min-h-6 py-1 underline">
                {t('openParty', { party: partyName.get(doneParty) ?? '' })}
              </Link>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <section aria-labelledby="collector-link-heading" className="flex flex-col gap-3">
        <h2 id="collector-link-heading" className="text-section print:hidden">
          {t('linkTitle')}
        </h2>
        <Card size="panel" className="flex flex-col gap-3 print:hidden">
          <p className="text-body" data-testid="collector-state">
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
          <Card className="flex flex-col items-center gap-4 text-center">
            <p className="text-section">{ev.name}</p>
            <p className="text-body">{t('cardText')}</p>
            <svg
              role="img"
              aria-label={t('qrLabel')}
              data-testid="collector-qr"
              data-url={url}
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              shapeRendering="crispEdges"
              className="aspect-square w-full max-w-64 text-ink"
            >
              <rect width={qr.size} height={qr.size} className="fill-white" />
              <path d={qr.d} fill="currentColor" />
            </svg>
            <p dir="ltr" className="font-mono text-caption break-all">
              {url}
            </p>
            <div className="print:hidden">
              <PrintButton label={t('print')} />
            </div>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="collector-queue-heading" className="flex flex-col gap-3 print:hidden">
        <h2 id="collector-queue-heading" className="text-section">
          {t('queueTitle', { count: queue.pending.length })}
        </h2>
        {queue.pending.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={settings.enabled ? t('emptyOn') : t('emptyOff')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {queue.pending.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-3">
                  <article aria-labelledby={`sub-${s.id}`} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 id={`sub-${s.id}`} className="text-body font-medium">
                        {s.household}
                      </h3>
                      <span className="text-caption text-zinc-600">
                        {t('submitted', { date: fmt(s.submittedAt) })}
                      </span>
                    </div>
                    {details(s)}
                    {canWrite ? (
                      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3">
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
                              <label htmlFor={`merge-${s.id}`} className="text-caption text-zinc-600">
                                {t('mergeInto')}
                              </label>
                              <select id={`merge-${s.id}`} name="party" className={control}>
                                {list.partyOptions.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
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
          <h2 id="collector-decided-heading" className="text-section">
            {t('decidedTitle')}
          </h2>
          <ul className="flex list-none flex-col gap-1 p-0 text-body">
            {queue.decided.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className={`${pill} bg-zinc-100 text-zinc-700`}>{t(`status.${s.status}`)}</span>
                <span className="text-caption text-zinc-600">{s.decidedAt ? fmt(s.decidedAt) : ''}</span>
                {s.partyId && partyName.get(s.partyId) ? (
                  <Link href={`${base}/rsvp/${s.partyId}`} className="min-h-6 py-1 text-caption underline">
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
