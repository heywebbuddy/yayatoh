'use client';

import type { WidgetKey } from '@yayatoh/command-center/client';
import { formatMoney, money } from '@yayatoh/kernel';
import { countWords } from '@yayatoh/notifications/numbers';
import { BarChart, cx, ProgressBar, ProgressRing, StatusDot, Timeline as TimelineList } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { SEVERITY_DOT } from '../alerts-list.tsx';
import {
  type Capacity,
  CapacityBody,
  type CheckinSpeed,
  CheckinSpeedBody,
  type LiveFeed,
  LiveFeedBody,
  type ScanIssues,
  ScanIssuesBody,
  type StaffPresence,
  StaffPresenceBody,
} from './live-widgets.tsx';

/** Widget bodies (M3.2a). Each renders one loader's allowlisted DTO; nothing else reaches them. */
interface Ctx {
  readonly locale: string;
  readonly timeZone: string;
  readonly base: string;
}

/** What the board lets a widget control (M3.3a): its options (the feed's filters) and pausing. */
export interface WidgetControls {
  readonly params: Readonly<Record<string, string>>;
  readonly setParams: (next: Readonly<Record<string, string>>) => void;
  readonly paused: boolean;
  readonly waiting: boolean;
  readonly togglePause: () => void;
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
type Entrances = {
  timeZone: string;
  checkedIn: number;
  expected: number;
  byEntrance: { name: string; checkedIn: number }[];
  byDate: { day: string; checkedIn: number }[];
};
type DeviceBoard = {
  devices: {
    id: string;
    label: string;
    online: boolean;
    lastSeenAt: string | null;
    batteryPct: number | null;
    queueDepth: number | null;
    checkpoint: string | null;
    kiosk: boolean;
    appVersion?: string | null;
    lastScanAt?: string | null;
  }[];
};
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

type Assistance = {
  waiting: number;
  assigned: number;
  inProgress: number;
  overdue: number;
  top: {
    id: string;
    number: number;
    source: 'guest' | 'staff';
    reason: string;
    priority: 'urgent' | 'high' | 'normal';
    state: string;
    overdue: boolean;
  }[];
};
type Campaigns = {
  currency: string;
  fromDay: string;
  toDay: string;
  totals: {
    sends: number | null;
    clicks: number;
    uniqueClickers: number;
    orders: number;
    revenueMinor: number;
    firstTouchOrders: number;
    firstTouchRevenueMinor: number;
    conversionBps: number;
  };
  campaigns: {
    key: string;
    kind: 'campaign' | 'utm';
    name: string | null;
    sends: number | null;
    clicks: number;
    orders: number;
    revenueMinor: number;
    firstTouchOrders: number;
    firstTouchRevenueMinor: number;
    conversionBps: number;
  }[];
  more: number;
};
type Deliverability = {
  sent: number;
  bounceBps: number;
  complaintBps: number;
  bounceOver: boolean;
  complaintOver: boolean;
  domainsOver: number;
  campaignsOver: number;
  paused: boolean;
  windowDays: number;
};

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const pct = (part: number, whole: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    whole > 0 ? part / whole : 0,
  );

function Big({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-stat text-ink tabular-nums" data-testid={testId}>
      {children}
    </p>
  );
}

function Meter({
  value,
  max,
  label,
  tone = 'primary',
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'primary' | 'success' | 'brand';
}) {
  return max > 0 ? <ProgressBar value={Math.min(value, max)} max={max} label={label} tone={tone} /> : null;
}

function ReadinessBody({ d, c }: { d: Readiness; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.readiness');
  const tr = useTranslations('readiness');
  const item = (r: { key: string; path: string }) => (
    <li key={r.key}>
      <Link
        href={r.path ? `${c.base}/${r.path}` : c.base}
        className="inline-flex min-h-7 items-center text-body font-semibold text-primary-ink underline-offset-2 hover:underline"
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
            <h4 className="m-0 text-caption font-bold tracking-normal text-danger">{t('blocking')}</h4>
            <ul className="flex list-none flex-col gap-1 p-0" data-testid="cc-blocking">
              {d.blocking.map(item)}
            </ul>
          </div>
        ) : null}
        {d.todo.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="m-0 text-caption font-bold tracking-normal text-ink-2">{t('todo')}</h4>
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
          <p className="text-caption text-ink-2">
            {t('today', { amount: m(l.today, l.currency) })} ·{' '}
            {t('refunds', { amount: m(l.refunds, l.currency) })}
          </p>
        </div>
      ))}
      <p className="text-caption text-ink-2">{t('orders', { count: d.orders })}</p>
    </div>
  );
}

