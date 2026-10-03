'use client';

import {
  type CcRole,
  countdown,
  durationParts,
  type HeroAlert,
  type NextAction,
  nextAction,
} from '@yayatoh/command-center/client';
import { countWords } from '@yayatoh/notifications/numbers';
import { buttonClass, Card, cx, StatusPill } from '@yayatoh/ui';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { type ModeView, useModeNote } from './mode-panel.tsx';

const PILL = { planning: 'neutral', pre_show: 'waiting', live: 'success', wrap: 'info' } as const;

/** "3 days, 4 hours" in the reader's locale (Intl units, no message per unit). */
export function formatDuration(ms: number, locale: string): string {
  const parts = durationParts(ms).map((p) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: p.unit, unitDisplay: 'long' }).format(p.value),
  );
  return new Intl.ListFormat(locale, { type: 'unit', style: 'long' }).format(parts);
}

/**
 * The server's clock, moving: starts at the render's `serverNow` (so the first client render
 * matches the server's) and ticks every 30 s from there (the dev clock offset included).
 */
function useServerNow(serverNow: string): number {
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  useEffect(() => {
    const offset = new Date(serverNow).getTime() - Date.now();
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => clearInterval(id);
  }, [serverNow]);
  return now;
}

export interface HeroLinks {
  /** The event's console base (`/o/{org}/e/{event}`). */
  readonly base: string;
  /** The event's public page. */
  readonly publicPage: string;
  /** The org's alert list, filtered to this event. */
  readonly alerts: string;
}

/** Where the next action leads. */
export function actionHref(a: NextAction, links: HeroLinks): string | null {
  switch (a.kind) {
    case 'alert':
      return a.href ? `${links.base.replace(/\/e\/[^/]+$/, '')}${a.href}` : links.alerts;
    case 'readiness':
      return `${a.path ? `${links.base}/${a.path}` : links.base}${a.field ? `#${a.field}` : ''}`;
    case 'scanner':
      return '/scan';
    case 'publicPage':
      return links.publicPage;
    case 'report':
      return `${links.base}/analysis`;
    case 'none':
      return null;
  }
}

/**
 * The hero strip (U4, UX principle 7): how long until the event starts (or ends), its mode, and
 * the single next action as the screen's one primary button. `children` is the mode control
 * (owners and staff who can edit the event).
 */
export function HeroStrip({
  mode,
  timeZone,
  locale,
  serverNow,
  action,
  links,
  children,
}: {
  mode: ModeView;
  timeZone: string;
  locale: string;
  serverNow: string;
  action: NextAction;
  links: HeroLinks;
  children?: ReactNode;
}) {
  const t = useTranslations('commandCenter');
  const ta = useTranslations('alerts');
  const tr = useTranslations('readiness');
  const note = useModeNote(mode, timeZone, locale);
  const now = useServerNow(serverNow);
  const c = countdown({ startsAt: new Date(mode.startsAt), endsAt: new Date(mode.endsAt) }, new Date(now));
  const duration = formatDuration(Math.abs(c.at.getTime() - now), locale);
  const when = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(
    c.at,
  );
  const href = actionHref(action, links);
  const what =
    action.kind === 'alert'
      ? ta(`rules.${action.rule}`, { count: action.count, countWords: countWords(action.count, locale) })
      : action.kind === 'readiness'
        ? t('hero.next.readiness', { item: tr(action.key) })
        : t(`hero.next.${action.kind}`);
  return (
    <section
      aria-labelledby="cc-hero-title"
      className="grid grid-cols-1 gap-3.5 lg:grid-cols-3"
      data-testid="cc-hero"
    >
      <Card className="flex flex-col gap-3 lg:col-span-2" data-next-change={mode.nextChangeAt ?? ''}>
        <p className="m-0 flex items-center gap-2" data-testid="cc-mode">
          <StatusPill
            tone={PILL[mode.mode]}
            label={t(`mode.${mode.mode}`)}
            live={mode.mode === 'live'}
            className="px-3 py-1.5 text-body"
          />
        </p>
        <h2 id="cc-hero-title" className="m-0 text-title text-ink tabular-nums" data-testid="cc-countdown">
          {t(`hero.${c.kind}`, { duration })}
        </h2>
        <p className="m-0 flex items-center gap-2 text-body text-ink-2">
          <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
          <time dateTime={c.at.toISOString()}>{when}</time>
        </p>
        {note ? <p className="m-0 text-caption text-ink-2">{note}</p> : null}
        <p className="m-0 text-caption text-ink-2">{t('override.autoNote', { timeZone })}</p>
        {children}
      </Card>
      <Card
        tone={action.kind === 'none' ? 'default' : 'feature'}
        className="flex flex-col justify-between gap-3"
        data-testid="cc-next"
        data-action={action.kind}
      >
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-label uppercase text-ink-2">{t('hero.nextLabel')}</p>
          <p id="cc-next-what" className="m-0 text-section text-ink">
            {what}
          </p>
          {action.kind === 'alert' ? (
            <p className="m-0 text-caption text-ink-2">{ta(`severity.${action.severity}`)}</p>
          ) : action.kind === 'readiness' && action.blocking ? (
            <p className="m-0 text-caption text-ink-2">{t('hero.blocking')}</p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className={cx(buttonClass('primary'), 'self-start')}
            aria-describedby="cc-next-what"
          >
            {t(`hero.do.${action.kind}`)}
            <ArrowRight aria-hidden="true" strokeWidth={2} className="rtl:-scale-x-100" />
          </Link>
        ) : null}
      </Card>
    </section>
  );
}

