import { type SessionAttendanceDto, sessionAttendanceQuery } from '@yayatoh/checkin';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { appOrigin } from '@/server/tenant-return.ts';

/**
 * M5.6a: the printable self check-in flyer of a session door: a QR to the public check-in page
 * (attendance only, no gating) with the session's title, time and room.
 */
export default async function SessionFlyerPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; checkpoint: string }>;
}) {
  const { locale, org, event, checkpoint } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  const back = (
    <Link
      href={`/o/${org}/e/${event}/onsite/sessions`}
      className="self-start text-body underline print:hidden"
    >
      {t('sessionCheckin.backToSessions')}
    </Link>
  );
  let doors: SessionAttendanceDto[];
  try {
    doors = await executeQuery(sessionAttendanceQuery, { eventId: ev.id }, data.ctx, ports);
  } catch {
    return (
      <>
        <PageHeader title={t('sessionCheckin.flyerTitle')} />
        <EmptyState
          title={t('checkin.noAccessTitle')}
          description={t('checkin.noAccessDescription')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {t('emptyActions.eventHome')}
            </Link>
          }
        />
      </>
    );
  }
  const door = doors.find((d) => d.checkpointId === checkpoint);
  if (!door) notFound();
  if (!door.selfCheckinToken)
    return (
      <>
        <PageHeader title={t('sessionCheckin.flyerTitle')} />
        {back}
        <EmptyState
          title={t('sessionCheckin.flyerOffTitle')}
          description={t('sessionCheckin.flyerOffDescription')}
          action={
            <Link href={`/o/${org}/e/${event}/onsite/sessions`} className={buttonClass('primary', 'md')}>
              {t('sessionCheckin.title')}
            </Link>
          }
        />
      </>
    );
  const url = `${appOrigin().replace(/\/$/, '')}/${locale}/session-checkin/${door.selfCheckinToken}`;
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <PrintButton label={t('sessionCheckin.print')} />
      </div>
      <Card
        className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 text-center"
        data-testid="flyer"
      >
        <p className="text-label uppercase text-ink-2">{ev.name}</p>
        <h1 className="text-title">{door.title}</h1>
        <p className="text-body text-ink-2">
          {when.formatRange(door.startsAt, door.endsAt)}
          {door.roomName ? ` · ${door.roomName}` : ''}
        </p>
        <TicketQr
          code={url}
          label={t('sessionCheckin.flyerQr', { title: door.title })}
          className="w-64 max-w-full text-ink"
        />
        <p className="text-section">{t('sessionCheckin.flyerCall')}</p>
        <p className="text-body text-ink-2">{t('sessionCheckin.flyerHint')}</p>
        <p className="font-mono text-caption break-all text-ink-2" data-testid="flyer-url">
          {url}
        </p>
      </Card>
    </>
  );
}
