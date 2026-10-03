import { LOCALES, type Locale } from '@yayatoh/contracts';
import { formatMoney, money } from '@yayatoh/kernel';
import { renderMessage } from '@yayatoh/notifications';
import { IntlMessageFormat } from 'intl-messageformat';
import ar from './messages/ar.json' with { type: 'json' };
import de from './messages/de.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };
import es from './messages/es.json' with { type: 'json' };
import fr from './messages/fr.json' with { type: 'json' };
import hi from './messages/hi.json' with { type: 'json' };
import it from './messages/it.json' with { type: 'json' };
import ja from './messages/ja.json' with { type: 'json' };
import nl from './messages/nl.json' with { type: 'json' };
import pt from './messages/pt.json' with { type: 'json' };
import ru from './messages/ru.json' with { type: 'json' };
import zhCN from './messages/zh-CN.json' with { type: 'json' };
import zhTW from './messages/zh-TW.json' with { type: 'json' };

/**
 * Slack messages (M6.4c): an alert from the M3.2b engine, the daily digest and the test alert,
 * as Block Kit plus a plain-text fallback, in the org's language. Pure: the facts come in, the
 * message goes out.
 *
 * **No personal data beyond names (P6-4, M6.4c):** the inputs carry event names, counts and the
 * org's name; never an email, phone or a person's details. Amounts appear only when the caller
 * says the connection's owner may see them (`includeFinance`). `slackPiiProblems` re-checks every
 * message before it is sent. Text from organizers (event names) is escaped, so a name can never
 * become a Slack mention or link.
 */

export type SlackBlock =
  | { readonly type: 'header'; readonly text: { readonly type: 'plain_text'; readonly text: string } }
  | { readonly type: 'section'; readonly text: { readonly type: 'mrkdwn'; readonly text: string } }
  | {
      readonly type: 'context';
      readonly elements: readonly { readonly type: 'mrkdwn'; readonly text: string }[];
    }
  | { readonly type: 'divider' };

export interface SlackMessage {
  /** The notification and accessibility fallback. */
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
}

type Catalog = typeof en;
export const SLACK_MESSAGES: Readonly<Record<Locale, Catalog>> = {
  en,
  es,
  fr,
  de,
  it,
  pt,
  nl,
  ru,
  ar,
  hi,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

export const slackLocale = (l: string | null | undefined): Locale =>
  (LOCALES as readonly string[]).includes(l ?? '') ? (l as Locale) : 'en';

const fmt = (message: string, locale: Locale, values: Record<string, string | number> = {}) =>
  String(new IntlMessageFormat(message, locale, undefined, { ignoreTag: true }).format(values));

/** Slack mrkdwn escaping: `&`, `<` and `>` (so `<!channel>` or `<http…|…>` stay plain text). */
export const escapeMrkdwn = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const header = (text: string): SlackBlock => ({
  type: 'header',
  text: { type: 'plain_text', text: cap(text, 150) },
});
const section = (text: string): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text: cap(text, 2900) },
});
const context = (text: string): SlackBlock => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text: cap(text, 2900) }],
});

/** A link to our own console (https only; never a `|` or `>` that would break the markup). */
function link(url: string, label: string): string {
  const safe = /^https:\/\/[^\s|<>]+$/.test(url) ? url : null;
  return safe ? `<${safe}|${escapeMrkdwn(label)}>` : escapeMrkdwn(label);
}

export const SLACK_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type SlackSeverity = (typeof SLACK_SEVERITIES)[number];
const SEVERITY_ICON: Record<SlackSeverity, string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
};

export interface AlertInput {
  readonly locale: string;
  readonly orgName: string;
  /** An M3.2b rule key (`paymentsFailed`, …). */
  readonly rule: string;
  readonly severity: SlackSeverity;
  readonly count: number;
  readonly eventName: string | null;
  /** The console page that fixes it (absolute). */
  readonly url: string;
}

/** An alert, in the words of the alert's own email (one copy for every channel). */
export function renderSlackAlert(a: AlertInput): SlackMessage {
  const lang = slackLocale(a.locale);
  const cat = SLACK_MESSAGES[lang];
  const r = renderMessage({
    kind: 'alerts.alert',
    locale: lang,
    params: { rule: a.rule, count: a.count, severity: a.severity, eventName: a.eventName ?? 'none' },
    org: { name: a.orgName, brandColor: null, poweredByVisible: false },
  });
  const severity = cat.severity[a.severity];
  const where = a.eventName ?? a.orgName;
  return {
    text: `${severity}: ${r.subject} (${where})`,
    blocks: [
      section(`${SEVERITY_ICON[a.severity]} *${escapeMrkdwn(r.subject)}*`),
      context(fmt(cat.alert.context, lang, { severity, where: escapeMrkdwn(where) })),
      section(link(a.url, cat.alert.open)),
    ],
  };
}

/** The test alert the connection page sends. */
export function renderSlackTest(t: { locale: string; orgName: string; url: string }): SlackMessage {
  const lang = slackLocale(t.locale);
  const cat = SLACK_MESSAGES[lang];
  const title = fmt(cat.test.title, lang, { org: t.orgName });
  return {
    text: title,
    blocks: [
      section(`${SEVERITY_ICON.info} *${escapeMrkdwn(title)}*`),
      section(escapeMrkdwn(cat.test.body)),
      context(`${link(t.url, cat.alert.open)} · ${escapeMrkdwn(cat.footer)}`),
    ],
  };
}

export interface MoneyAmount {
  readonly currency: string;
  readonly minor: number;
}