function TicketsBody({ d, c }: { d: Tickets; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.tickets');
  const tm = useTranslations('commandCenter');
  return (
    <div className="flex flex-col gap-2">
      <Big testId="cc-tickets-sold">{num(d.sold, c.locale)}</Big>
      <p className="text-caption text-ink-2">
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
      <p className="text-caption text-ink-2">{t('today')}</p>
      <p className="text-caption text-ink-2" data-testid="cc-checkins-total">
        {t('total', { total: num(d.total, c.locale), valid: num(d.valid, c.locale) })}
      </p>
    </div>
  );
}

function SeatFillBody({ d, c }: { d: SeatFill; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.seatFill');
  const tm = useTranslations('commandCenter');
  if (d.total === 0) return <p className="text-body text-ink-2">{t('noSeats')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <Big>{pct(d.occupied, d.total, c.locale)}</Big>
      <p className="text-caption text-ink-2">
        {t('ofSeats', { occupied: num(d.occupied, c.locale), total: num(d.total, c.locale) })}
      </p>
      <Meter
        value={d.occupied}
        max={d.total}
        label={tm('meter', { value: d.occupied, max: d.total })}
        tone="brand"
      />
    </div>
  );
}

function DevicesBody({ d, c }: { d: Devices; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.devices');
  if (d.enrolled === 0) return <p className="text-body text-ink-2">{t('none')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <Big testId="cc-devices-online">{num(d.online, c.locale)}</Big>
      <p className="text-caption text-ink-2">{t('ofEnrolled', { count: d.enrolled })}</p>
      {d.lowBattery > 0 ? (
        <p className="text-caption text-danger">{t('lowBattery', { count: d.lowBattery })}</p>
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
  if (d.items.length === 0) return <p className="text-body text-ink-2">{t('empty')}</p>;
  return (
    <TimelineList
      label={t('title')}
      items={d.items.map((i, n) => ({
        id: `${i.kind}-${i.at}-${n}`,
        title: t(`kind.${i.kind}`, { title: i.title ?? '' }),
        time: <time dateTime={i.at}>{fmt.format(new Date(i.at))}</time>,
        tone: n === 0 ? 'primary' : 'neutral',
      }))}
    />
  );
}

/** M3.4a staff view (batch 3d merge): the Scan PWA's live counts, in its own words. */
function EntrancesBody({ d, c }: { d: Entrances; c: Ctx }) {
  const t = useTranslations('scanStaff');
  const day = new Intl.DateTimeFormat(c.locale, { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body" data-testid="cc-entrances-today">
        {t('checkedIn', { checkedIn: num(d.checkedIn, c.locale), expected: num(d.expected, c.locale) })}
      </p>
      {d.byEntrance.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-caption text-ink-2">{t('byEntrance')}</h3>
          <ul className="flex list-none flex-col gap-1 p-0">
            {d.byEntrance.map((e) => (
              <li key={e.name} className="flex justify-between gap-3 text-body">
                <span>{e.name}</span>
                <span className="tabular-nums">{num(e.checkedIn, c.locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.byDate.length > 1 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-caption text-ink-2">{t('byDate')}</h3>
          <ul className="flex list-none flex-col gap-1 p-0">
            {d.byDate.map((r) => (
              <li key={r.day} className="flex justify-between gap-3 text-body">
                <time dateTime={r.day}>{day.format(new Date(`${r.day}T00:00:00Z`))}</time>
                <span className="tabular-nums">{num(r.checkedIn, c.locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** M3.4a staff view (batch 3d merge): each device at the event, as the Scan PWA's board shows it. */
function DeviceBoardBody({ d, c }: { d: DeviceBoard; c: Ctx }) {
  const t = useTranslations('scanStaff');
  const tl = useTranslations('commandCenter.widget.deviceBoard');
  const time = new Intl.DateTimeFormat(c.locale, { timeStyle: 'short', timeZone: c.timeZone });
  if (d.devices.length === 0) return <p className="text-body text-ink-2">{t('noDevices')}</p>;
  return (
    <ul className="flex list-none flex-col gap-2 p-0" data-testid="cc-device-board">
      {d.devices.map((v) => (
        <li key={v.id} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-body">
            <span className="font-medium">{v.label}</span>
            {v.kiosk ? <span className="text-caption text-ink-2">{t('kiosk')}</span> : null}
            <StatusDot
              status={v.online ? 'success' : 'danger'}
              label={v.online ? t('online') : t('offline')}
            />
          </span>
          <span className="text-caption text-ink-2">
            {[
              v.checkpoint ?? t('wholeEvent'),
              v.lastSeenAt ? t('lastSeen', { time: time.format(new Date(v.lastSeenAt)) }) : t('neverSeen'),
              v.batteryPct !== null ? t('battery', { percent: v.batteryPct }) : null,
              v.queueDepth !== null ? t('backlog', { count: v.queueDepth }) : null,
              v.lastScanAt ? tl('lastScan', { time: time.format(new Date(v.lastScanAt)) }) : null,
              v.appVersion ? tl('appVersion', { version: v.appVersion }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

const bpsPct = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);

/** M3.8b: this event's campaigns → orders and revenue (last touch; first touch alongside). */
function CampaignsBody({ d, c }: { d: Campaigns; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.campaigns');
  const m = (minor: number) => formatMoney(money(minor, d.currency), c.locale);
  const orgBase = c.base.replace(/\/e\/[^/]+$/, '');
  const name = (x: Campaigns['campaigns'][number]) => x.name ?? t('unnamed');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Big testId="cc-campaigns-revenue">{m(d.totals.revenueMinor)}</Big>
        <p className="text-caption text-ink-2" data-testid="cc-campaigns-summary">
          {t('summary', {
            orders: d.totals.orders,
            clicks: d.totals.clicks,
            conversion: bpsPct(d.totals.conversionBps, c.locale),
          })}
        </p>
        <p className="text-caption text-ink-2">
          {t('firstTouch', { orders: d.totals.firstTouchOrders, amount: m(d.totals.firstTouchRevenueMinor) })}
        </p>
      </div>
      {d.campaigns.length === 0 ? (
        <p className="text-body text-ink-2">{t('none')}</p>
      ) : (
        <>
          <BarChart
            title={t('chartTitle')}
            bars={d.campaigns.map((x) => ({ label: name(x).slice(0, 14), value: x.revenueMinor }))}
            height={120}
            formatValue={m}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body" data-testid="cc-campaigns-table">
              <caption className="sr-only">{t('chartTitle')}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-2 py-1.5 text-start text-caption font-normal text-ink-2">
                    {t('campaign')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-end text-caption font-normal text-ink-2">
                    {t('clicks')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-end text-caption font-normal text-ink-2">
                    {t('orders')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-end text-caption font-normal text-ink-2">
                    {t('revenue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.campaigns.map((x) => (
                  <tr key={x.key} className="border-b border-line last:border-0">
                    <th scope="row" className="px-2 py-1.5 text-start font-normal">
                      <Link
                        href={`${orgBase}/marketing-analytics/campaign?key=${encodeURIComponent(x.key)}`}
                        className="inline-flex min-h-6 items-center underline underline-offset-2"
                      >
                        {name(x)}
                      </Link>
                    </th>
                    <td className="px-2 py-1.5 text-end tabular-nums">{num(x.clicks, c.locale)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{num(x.orders, c.locale)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{m(x.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.more > 0 ? <p className="text-caption text-ink-2">{t('more', { count: d.more })}</p> : null}
        </>
      )}
      <Link
        href={`${orgBase}/marketing-analytics`}
        className="inline-flex min-h-6 items-center self-start text-body underline underline-offset-2"
      >
        {t('open')}
      </Link>
    </div>
  );
}

/** M3.8b: the org's email bounce and complaint rates, what is over the thresholds, the pause. */
function DeliverabilityBody({ d, c }: { d: Deliverability; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.deliverability');
  const orgBase = c.base.replace(/\/e\/[^/]+$/, '');
  const over = d.bounceOver || d.complaintOver || d.domainsOver > 0 || d.campaignsOver > 0;
  return (
    <div className="flex flex-col gap-2">
      {d.paused ? <StatusDot status="danger" label={t('paused')} /> : null}
      <StatusDot status={over ? 'warning' : 'success'} label={over ? t('attention') : t('healthy')} />
      <p className="text-body tabular-nums" data-testid="cc-deliverability-rates">
        {t('rates', {
          bounce: bpsPct(d.bounceBps, c.locale),
          complaint: bpsPct(d.complaintBps, c.locale),
        })}
      </p>
      <p className="text-caption text-ink-2">{t('window', { sent: d.sent, days: d.windowDays })}</p>
      {d.domainsOver + d.campaignsOver > 0 ? (
        <p className="text-caption text-ink-2">
          {t('over', { domains: d.domainsOver, campaigns: d.campaignsOver })}
        </p>
      ) : null}
      <Link
        href={`${orgBase}/marketing-analytics/deliverability`}
        className="inline-flex min-h-6 items-center self-start text-body underline underline-offset-2"
      >
        {t('open')}
      </Link>
    </div>
  );
}

function AlertsBody({ d, c }: { d: Alerts; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.alerts');
  const ta = useTranslations('alerts');
  if (d.engine === 'pending') return <p className="text-body text-ink-2">{t('pending')}</p>;
  if (d.alerts.length === 0) return <p className="text-body text-ink-2">{t('none')}</p>;
  // Alert fix paths are org-relative (M3.2b); the board's base is the event's.
  const orgBase = c.base.replace(/\/e\/[^/]+$/, '');
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {d.alerts.map((a) => {
        const title = ta(`rules.${a.rule}`, {
          count: a.count,
          countWords: countWords(a.count, c.locale),
          title: '',
        });
        return (
          <li key={a.id} className="flex gap-3 rounded-tile border border-line bg-surface-2 p-3">
            <span
              aria-hidden="true"
              className={cx(
                'flex size-9 shrink-0 items-center justify-center rounded-[12px] font-extrabold',
                a.severity === 'critical' && 'bg-danger-soft text-danger',
                a.severity === 'warning' && 'bg-warning-soft text-warning',
                a.severity === 'info' && 'bg-primary-soft text-primary-ink',
              )}
            >
              !
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              {a.href ? (
                <Link
                  href={`${orgBase}${a.href}`}
                  className="text-body font-bold text-ink underline-offset-2 hover:underline"
                >
                  {title}
                </Link>
              ) : (
                <span className="text-body font-bold text-ink">{title}</span>
              )}
              <StatusDot status={SEVERITY_DOT[a.severity]} label={ta(`severity.${a.severity}`)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** M3.3b: the help queue in numbers and its most urgent open requests, linking to the queue. */
function AssistanceBody({ d, c }: { d: Assistance; c: Ctx }) {
  const t = useTranslations('assistance');
  return (
    <div className="flex flex-col gap-3" data-testid="cc-assistance">
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['waiting', 'assigned', 'inProgress', 'overdue'] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1 rounded-tile bg-surface-2 px-3.5 py-3">
            <dt className="text-caption font-semibold text-ink-2">{t(`widget.${k}`)}</dt>
            <dd
              className={cx(
                'm-0 text-[24px] leading-none font-extrabold tracking-[-0.03em] tabular-nums',
                k === 'overdue' && d.overdue > 0 ? 'text-danger' : 'text-ink',
              )}
            >
              {num(d[k], c.locale)}
            </dd>
          </div>
        ))}
      </dl>
      {d.top.length === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('widget.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {d.top.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-body">
              <span className="font-extrabold text-ink">{t('number', { number: r.number })}</span>
              <span>{t(`reason.${r.reason}`)}</span>
              <span className="text-caption text-ink-2">
                {[t(`priority.${r.priority}`), t(`state.${r.state}`), r.overdue ? t('overdue') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`${c.base}/assistance`}
        className="self-start text-body font-bold text-primary-ink underline underline-offset-2"
      >
        {t('widget.open')}
      </Link>
    </div>
  );
}

export function WidgetBody({
  widget,
  data,
  ctx,
  controls,
}: {
  widget: WidgetKey;
  data: unknown;
  ctx: Ctx;
  controls: WidgetControls;
}) {
  switch (widget) {
    case 'liveFeed':
      return <LiveFeedBody d={data as LiveFeed} c={ctx} controls={controls} />;
    case 'checkinSpeed':
      return <CheckinSpeedBody d={data as CheckinSpeed} c={ctx} />;
    case 'scanIssues':
      return <ScanIssuesBody d={data as ScanIssues} c={ctx} />;
    case 'capacity':
      return <CapacityBody d={data as Capacity} c={ctx} />;
    case 'staffPresence':
      return <StaffPresenceBody d={data as StaffPresence} c={ctx} />;
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
    case 'entrances':
      return <EntrancesBody d={data as Entrances} c={ctx} />;
    case 'deviceBoard':
      return <DeviceBoardBody d={data as DeviceBoard} c={ctx} />;
    case 'assistance':
      return <AssistanceBody d={data as Assistance} c={ctx} />;
    case 'campaigns':
      return <CampaignsBody d={data as Campaigns} c={ctx} />;
    case 'deliverability':
      return <DeliverabilityBody d={data as Deliverability} c={ctx} />;
  }
}
