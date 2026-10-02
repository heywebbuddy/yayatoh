'use client';

import { countWords } from '@yayatoh/notifications/numbers';
import { BarChart, Button, ChartTable, cx, StatusDot } from '@yayatoh/ui';
import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { SEVERITY_DOT } from '../alerts-list.tsx';
import type { WidgetControls } from './widgets.tsx';

/** M3.3a live mode widget bodies: each renders one loader's allowlisted DTO. */
interface Ctx {
  readonly locale: string;
  readonly timeZone: string;
  readonly base: string;
}

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const dec = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
const SELECT = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

// --- Live feed -----------------------------------------------------------------------------------

type FeedKind = 'checkin' | 'reentry' | 'duplicate' | 'invalid' | 'device' | 'alert';
export type LiveFeed = {
  items: {
    id: string;
    kind: FeedKind;
    reason: string;
    at: string;
    checkpoint: string | null;
    device: string | null;
    offline: boolean;
    alert: { severity: 'info' | 'warning' | 'critical'; state: string; count: number } | null;
  }[];
  filters: { checkpointId: string | null; deviceId: string | null; kind: FeedKind | null };
  options: { checkpoints: { id: string; name: string }[]; devices: { id: string; label: string }[] };
};

const KINDS: readonly FeedKind[] = ['checkin', 'reentry', 'duplicate', 'invalid', 'device', 'alert'];
const KIND_DOT = {
  checkin: 'success',
  reentry: 'info',
  duplicate: 'warning',
  invalid: 'danger',
  device: 'neutral',
  alert: 'warning',
} as const;
const SCAN_REASONS = new Set([
  'admitted',
  'duplicate',
  'invalid',
  'void',
  'wrong_event',
  'not_today',
  'outside_window',
  'wrong_date',
  'duplicate_offline',
  'superseded',
  'provisional',
  'granted',
  'no_access',
  'wrong_checkpoint',
]);
const DEVICE_REASONS = new Set(['online', 'offline', 'low_battery', 'revoked', 'wiped']);

