'use client';

import { countWords } from '@yayatoh/notifications/numbers';
import { cx, ProgressBar } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/**
 * The social Command Center pack (M4.6a): RSVP, guest seating, meals and dietary needs, and
 * arrivals. Each renders one loader's allowlisted DTO (counts, menu labels, guest names).
 */
interface Ctx {
  readonly locale: string;
  readonly timeZone: string;
  readonly base: string;
}

interface Person {
  name: string | null;
  guestOf: string | null;
  partyName: string;
}

export type Rsvp = {
  timeZone: string;
  invited: number;
  pending: number;
  pendingParties: number;
  responded: number;
  notSent: number;
  attending: number;
  deadline: string | null;
};
export type GuestSeating = {
  hasChart: boolean;
  guests: number;
  unseated: number;
  list: Person[];
  more: number;
};
export type Meals = {
  attending: number;
  options: { label: string; notes: string | null; count: number }[];
  other: number;
  none: number;
  dietary: number;
  accessibility: number;
};
export type Arrivals = {
  timeZone: string;
  expected: number;
  arrived: number;
  notArrived: number;
  recent: (Person & { arrivedAt: string; source: 'scanner' | 'kiosk' | 'host' })[];
};

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const TH = 'px-3 py-2 text-label tracking-[0.06em] text-ink-2 uppercase';
const TD = 'px-3 py-2.5 tabular-nums';
const TR = 'border-b border-line last:border-0';
const CAPTION = 'pb-2 text-start text-[13px] font-bold text-ink';
const LINK =
  'inline-flex min-h-6 items-center self-start text-body font-bold text-primary-ink underline underline-offset-2';

function Sentence({ testId, children, tone }: { testId: string; children: string; tone?: 'danger' | 'ok' }) {
  return (
    <p
      className={cx('m-0 text-body font-bold', tone === 'danger' ? 'text-danger' : 'text-ink')}
      data-testid={testId}
    >
      {children}
    </p>
  );
}

export function RsvpBody({ d, c }: { d: Rsvp; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.rsvp');
  const ta = useTranslations('alerts');
  const date = d.deadline
    ? new Intl.DateTimeFormat(c.locale, {
        timeZone: d.timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(d.deadline))
    : null;
  return (
    <div className="flex flex-col gap-2" data-testid="cc-rsvp">
      {d.invited === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('noneInvited')}</p>
      ) : d.pending === 0 ? (
        <Sentence testId="cc-rsvp-pending">{t('allAnswered')}</Sentence>
      ) : (
        <Sentence testId="cc-rsvp-pending" tone="danger">
          {ta('rules.rsvpPending', { count: d.pending, countWords: countWords(d.pending, c.locale) })}
        </Sentence>
      )}
      {d.invited > 0 ? (
        <>
          <p className="m-0 text-caption text-ink-2" data-testid="cc-rsvp-responded">
            {t('responded', { responded: num(d.responded, c.locale), invited: num(d.invited, c.locale) })}
          </p>
          <ProgressBar value={d.responded} max={d.invited} label={t('meter')} tone="success" />
        </>
      ) : null}
      {d.pending > 0 ? (
        <p className="m-0 text-caption text-ink-2">
          {t('parties', { count: num(d.pendingParties, c.locale) })}
          {d.notSent > 0 ? ` · ${t('notSent', { count: num(d.notSent, c.locale) })}` : ''}
        </p>
      ) : null}
      <p className="m-0 text-caption text-ink-2" data-testid="cc-rsvp-deadline">
        {date ? t('deadline', { date }) : t('noDeadline')}
      </p>
      <Link href={`${c.base}/guests/rsvp`} className={LINK}>
        {t('open')}
      </Link>
    </div>
  );
}

function personName(p: Person, guestOf: (name: string) => string) {
  return p.name ?? guestOf(p.guestOf ?? '?');
}

