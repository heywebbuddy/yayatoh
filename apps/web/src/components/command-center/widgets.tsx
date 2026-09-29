'use client';

import type { WidgetKey } from '@yayatoh/command-center/client';
import { formatMoney, money } from '@yayatoh/kernel';
import { countWords } from '@yayatoh/notifications/numbers';
import { ProgressRing, StatusDot } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { SEVERITY_DOT } from '../alerts-list.tsx';

/** Widget bodies (M3.2a). Each renders one loader's allowlisted DTO; nothing else reaches them. */
interface Ctx {
  readonly locale: string;
  readonly timeZone: string;
  readonly base: string;
}

type Readiness = {
  score: number;
  done: number;
  total: number;
  blocking: { key: string; path: string }[];
  todo: { key: string; path: string }[];
};
type Sales = { lines: { currency: string; total: number; today: number; refunds: number }[]; orders: number };
type Tickets = { sold: number; comp: number; capacity: number };
type Checkins = { today: number; total: number; valid: number };
type SeatFill = { occupied: number; total: number };
type Devices = { online: number; enrolled: number; lowBattery: number };
type Timeline = { timeZone: string; items: { kind: string; at: string; title: string | null }[] };
type Alerts = {
  engine: 'pending' | 'ready';
  alerts: {
    id: string;
    rule: string;
    severity: 'info' | 'warning' | 'critical';
    state: string;
    count: number;
    href: string | null;
    at: string;
  }[];
};

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const pct = (part: number, whole: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    whole > 0 ? part / whole : 0,
  );

function Big({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-[32px] leading-none font-light tracking-[-0.045em] tabular-nums" data-testid={testId}>
      {children}
    </p>
  );
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return max > 0 ? (
    <meter
      className="h-2 w-full overflow-hidden rounded-full"
      min={0}
      max={max}
      value={Math.min(value, max)}
      aria-label={label}
    />
  ) : null;
}