/** What the hero needs (U4): the mode, and what the member's role lets the next action use. */
export interface HeroView {
  readonly mode: ModeView;
  readonly role: CcRole;
  readonly canScan: boolean;
  readonly revenue: boolean;
  /** The readiness widget feeds the next action (roles and modes with readiness). */
  readonly readiness: boolean;
  /** The alerts widget feeds the next action. */
  readonly alerts: boolean;
}

type ReadinessData = {
  blocking: { key: string; path: string; field: string | null }[];
  todo: { key: string; path: string; field: string | null }[];
};

/** The board reports its latest readiness and alerts reads here (they drive the next action). */
const HeroFeed = createContext<((key: 'readiness' | 'alerts', data: unknown) => void) | null>(null);

export function useHeroFeed() {
  return useContext(HeroFeed);
}

/**
 * The Command Center's frame (U4): the hero strip on top and the board below. It stays mounted
 * when the board re-renders for a new mode or layout, so the mode control keeps its "Mode
 * updated." message; the board feeds it each fresh readiness and alerts read.
 */
export function CommandCenterShell({
  hero,
  links,
  timeZone,
  locale,
  serverNow,
  initial,
  controls,
  children,
}: {
  hero: HeroView;
  links: HeroLinks;
  timeZone: string;
  locale: string;
  serverNow: string;
  initial: { readiness?: unknown; alerts?: unknown };
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [feed, setFeed] = useState<{ readiness?: unknown; alerts?: unknown }>(initial);
  // A server refresh (new mode, new layout) brings fresh reads.
  useEffect(() => setFeed(initial), [initial]);
  const report = useCallback(
    (key: 'readiness' | 'alerts', data: unknown) =>
      setFeed((f) => (f[key] === data ? f : { ...f, [key]: data })),
    [],
  );
  const alerts = hero.alerts
    ? ((feed.alerts as { alerts?: HeroAlert[] } | null | undefined)?.alerts ?? null)
    : null;
  const readiness = hero.readiness ? ((feed.readiness as ReadinessData | null | undefined) ?? null) : null;
  const action = nextAction({
    mode: hero.mode.mode,
    role: hero.role,
    alerts,
    readiness,
    canScan: hero.canScan,
    revenue: hero.revenue,
  });
  return (
    <HeroFeed.Provider value={report}>
      <HeroStrip
        mode={hero.mode}
        timeZone={timeZone}
        locale={locale}
        serverNow={serverNow}
        action={action}
        links={links}
      >
        {controls}
      </HeroStrip>
      {children}
    </HeroFeed.Provider>
  );
}