export function GuestSeatingBody({ d, c }: { d: GuestSeating; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.guestSeating');
  const ta = useTranslations('alerts');
  const guestOf = (name: string) => t('guestOf', { name });
  return (
    <div className="flex flex-col gap-2" data-testid="cc-guest-seating">
      {!d.hasChart ? (
        <p className="m-0 text-body text-ink-2">{t('noChart')}</p>
      ) : d.guests === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('noGuests')}</p>
      ) : (
        <>
          {d.unseated === 0 ? (
            <Sentence testId="cc-guest-unseated">{t('allSeated')}</Sentence>
          ) : (
            <Sentence testId="cc-guest-unseated" tone="danger">
              {ta('rules.guestsUnseated', {
                count: d.unseated,
                countWords: countWords(d.unseated, c.locale),
              })}
            </Sentence>
          )}
          <p className="m-0 text-caption text-ink-2">
            {t('seated', { seated: num(d.guests - d.unseated, c.locale), guests: num(d.guests, c.locale) })}
          </p>
          <ProgressBar value={d.guests - d.unseated} max={d.guests} label={t('title')} tone="brand" />
          {d.list.length > 0 ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" aria-label={t('listLabel')}>
              {d.list.map((p, i) => (
                <li
                  key={`${p.partyName}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-body"
                >
                  <span className="font-bold text-ink">{personName(p, guestOf)}</span>
                  <span className="text-caption text-ink-2">{p.partyName}</span>
                </li>
              ))}
              {d.more > 0 ? (
                <li className="py-1.5 text-caption text-ink-2">
                  {t('more', { count: num(d.more, c.locale) })}
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      )}
      <Link href={`${c.base}/seating/guests`} className={LINK}>
        {t('open')}
      </Link>
    </div>
  );
}

export function MealsBody({ d, c }: { d: Meals; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.meals');
  const rows = [
    ...d.options.map((o) => ({ key: `o-${o.label}`, label: o.label, notes: o.notes, count: o.count })),
    ...(d.other > 0 ? [{ key: 'other', label: t('other'), notes: null, count: d.other }] : []),
    ...(d.none > 0 ? [{ key: 'none', label: t('none'), notes: null, count: d.none }] : []),
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="cc-meals">
      {d.attending === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('noneAttending')}</p>
      ) : (
        <>
          <p className="m-0 text-body font-bold text-ink" data-testid="cc-meals-attending">
            {t('attending', { count: num(d.attending, c.locale) })}
          </p>
          {rows.length > 0 ? (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
            <section className="overflow-x-auto" aria-label={t('caption')} tabIndex={0}>
              <table className="w-full border-collapse text-body" data-testid="cc-meals-table">
                <caption className={CAPTION}>{t('caption')}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className={cx(TH, 'text-start')}>
                      {t('colMeal')}
                    </th>
                    <th scope="col" className={cx(TH, 'text-end')}>
                      {t('colGuests')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={TR}>
                      <th scope="row" className="px-3 py-2.5 text-start font-bold text-ink">
                        {r.label}
                        {r.notes ? (
                          <span className="block text-caption font-normal text-ink-2">{r.notes}</span>
                        ) : null}
                      </th>
                      <td className={cx(TD, 'text-end')}>{num(r.count, c.locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <p className="m-0 text-caption text-ink-2" data-testid="cc-meals-needs">
            {t('dietary', { count: num(d.dietary, c.locale) })} ·{' '}
            {t('accessibility', { count: num(d.accessibility, c.locale) })}
          </p>
        </>
      )}
      <Link href={`${c.base}/guests/answers`} className={LINK}>
        {t('open')}
      </Link>
    </div>
  );
}

export function ArrivalsBody({ d, c }: { d: Arrivals; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.arrivals');
  const td = useTranslations('dayOf');
  const guestOf = (name: string) => t('guestOf', { name });
  const time = new Intl.DateTimeFormat(c.locale, { timeZone: d.timeZone, timeStyle: 'short' });
  const source = { scanner: td('sourceScanner'), kiosk: td('sourceKiosk'), host: td('sourceHost') };
  return (
    <div className="flex flex-col gap-2" data-testid="cc-arrivals">
      {d.expected === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('noExpected')}</p>
      ) : (
        <>
          <Sentence testId="cc-arrivals-count">
            {t('arrivedOf', { arrived: num(d.arrived, c.locale), expected: num(d.expected, c.locale) })}
          </Sentence>
          <ProgressBar
            value={Math.min(d.arrived, d.expected)}
            max={d.expected}
            label={t('title')}
            tone="success"
          />
          <p className="m-0 text-caption text-ink-2">
            {t('notArrived', { count: num(d.notArrived, c.locale) })}
          </p>
        </>
      )}
      {d.recent.length === 0 ? (
        d.expected > 0 ? (
          <p className="m-0 text-body text-ink-2">{t('none')}</p>
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" aria-label={t('recent')}>
          {d.recent.map((a) => (
            <li
              key={`${a.arrivedAt}-${a.partyName}-${a.name}`}
              className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-body"
            >
              <time dateTime={a.arrivedAt} className="tabular-nums text-caption text-ink-2">
                {time.format(new Date(a.arrivedAt))}
              </time>
              <span className="font-bold text-ink">{personName(a, guestOf)}</span>
              <span className="text-caption text-ink-2">
                {a.partyName} · {source[a.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href={`${c.base}/day-of`} className={LINK}>
        {t('open')}
      </Link>
    </div>
  );
}
