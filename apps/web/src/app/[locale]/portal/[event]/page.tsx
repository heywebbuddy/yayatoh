import { Avatar, Button, buttonClass, Label } from '@yayatoh/ui';
import { CalendarDays, House, Map as MapIcon, Ticket, User } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatDate } from '@/lib/format.ts';
import { publicDemoOverlay } from '@/server/demo.ts';

export default async function AttendeePortal({
  params,
}: {
  params: Promise<{ locale: string; event: string }>;
}) {
  const { locale, event } = await params;
  setRequestLocale(locale);
  // The attendee portal needs tickets and attendee sign-in (M1.5+); dev/preview shows the demo.
  const ev = publicDemoOverlay(event);
  const me = ev?.attendees[0];
  if (!ev || !me) notFound();
  const t = await getTranslations();
  const f = { locale, currency: ev.currency, timeZone: ev.timezone };
  const first = me.name.split(' ')[0] ?? me.name;
  const tabs = [
    { key: 'home', Icon: House, href: '#main' },
    { key: 'agenda', Icon: CalendarDays, href: '#today-heading' },
    { key: 'ticket', Icon: Ticket, href: '#ticket' },
    { key: 'map', Icon: MapIcon, href: null },
    { key: 'profile', Icon: User, href: null },
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-5 pt-5">
        <span className="text-[19px] font-semibold tracking-[-0.04em]">{t('brand.wordmark')}</span>
        <Avatar
          initials={me.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)}
          label={me.name}
        />
      </header>
      <main id="main" className="flex flex-1 flex-col gap-5 px-5 pt-6 pb-28">
        <div className="flex flex-col gap-2">
          <Label>{t('portal.day', { day: 1, date: formatDate(ev.startsAt, f) })}</Label>
          <h1 className="text-[34px] leading-[1.05] font-light tracking-[-0.04em]">
            {t('greeting.morning', { name: first })}
          </h1>
        </div>
        <section
          id="ticket"
          aria-label={t('portal.yourTicket')}
          className="flex flex-col gap-4 rounded-panel bg-ink p-5 text-white"
        >
          <Label tone="inverse">{ev.name}</Label>
          <p className="text-[28px] font-light tracking-[-0.03em]">{me.ticketType}</p>
          <p className="text-body text-white/70">{me.seat}</p>
          <Button variant="on-dark" disabled title={t('common.comingSoon')} className="self-start">
            {t('portal.addToWallet')}
          </Button>
        </section>
        <section aria-labelledby="today-heading" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 id="today-heading" className="text-section">
              {t('portal.today')}
            </h2>
            <a href={`/events/${ev.slug}#agenda`} className={buttonClass('ghost', 'sm')}>
              {t('portal.fullAgenda')}
            </a>
          </div>
          <ul className="list-none divide-y divide-zinc-100 rounded-card border border-zinc-200 bg-white p-0">
            {ev.agenda.map((s) => (
              <li key={s.time} className="flex gap-4 px-4 py-3.5">
                <span className="w-12 font-mono text-caption text-zinc-500">{s.time}</span>
                <span className="flex flex-1 flex-col">
                  <span>{s.title}</span>
                  <span className="text-caption text-zinc-500">{s.room}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <nav
        aria-label={t('portal.app')}
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-[430px] justify-around border-t border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur"
      >
        {tabs.map(({ key, Icon, href }) =>
          href ? (
            <a
              key={key}
              href={href}
              aria-label={t(`portal.tabs.${key}`)}
              aria-current={key === 'home' ? 'page' : undefined}
              className={`flex size-11 items-center justify-center rounded-pill ${key === 'home' ? 'bg-zinc-100' : ''}`}
            >
              <Icon aria-hidden="true" className="size-5" strokeWidth={1.6} />
            </a>
          ) : (
            <button
              key={key}
              type="button"
              disabled
              aria-label={t(`portal.tabs.${key}`)}
              title={t('common.comingSoon')}
              className="flex size-11 items-center justify-center rounded-pill text-zinc-400"
            >
              <Icon aria-hidden="true" className="size-5" strokeWidth={1.6} />
            </button>
          ),
        )}
      </nav>
    </div>
  );
}
