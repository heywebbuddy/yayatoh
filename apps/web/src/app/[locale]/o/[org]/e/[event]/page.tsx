import { formatMoney, money } from '@yayatoh/kernel';
import {
  buttonClass,
  Card,
  Donut,
  Label,
  LineChart,
  PageHeader,
  ProgressRing,
  swatchClass,
} from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { demoEvent } from '@/demo/events.ts';
import { Link } from '@/i18n/navigation.ts';
import { greetingKey } from '@/lib/event-status.ts';
import { type FormatCtx, formatEventDateRange, formatNumber, formatParams } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';

export default async function EventDashboard({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const ev = demoEvent(org, event);
  if (!ev) notFound();
  const t = await getTranslations();
  const f: FormatCtx = { locale, currency: ev.currency, timeZone: ev.timezone };
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  const done = ev.readiness.filter((r) => r.done).length;
  const readiness = Math.round((done / ev.readiness.length) * 100);
  const mixTotal = ev.mix.reduce((a, m) => a + m.value, 0);

  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(ev.timezone)}`, { name: firstName })}
        description={`${ev.name} · ${formatEventDateRange(ev.startsAt, ev.endsAt, f)} · ${ev.venue}, ${ev.city}`}
        actions={
          <>
            <Link href={`/events/${ev.slug}`} className={buttonClass('secondary')}>
              {t('dashboard.previewPage')}
            </Link>
            <Link href={`/o/${org}/e/${event}/analysis`} className={buttonClass('primary')}>
              {t('dashboard.openCommandCenter')}
            </Link>
          </>
        }
      />

      <section
        aria-label={t('dashboard.keyNumbers')}
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        {ev.kpis.map((k) => (
          <Card key={k.key} className="flex flex-col gap-2.5 px-[22px]">
            <Label>{t(`kpi.${k.key}`)}</Label>
            <p className="text-[36px] leading-none font-light tracking-[-0.045em] tabular-nums">
              {k.kind === 'money'
                ? formatMoney(money(k.value, ev.currency), locale).replace(/\.00$/, '')
                : formatNumber(k.value, locale)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-zinc-500">
              <span>{t(k.note.key, formatParams(k.note.params, f))}</span>
              <span className="inline-flex items-center gap-1.5 text-zinc-700">
                <span aria-hidden="true" className={`size-1.5 rounded-full ${swatchClass(k.delta.tone)}`} />
                {t(k.delta.key, formatParams(k.delta.params, f))}
              </span>
            </div>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-section">{t('dashboard.registrationsTrend')}</h2>
            <ul className="ms-auto flex list-none gap-3.5 p-0">
              {ev.trend.series.map((s) => (
                <li key={s.label} className="inline-flex items-center gap-1.5 text-caption text-zinc-600">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${swatchClass(s.tone)}`} />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
          <LineChart
            title={t('dashboard.registrationsTrend')}
            series={ev.trend.series}
            xLabels={ev.trend.labels}
          />
          <p className="text-center font-mono text-label uppercase text-zinc-500">
            {t('dashboard.weeksOut')}
          </p>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-section">{t('dashboard.mix')}</h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
            <Donut
              title={t('dashboard.mix')}
              segments={ev.mix}
              center={
                <>
                  <span className="text-[24px] font-light tracking-[-0.04em]">
                    {formatNumber(ev.kpis[0]?.value ?? 0, locale)}
                  </span>
                  <span className="font-mono text-[11px] uppercase text-zinc-500">
                    {t(`kpi.${ev.kpis[0]?.key ?? 'registrations'}`)}
                  </span>
                </>
              }
            />
            <ul className="flex w-full list-none flex-col gap-2 p-0">
              {ev.mix.map((m) => (
                <li key={m.label} className="flex items-center gap-2 text-[13px]">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${swatchClass(m.tone)}`} />
                  <span className="flex-1">{m.label}</span>
                  <span className="font-mono text-caption text-zinc-600 tabular-nums">
                    {new Intl.NumberFormat(locale, { style: 'percent' }).format(m.value / mixTotal)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card className="flex flex-col">
          <div className="flex items-center gap-2.5 pb-1">
            <h2 className="text-section">{t('dashboard.needsAttention')}</h2>
            <span className="font-mono text-caption text-zinc-500">
              {String(ev.attention.length).padStart(2, '0')}
            </span>
          </div>
          <ul className="list-none divide-y divide-zinc-100 p-0">
            {ev.attention.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${a.tone === 'danger' ? 'bg-pink-500' : 'bg-accent-700'}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[13px] text-zinc-900">{t(a.key, formatParams(a.params, f))}</span>
                  <span className="text-caption text-zinc-500">
                    {t(a.detail.key, formatParams(a.detail.params, f))}
                  </span>
                </div>
                <Link href={`/o/${org}/e/${event}/attendees`} className={buttonClass('secondary', 'sm')}>
                  {t(`actions.${a.action}`)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('dashboard.readiness')}</h2>
          <div className="flex items-center gap-[18px]">
            <ProgressRing value={readiness} label={t('dashboard.readinessPercent', { value: readiness })} />
            <ul className="flex list-none flex-col p-0">
              {ev.readiness.map((r) => (
                <li key={r.key} className="flex items-center gap-2.5 py-1 text-[13px]">
                  <span
                    className={`flex size-[18px] items-center justify-center rounded-full ${r.done ? 'bg-green-500 text-white' : 'border border-zinc-300'}`}
                  >
                    {r.done ? <Check aria-hidden="true" className="size-3" strokeWidth={2.5} /> : null}
                  </span>
                  <span className={r.done ? 'text-zinc-900' : 'text-zinc-500'}>
                    {t(`readiness.${r.key}`)}
                    <span className="sr-only">{r.done ? t('readiness.done') : t('readiness.todo')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