export function LiveFeedBody({ d, c, controls }: { d: LiveFeed; c: Ctx; controls: WidgetControls }) {
  const t = useTranslations('commandCenter.widget.liveFeed');
  const ta = useTranslations('alerts');
  const id = useId();
  const time = new Intl.DateTimeFormat(c.locale, { timeStyle: 'medium', timeZone: c.timeZone });
  const set = (key: 'checkpoint' | 'device' | 'kind', value: string) => {
    const next = { ...controls.params };
    if (value) next[key] = value;
    else delete next[key];
    controls.setParams(next);
  };
  const filtered = Boolean(d.filters.checkpointId || d.filters.deviceId || d.filters.kind);
  const what = (i: LiveFeed['items'][number]) => {
    if (i.kind === 'alert' && i.alert)
      return t('alert', {
        title: ta(`rules.${i.reason}`, {
          count: i.alert.count,
          countWords: countWords(i.alert.count, c.locale),
        }),
        state: i.alert.state === 'resolved' ? 'resolved' : 'open',
      });
    if (i.kind === 'device')
      return t('deviceEvent', {
        device: i.device ?? t('unknownDevice'),
        change: DEVICE_REASONS.has(i.reason) ? i.reason : 'other',
      });
    return t(`kind.${i.kind}`, { reason: SCAN_REASONS.has(i.reason) ? i.reason : 'other' });
  };
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 flex flex-wrap items-end gap-3 border-0 p-0">
        <legend className="sr-only">{t('filters')}</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-cp`} className="text-caption text-zinc-600">
            {t('entrance')}
          </label>
          <select
            id={`${id}-cp`}
            className={SELECT}
            value={controls.params.checkpoint ?? ''}
            onChange={(e) => set('checkpoint', e.target.value)}
          >
            <option value="">{t('allEntrances')}</option>
            {d.options.checkpoints.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-dev`} className="text-caption text-zinc-600">
            {t('device')}
          </label>
          <select
            id={`${id}-dev`}
            className={SELECT}
            value={controls.params.device ?? ''}
            onChange={(e) => set('device', e.target.value)}
          >
            <option value="">{t('allDevices')}</option>
            {d.options.devices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-kind`} className="text-caption text-zinc-600">
            {t('outcome')}
          </label>
          <select
            id={`${id}-kind`}
            className={SELECT}
            value={controls.params.kind ?? ''}
            onChange={(e) => set('kind', e.target.value)}
          >
            <option value="">{t('allOutcomes')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`filter.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={controls.paused}
          onClick={controls.togglePause}
          data-testid="cc-feed-pause"
        >
          {controls.paused ? (
            <Play aria-hidden="true" className="size-4" />
          ) : (
            <Pause aria-hidden="true" className="size-4" />
          )}
          {controls.paused ? t('resume') : t('pause')}
        </Button>
      </fieldset>
      <p role="status" aria-live="polite" className="text-caption text-zinc-600" data-testid="cc-feed-state">
        {controls.paused ? (controls.waiting ? t('pausedNews') : t('paused')) : ''}
      </p>
      {d.items.length === 0 ? (
        <p className="text-body text-zinc-600">{filtered ? t('noneFiltered') : t('none')}</p>
      ) : (
        <ol className="flex list-none flex-col gap-1.5 p-0" aria-label={t('listLabel')} data-testid="cc-feed">
          {d.items.map((i) => (
            <li
              key={`${i.kind}-${i.id}-${i.at}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
              data-kind={i.kind}
            >
              <time dateTime={i.at} className="min-w-20 text-caption text-zinc-600 tabular-nums">
                {time.format(new Date(i.at))}
              </time>
              <StatusDot
                status={i.kind === 'alert' && i.alert ? SEVERITY_DOT[i.alert.severity] : KIND_DOT[i.kind]}
                label={what(i)}
              />
              {i.checkpoint || i.device || i.offline ? (
                <span className="text-caption text-zinc-600">
                  {[i.checkpoint, i.kind === 'device' ? null : i.device, i.offline ? t('offline') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// --- Check-in speed ------------------------------------------------------------------------------

type SpeedRow = {
  id: string | null;
  name: string | null;
  scansPerMin: number;
  medianGapS: number | null;
  queueMin: number | null;
};
export type CheckinSpeed = {
  windowMin: number;
  series: { at: string; count: number }[];
  scansPerMin: number;
  medianGapS: number | null;
  queueMin: number | null;
  remaining: number;
  entrances: SpeedRow[];
  devices: SpeedRow[];
};

function SpeedTable({
  caption,
  first,
  rows,
  c,
  testId,
}: {
  caption: string;
  first: string;
  rows: SpeedRow[];
  c: Ctx;
  testId: string;
}) {
  const t = useTranslations('commandCenter.widget.checkinSpeed');
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
    <section className="overflow-x-auto" aria-label={caption} tabIndex={0}>
      <table className="w-full border-collapse text-body" data-testid={testId}>
        <caption className="text-start text-caption font-medium text-zinc-700">{caption}</caption>
        <thead>
          <tr className="border-b border-zinc-200">
            {[first, t('perMinute'), t('medianGap'), t('queue')].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cx(
                  'px-2 py-1.5 text-caption font-normal text-zinc-600',
                  i ? 'text-end' : 'text-start',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? 'none'} className="border-b border-zinc-100">
              <th scope="row" className="px-2 py-1.5 text-start font-normal">
                {r.name ?? (testId === 'cc-speed-devices' ? t('noDevice') : t('noEntrance'))}
              </th>
              <td className="px-2 py-1.5 text-end tabular-nums">{dec(r.scansPerMin, c.locale)}</td>
              <td className="px-2 py-1.5 text-end tabular-nums">
                {r.medianGapS === null ? '—' : t('seconds', { value: dec(r.medianGapS, c.locale) })}
              </td>
              <td className="px-2 py-1.5 text-end tabular-nums">
                {r.queueMin === null ? t('notMoving') : t('minutes', { count: r.queueMin })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function CheckinSpeedBody({ d, c }: { d: CheckinSpeed; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.checkinSpeed');
  const clock = new Intl.DateTimeFormat(c.locale, { timeStyle: 'short', timeZone: c.timeZone });
  const bars = d.series.map((p) => ({ label: clock.format(new Date(p.at)), value: p.count }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p
          className="text-[32px] leading-none font-light tracking-[-0.045em] tabular-nums"
          data-testid="cc-speed-rate"
        >
          {dec(d.scansPerMin, c.locale)}
        </p>
        <p className="text-caption text-zinc-600">{t('rateLabel', { minutes: d.windowMin })}</p>
      </div>
      <p className="text-caption text-zinc-600" data-testid="cc-speed-summary">
        {[
          d.medianGapS === null ? null : t('medianGapValue', { value: dec(d.medianGapS, c.locale) }),
          t('remaining', { count: d.remaining }),
          d.queueMin === null ? t('queueStopped') : t('queueValue', { count: d.queueMin }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <BarChart title={t('chartTitle')} bars={bars} height={140} />
      <ChartTable
        toggle={t('showTable')}
        caption={t('chartTitle')}
        headers={[t('minute'), t('checkedIn')]}
        rows={bars.map((b) => [b.label, num(b.value, c.locale)])}
      />
      {d.entrances.length > 0 ? (
        <SpeedTable
          caption={t('byEntrance')}
          first={t('entrance')}
          rows={d.entrances}
          c={c}
          testId="cc-speed-entrances"
        />
      ) : null}
      {d.devices.length > 0 ? (
        <SpeedTable
          caption={t('byDevice')}
          first={t('device')}
          rows={d.devices}
          c={c}
          testId="cc-speed-devices"
        />
      ) : null}
    </div>
  );
}

// --- Duplicate / invalid monitor ---------------------------------------------------------------------

export type ScanIssues = {
  counts: { result: string; count: number }[];
  duplicates: number;
  refused: number;
  recent: {
    id: string;
    result: string;
    at: string;
    checkpoint: string | null;
    device: string | null;
    orderId: string | null;
  }[];
};

export function ScanIssuesBody({ d, c }: { d: ScanIssues; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.scanIssues');
  const time = new Intl.DateTimeFormat(c.locale, { timeStyle: 'short', timeZone: c.timeZone });
  const reason = (r: string) => t(`reason.${SCAN_REASONS.has(r) ? r : 'other'}`);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body" data-testid="cc-issues-summary">
        {t('summary', { duplicates: d.duplicates, refused: d.refused })}
      </p>
      {d.counts.length > 0 ? (
        <ul className="flex list-none flex-col gap-1 p-0" aria-label={t('byReason')}>
          {d.counts.map((r) => (
            <li key={r.result} className="flex justify-between gap-3 text-body">
              <span>{reason(r.result)}</span>
              <span className="tabular-nums">{num(r.count, c.locale)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-zinc-600">{t('none')}</p>
      )}
      {d.recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-caption text-zinc-600">{t('recent')}</h4>
          <ol className="flex list-none flex-col gap-1.5 p-0" data-testid="cc-issues-recent">
            {d.recent.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 text-body">
                <time dateTime={i.at} className="text-caption text-zinc-600 tabular-nums">
                  {time.format(new Date(i.at))}
                </time>
                <span>{reason(i.result)}</span>
                {i.checkpoint || i.device ? (
                  <span className="text-caption text-zinc-600">
                    {[i.checkpoint, i.device].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                {i.orderId ? (
                  <Link
                    href={`${c.base}/orders/${i.orderId}`}
                    className="inline-flex min-h-6 items-center text-caption underline underline-offset-2"
                  >
                    {t('openOrder')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

// --- Capacity ------------------------------------------------------------------------------------

type Gauge = {
  inside: number;
  capacity: number | null;
  remaining: number | null;
  percent: number | null;
  level: 'none' | 'ok' | 'near' | 'over';
};
export type Capacity = {
  nearPct: number;
  overPct: number;
  venue: Gauge & { out: number };
  areas: (Gauge & { name: string; kind: 'entrance' | 'zone' })[];
};

const LEVEL_DOT = { none: 'neutral', ok: 'success', near: 'warning', over: 'danger' } as const;

function GaugeMeter({ g, label }: { g: Gauge; label: string }) {
  if (!g.capacity) return null;
  return (
    <meter
      className="h-2 w-full overflow-hidden rounded-full"
      min={0}
      max={g.capacity}
      low={Math.floor((g.capacity * 95) / 100)}
      high={g.capacity}
      optimum={0}
      value={Math.min(g.inside, g.capacity)}
      aria-label={label}
    />
  );
}

export function CapacityBody({ d, c }: { d: Capacity; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.capacity');
  const v = d.venue;
  const level = (g: Gauge) => t(`level.${g.level}`, { near: d.nearPct, over: d.overPct });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5" data-testid="cc-capacity-venue" data-level={v.level}>
        <p className="text-body">
          {v.capacity
            ? t('venue', { inside: num(v.inside, c.locale), capacity: num(v.capacity, c.locale) })
            : t('venueNoCap', { inside: num(v.inside, c.locale) })}
        </p>
        <GaugeMeter g={v} label={t('meter', { name: t('event') })} />
        <p className="flex flex-wrap items-center gap-x-3 text-caption text-zinc-600">
          <StatusDot status={LEVEL_DOT[v.level]} label={level(v)} />
          <span>{t('out', { count: v.out })}</span>
          {v.remaining !== null ? <span>{t('left', { count: v.remaining })}</span> : null}
        </p>
      </div>
      {d.areas.length > 0 ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
        <section className="overflow-x-auto" aria-label={t('areas')} tabIndex={0}>
          <table className="w-full border-collapse text-body" data-testid="cc-capacity-areas">
            <caption className="text-start text-caption font-medium text-zinc-700">{t('areas')}</caption>
            <thead>
              <tr className="border-b border-zinc-200">
                {[t('area'), t('in'), t('capacity'), t('leftHeader'), t('status')].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cx(
                      'px-2 py-1.5 text-caption font-normal text-zinc-600',
                      i ? 'text-end' : 'text-start',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.areas.map((a) => (
                <tr key={a.name} className="border-b border-zinc-100" data-level={a.level}>
                  <th scope="row" className="px-2 py-1.5 text-start font-normal">
                    {a.name}
                  </th>
                  <td className="px-2 py-1.5 text-end tabular-nums">{num(a.inside, c.locale)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">
                    {a.capacity === null ? '—' : num(a.capacity, c.locale)}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums">
                    {a.remaining === null ? '—' : num(a.remaining, c.locale)}
                  </td>
                  <td className="px-2 py-1.5 text-end">{level(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

// --- Staff presence ------------------------------------------------------------------------------

export type StaffPresence = {
  people: {
    userId: string;
    name: string;
    device: string | null;
    checkpoint: string | null;
    source: 'door_screen' | 'device';
    since: string;
    lastSeenAt: string;
  }[];
};

export function StaffPresenceBody({ d, c }: { d: StaffPresence; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.staffPresence');
  const time = new Intl.DateTimeFormat(c.locale, { timeStyle: 'short', timeZone: c.timeZone });
  if (d.people.length === 0) return <p className="text-body text-zinc-600">{t('none')}</p>;
  return (
    <ul className="flex list-none flex-col gap-2 p-0" data-testid="cc-presence">
      {d.people.map((p) => (
        <li key={p.userId} className="flex flex-col gap-0.5">
          <span className="text-body font-medium">{p.name || t('unknown')}</span>
          <span className="text-caption text-zinc-600">
            {[
              p.source === 'device' ? t('onDevice', { device: p.device ?? '' }) : t('onDoorScreen'),
              p.checkpoint ?? t('wholeEvent'),
              t('since', { time: time.format(new Date(p.since)) }),
            ].join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- Guest assistance (M3.3b slot) ------------------------------------------------------------------

export type Assistance = { engine: 'pending' | 'ready'; open: number };

export function AssistanceBody({ d }: { d: Assistance }) {
  const t = useTranslations('commandCenter.widget.assistance');
  if (d.engine === 'pending') return <p className="text-body text-zinc-600">{t('pending')}</p>;
  return <p className="text-body">{t('open', { count: d.open })}</p>;
}