function ReadinessBody({ d, c }: { d: Readiness; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.readiness');
  const tr = useTranslations('readiness');
  const item = (r: { key: string; path: string }) => (
    <li key={r.key}>
      <Link
        href={r.path ? `${c.base}/${r.path}` : c.base}
        className="inline-flex min-h-6 items-center text-body underline underline-offset-2"
      >
        {tr(r.key)}
      </Link>
    </li>
  );
  return (
    <div className="flex flex-wrap items-start gap-4">
      <ProgressRing value={d.score} label={t('score', { score: d.score })} />
      <div className="flex min-w-40 flex-1 flex-col gap-2">
        {d.blocking.length === 0 && d.todo.length === 0 ? <p className="text-body">{t('allDone')}</p> : null}
        {d.blocking.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-caption font-medium text-pink-700">{t('blocking')}</h3>
            <ul className="flex list-none flex-col gap-1 p-0" data-testid="cc-blocking">
              {d.blocking.map(item)}
            </ul>
          </div>
        ) : null}
        {d.todo.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-caption text-zinc-600">{t('todo')}</h3>
            <ul className="flex list-none flex-col gap-1 p-0">{d.todo.map(item)}</ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SalesBody({ d, c }: { d: Sales; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.sales');
  const m = (minor: number, cur: string) => formatMoney(money(minor, cur), c.locale);
  return (
    <div className="flex flex-col gap-3">
      {d.lines.map((l) => (
        <div key={l.currency} className="flex flex-col gap-1" data-currency={l.currency}>
          <Big testId="cc-sales-total">{m(l.total, l.currency)}</Big>
          <p className="text-caption text-zinc-600">
            {t('today', { amount: m(l.today, l.currency) })} ·{' '}
            {t('refunds', { amount: m(l.refunds, l.currency) })}
          </p>
        </div>
      ))}
      <p className="text-caption text-zinc-600">{t('orders', { count: d.orders })}</p>
    </div>
  );
}

function TicketsBody({ d, c }: { d: Tickets; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.tickets');
  const tm = useTranslations('commandCenter');
  return (
    <div className="flex flex-col gap-2">
      <Big testId="cc-tickets-sold">{num(d.sold, c.locale)}</Big>
      <p className="text-caption text-zinc-600">
        {d.capacity > 0 ? t('ofCapacity', { capacity: num(d.capacity, c.locale) }) : t('noCapacity')}
        {d.comp > 0 ? ` · ${t('comps', { count: d.comp })}` : ''}
      </p>
      <Meter value={d.sold} max={d.capacity} label={tm('meter', { value: d.sold, max: d.capacity })} />
    </div>
  );
}

function CheckinsBody({ d, c }: { d: Checkins; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.checkins');
  return (
    <div className="flex flex-col gap-2">
      <Big testId="cc-checkins-today">{num(d.today, c.locale)}</Big>
      <p className="text-caption text-zinc-600">{t('today')}</p>
      <p className="text-caption text-zinc-600" data-testid="cc-checkins-total">
        {t('total', { total: num(d.total, c.locale), valid: num(d.valid, c.locale) })}
      </p>
    </div>
  );
}

function SeatFillBody({ d, c }: { d: SeatFill; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.seatFill');
  const tm = useTranslations('commandCenter');
  if (d.total === 0) return <p className="text-body text-zinc-600">{t('noSeats')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <Big>{pct(d.occupied, d.total, c.locale)}</Big>
      <p className="text-caption text-zinc-600">
        {t('ofSeats', { occupied: num(d.occupied, c.locale), total: num(d.total, c.locale) })}
      </p>
      <Meter value={d.occupied} max={d.total} label={tm('meter', { value: d.occupied, max: d.total })} />
    </div>
  );
}

function DevicesBody({ d, c }: { d: Devices; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.devices');
  if (d.enrolled === 0) return <p className="text-body text-zinc-600">{t('none')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <Big testId="cc-devices-online">{num(d.online, c.locale)}</Big>
      <p className="text-caption text-zinc-600">{t('ofEnrolled', { count: d.enrolled })}</p>
      {d.lowBattery > 0 ? (
        <p className="text-caption text-pink-700">{t('lowBattery', { count: d.lowBattery })}</p>
      ) : null}
    </div>
  );
}

function TimelineBody({ d, c }: { d: Timeline; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.timeline');
  const fmt = new Intl.DateTimeFormat(c.locale, {
    timeZone: d.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  if (d.items.length === 0) return <p className="text-body text-zinc-600">{t('empty')}</p>;
  return (
    <ol className="flex list-none flex-col gap-2 p-0">
      {d.items.map((i) => (
        <li key={`${i.kind}-${i.at}-${i.title ?? ''}`} className="flex flex-wrap items-baseline gap-x-3">
          <time dateTime={i.at} className="min-w-36 text-caption text-zinc-600 tabular-nums">
            {fmt.format(new Date(i.at))}
          </time>
          <span className="text-body">{t(`kind.${i.kind}`, { title: i.title ?? '' })}</span>
        </li>
      ))}
    </ol>
  );
}

function AlertsBody({ d, c }: { d: Alerts; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.alerts');
  const ta = useTranslations('alerts');
  if (d.engine === 'pending') return <p className="text-body text-zinc-600">{t('pending')}</p>;
  if (d.alerts.length === 0) return <p className="text-body text-zinc-600">{t('none')}</p>;
  // Alert fix paths are org-relative (M3.2b); the board's base is the event's.
  const orgBase = c.base.replace(/\/e\/[^/]+$/, '');
  return (
    <ul className="flex list-none flex-col gap-1.5 p-0">
      {d.alerts.map((a) => {
        const title = ta(`rules.${a.rule}`, { count: a.count, countWords: countWords(a.count, c.locale) });
        return (
          <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-body">
            <StatusDot status={SEVERITY_DOT[a.severity]} label={ta(`severity.${a.severity}`)} />
            {a.href ? (
              <Link href={`${orgBase}${a.href}`} className="underline underline-offset-2">
                {title}
              </Link>
            ) : (
              title
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function WidgetBody({ widget, data, ctx }: { widget: WidgetKey; data: unknown; ctx: Ctx }) {
  switch (widget) {
    case 'readiness':
      return <ReadinessBody d={data as Readiness} c={ctx} />;
    case 'sales':
      return <SalesBody d={data as Sales} c={ctx} />;
    case 'tickets':
      return <TicketsBody d={data as Tickets} c={ctx} />;
    case 'checkins':
      return <CheckinsBody d={data as Checkins} c={ctx} />;
    case 'seatFill':
      return <SeatFillBody d={data as SeatFill} c={ctx} />;
    case 'devices':
      return <DevicesBody d={data as Devices} c={ctx} />;
    case 'timeline':
      return <TimelineBody d={data as Timeline} c={ctx} />;
    case 'alerts':
      return <AlertsBody d={data as Alerts} c={ctx} />;
  }
}
