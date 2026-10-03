import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, Card, Donut, Label, LineChart, swatchClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { DemoEvent } from '@/demo/events.ts';
import { Link } from '@/i18n/navigation.ts';
import { type FormatCtx, formatNumber, formatParams } from '@/lib/format.ts';

/** Dev/preview demo metrics for the seeded showcase events (until ticketing lands in M1.5). */
export async function DemoSections({
  demo,
  base,
  locale,
  f,
}: {
  demo: DemoEvent;
  base: string;
  locale: string;
  f: FormatCtx;
}) {
  const t = await getTranslations();
  const mixTotal = demo.mix.reduce((a, m) => a + m.value, 0);
  return (
    <>
      <section
        aria-label={t('dashboard.keyNumbers')}
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        {demo.kpis.map((k) => (
          <Card key={k.key} className="flex flex-col gap-2.5 px-[22px]">
            <Label>{t(`kpi.${k.key}`)}</Label>
            <p className="text-[36px] leading-none font-extrabold tracking-[-0.045em] tabular-nums">
              {k.kind === 'money'
                ? formatMoney(money(k.value, demo.currency), locale).replace(/\.00$/, '')
                : formatNumber(k.value, locale)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-2">
              <span>{t(k.note.key, formatParams(k.note.params, f))}</span>
              <span className="inline-flex items-center gap-1.5 text-ink-2">
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
              {demo.trend.series.map((s) => (
                <li key={s.label} className="inline-flex items-center gap-1.5 text-caption text-ink-2">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${swatchClass(s.tone)}`} />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
          <LineChart
            title={t('dashboard.registrationsTrend')}
            series={demo.trend.series}
            xLabels={demo.trend.labels}
            formatValue={(n) => formatNumber(n, locale)}
          />
          <p className="text-center text-label uppercase text-ink-2">{t('dashboard.weeksOut')}</p>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-section">{t('dashboard.mix')}</h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
            <Donut
              title={t('dashboard.mix')}
              segments={demo.mix}
              center={
                <>
                  <span className="text-[24px] font-extrabold tracking-[-0.04em]">
                    {formatNumber(demo.kpis[0]?.value ?? 0, locale)}
                  </span>
                  <span className="text-[11px] uppercase text-ink-2">
                    {t(`kpi.${demo.kpis[0]?.key ?? 'registrations'}`)}
                  </span>
                </>
              }
            />
            <ul className="flex w-full list-none flex-col gap-2 p-0">
              {demo.mix.map((m) => (
                <li key={m.label} className="flex items-center gap-2 text-[13px]">
                  <span aria-hidden="true" className={`size-2.5 rounded-full ${swatchClass(m.tone)}`} />
                  <span className="flex-1">{m.label}</span>
                  <span className="font-mono text-caption text-ink-2 tabular-nums">
                    {new Intl.NumberFormat(locale, { style: 'percent' }).format(m.value / mixTotal)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card className="flex flex-col">
        <div className="flex items-center gap-2.5 pb-1">
          <h2 className="text-section">{t('dashboard.needsAttention')}</h2>
          <span className="font-mono text-caption text-ink-2">
            {String(demo.attention.length).padStart(2, '0')}
          </span>
        </div>
        <ul className="list-none divide-y divide-line p-0">
          {demo.attention.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${a.tone === 'danger' ? 'bg-brand' : 'bg-warning-dot'}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[13px] text-ink">{t(a.key, formatParams(a.params, f))}</span>
                <span className="text-caption text-ink-2">
                  {t(a.detail.key, formatParams(a.detail.params, f))}
                </span>
              </div>
              <Link href={`${base}/attendees`} className={buttonClass('secondary', 'sm')}>
                {t(`actions.${a.action}`)}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