export interface DigestFacts {
  readonly orgName: string;
  /** The day the digest covers, `YYYY-MM-DD` in the org's time zone. */
  readonly day: string;
  readonly totals: {
    readonly orders: number;
    readonly tickets: number;
    readonly gross: readonly MoneyAmount[];
  };
  /** Sales per event that sold something that day, best first. */
  readonly events: readonly {
    readonly name: string;
    readonly tickets: number;
    readonly gross: readonly MoneyAmount[];
  }[];
  /** Tickets checked in that day. */
  readonly checkins: number;
  /** Events starting on the digest's own day, in each event's zone. */
  readonly today: readonly { readonly name: string; readonly startsAt: Date; readonly timeZone: string }[];
  /** The org's dashboard (absolute). */
  readonly url: string;
}

/** Events listed by name in each section; the rest are counted. */
export const DIGEST_EVENT_LINES = 5;

const amounts = (list: readonly MoneyAmount[], locale: Locale) =>
  list.map((m) => formatMoney(money(m.minor, m.currency), locale)).join(' + ');

/** The daily digest: the day's sales and check-ins, and today's events. Amounts only on opt-in. */
export function renderSlackDigest(
  f: DigestFacts,
  opts: { readonly locale: string; readonly includeFinance: boolean },
): SlackMessage {
  const lang = slackLocale(opts.locale);
  const cat = SLACK_MESSAGES[lang];
  const day = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${f.day}T12:00:00Z`),
  );
  const title = fmt(cat.digest.title, lang, { org: f.orgName });
  const finance = opts.includeFinance && f.totals.gross.length > 0;
  const sales = [
    `*${escapeMrkdwn(cat.digest.salesTitle)}*`,
    fmt(cat.digest.sales, lang, { orders: f.totals.orders, tickets: f.totals.tickets }),
    ...(finance ? [fmt(cat.digest.revenue, lang, { amounts: amounts(f.totals.gross, lang) })] : []),
    fmt(cat.digest.checkins, lang, { count: f.checkins }),
  ];
  const eventLines = f.events
    .slice(0, DIGEST_EVENT_LINES)
    .map((e) =>
      opts.includeFinance && e.gross.length
        ? `• ${fmt(cat.digest.eventLineRevenue, lang, { name: escapeMrkdwn(e.name), tickets: e.tickets, amounts: amounts(e.gross, lang) })}`
        : `• ${fmt(cat.digest.eventLine, lang, { name: escapeMrkdwn(e.name), tickets: e.tickets })}`,
    );
  if (f.events.length > DIGEST_EVENT_LINES)
    eventLines.push(fmt(cat.digest.moreEvents, lang, { count: f.events.length - DIGEST_EVENT_LINES }));
  const today = f.today.slice(0, DIGEST_EVENT_LINES).map((e) => {
    const time = new Intl.DateTimeFormat(lang, { timeStyle: 'short', timeZone: e.timeZone }).format(
      e.startsAt,
    );
    return `• ${fmt(cat.digest.todayEvent, lang, { name: escapeMrkdwn(e.name), time })}`;
  });
  if (f.today.length > DIGEST_EVENT_LINES)
    today.push(fmt(cat.digest.moreEvents, lang, { count: f.today.length - DIGEST_EVENT_LINES }));
  return {
    text: `${title} · ${day}`,
    blocks: [
      header(title),
      context(escapeMrkdwn(day)),
      section(sales.join('\n')),
      ...(eventLines.length ? [section(eventLines.join('\n'))] : []),
      { type: 'divider' },
      section(
        [
          `*${escapeMrkdwn(cat.digest.todayTitle)}*`,
          ...(today.length ? today : [escapeMrkdwn(cat.digest.noEventsToday)]),
        ].join('\n'),
      ),
      context(`${link(f.url, cat.digest.open)} · ${escapeMrkdwn(cat.footer)}`),
    ],
  };
}

/** Every piece of text in a message (fallback and blocks), for the guard and for tests. */
export function slackText(m: SlackMessage): string {
  const parts = [m.text];
  for (const b of m.blocks) {
    if (b.type === 'header' || b.type === 'section') parts.push(b.text.text);
    if (b.type === 'context') for (const e of b.elements) parts.push(e.text);
  }
  return parts.join('\n');
}

const EMAIL = /[^\s@<>|:;,()]+@[^\s@<>|:;,()]+\.[A-Za-z]{2,}/;
/** An international phone number (`+` and at least eight digits, the way contacts store them). */
const PHONE = /\+\d[\d\s().-]{6,}\d/;

/**
 * Personal data a Slack message must never carry (M6.4c): email addresses and phone numbers, and,
 * unless finance is allowed, any of the amounts the caller knows about. Returns the problems
 * (empty: safe to send); the sender refuses a message with any.
 */
export function slackPiiProblems(
  m: SlackMessage,
  opts: { readonly amounts?: readonly string[] } = {},
): ('email' | 'phone' | 'amount')[] {
  const text = slackText(m);
  const out: ('email' | 'phone' | 'amount')[] = [];
  if (EMAIL.test(text)) out.push('email');
  if (PHONE.test(text)) out.push('phone');
  if (opts.amounts?.some((a) => a && text.includes(a))) out.push('amount');
  return out;
}

/** The formatted amounts a digest's facts would show (what the guard looks for without finance). */
export function digestAmounts(f: DigestFacts, locale: string): string[] {
  const lang = slackLocale(locale);
  const all = [...f.totals.gross, ...f.events.flatMap((e) => e.gross)];
  return all.filter((m) => m.minor !== 0).map((m) => formatMoney(money(m.minor, m.currency), lang));
}
