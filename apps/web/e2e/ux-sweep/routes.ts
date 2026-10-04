import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * U11 route sweep: the page templates of an app (from the file system), how to fill their params
 * from the seed, and how to match a URL back to its template. The sweep asserts every template is
 * visited or excluded here with a reason, so a new page cannot slip past it.
 */
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

export interface Template {
  /** URL pattern without the locale, e.g. `/o/[org]/e/[event]/guests`. */
  readonly pattern: string;
  readonly regex: RegExp;
  /** Static segments count: the most specific template wins a match. */
  readonly specificity: number;
  readonly params: readonly string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

export function templates(app: 'web' | 'admin'): Template[] {
  const root = join(REPO, 'apps', app, 'src', 'app');
  return walk(root).map((file) => {
    const segs = relative(root, join(file, '..'))
      .split('/')
      .filter((s) => s && !/^\(.*\)$/.test(s) && s !== '[locale]');
    const pattern = `/${segs.join('/')}`;
    const params = segs.filter((s) => s.startsWith('[')).map((s) => s.slice(1, -1));
    const regex = new RegExp(
      `^${segs.map((s) => (s.startsWith('[') ? '/[^/]+' : `/${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).join('')}/?$`,
    );
    return {
      pattern: pattern === '/' ? '/' : pattern,
      regex: segs.length ? regex : /^\/?$/,
      specificity: segs.filter((s) => !s.startsWith('[')).length * 2 + segs.length,
      params,
    };
  });
}

/** The template a URL path (locale already stripped) belongs to, or null. */
export function matchTemplate(all: readonly Template[], path: string): Template | null {
  let best: Template | null = null;
  for (const t of all) {
    if (!t.regex.test(path)) continue;
    // Prefer the template whose static segments match literally (a static sibling beats `[section]`).
    if (!best || t.specificity > best.specificity) best = t;
  }
  return best;
}

export const ORG = 'lakeside-events';
export const EVENT = 'midwest-leadership-summit-2027';

/** Templates that cannot be reached by a plain GET link; each needs a reason. */
export const EXCLUDED: Record<string, string> = {
  '/auth/social/fake': 'provider redirect target; needs a live state parameter',
  '/auth/sso/fake': 'provider redirect target; needs a live state parameter',
  '/connect/fake': 'payments-provider redirect target; needs a live session',
  '/billing/fake': 'billing-provider redirect target; needs a live session',
  '/checkout/fake': 'payments-provider redirect target; needs a live session',
  '/checkout/fake/setup': 'payments-provider redirect target; needs a live session',
  '/dev/integrations/authorize': 'OAuth redirect target; needs a live state parameter',
  '/account/deleted': 'shown once, after an account deletion',
};

/** Pages behind a signed link or code that only exists in the recipient's email, ticket or QR code. */
const SIGNED_LINK_PAGES = [
  '/certificates/[org]/verify/[code]',
  '/claim/[token]',
  '/collect/[code]',
  '/display/[token]',
  '/event-portal/invite/[token]',
  '/event-portal/verify/[token]',
  '/events/[slug]/group/[token]',
  '/events/[slug]/invoice/[token]',
  '/events/[slug]/pledge/[token]',
  '/events/[slug]/registration/[token]',
  '/events/[slug]/seat-finder/help/[token]',
  '/giving-screen/[token]',
  '/hub/[token]',
  '/invite/[token]',
  '/messages/[token]',
  '/my-tickets/[token]',
  '/my-tickets/verify/[token]',
  '/orders/[token]/hub',
  '/orders/[token]',
  '/orders/[token]/schedule',
  '/preferences/[org]/[token]',
  '/registration-form/[token]',
  '/rsvp/[token]/card',
  '/rsvp/[token]',
  '/rsvp/[token]/seat',
  '/rsvp/find/[code]',
  '/session-checkin/[token]',
  '/survey/[token]',
  '/t/[org]/my-tickets/verify/[token]',
  '/tables/[token]',
  '/tv/[token]',
  '/unsubscribe/[token]',
  '/w/[code]/gallery',
  '/w/[code]/slideshow',
  '/waitlist/[token]',
  '/webhook-portal/[token]',
];

/**
 * Detail pages of a record the seed does not create (journeys, campaigns, orders, badges…): the
 * list page they hang off is swept and each has its own feature spec. The sweep's backlog
 * (docs/ux/backlog.md) lists them as "not swept: needs data".
 */
const RECORD_PAGES = [
  '/blogs/[slug]',
  '/developers/guides/[guide]',
  '/event-portal/chat/[conversation]',
  '/event-portal/reviews/[submission]',
  '/event-portal/sessions/[session]',
  '/event-portal/sign-in/[site]',
  '/events/[slug]/live/[session]',
  '/events/[slug]/network/booths/[exhibitor]',
  '/events/[slug]/network/chat/[person]',
  '/events/[slug]/network/people/[person]',
  '/events/[slug]/speakers/[speaker]',
  '/events/[slug]/watch/[ticket]/[session]',
  '/events/[slug]/watch/[ticket]',
  '/help/[category]/[article]',
  '/help/[category]',
  '/o/[org]/analytics/alerts/[ruleId]',
  '/o/[org]/analytics/reports/[scheduleId]',
  '/o/[org]/audiences/[segment]',
  '/o/[org]/audiences/duplicates/[candidate]',
  '/o/[org]/audiences/people/[contact]',
  '/o/[org]/campaigns/[campaign]',
  '/o/[org]/contacts/[contact]',
  '/o/[org]/content/[entry]',
  '/o/[org]/help-center/[article]',
  '/o/[org]/help-center/categories/[category]',
  '/o/[org]/integrations/[connection]/import',
  '/o/[org]/integrations/[connection]',
  '/o/[org]/journeys/[journey]',
  '/o/[org]/journeys/[journey]/runs/[run]',
  '/o/[org]/marketing/[section]',
  '/o/[org]/messages/[threadId]',
  '/o/[org]/payouts/[settlement]',
  '/o/[org]/privacy/requests/[id]',
  '/o/[org]/series/[series]/details',
  '/o/[org]/series/[series]/next',
  '/o/[org]/series/[series]',
  '/o/[org]/templates/[template]',
  '/o/[org]/venues/[venue]',
  '/o/[org]/webhooks/[endpoint]',
  '/o/[org]/e/[event]/[section]',
  '/o/[org]/e/[event]/badges/[templateId]',
  '/o/[org]/e/[event]/badges/print/[ticketId]',
  '/o/[org]/e/[event]/badges/printing/[printerId]',
  '/o/[org]/e/[event]/guests/collector/[submission]',
  '/o/[org]/e/[event]/guests/rsvp/[party]',
  '/o/[org]/e/[event]/marketing/surveys/[survey]',
  '/o/[org]/e/[event]/onsite/sessions/[checkpoint]/flyer',
  '/o/[org]/e/[event]/orders/[orderId]/disputes/[disputeId]',
  '/o/[org]/e/[event]/orders/[orderId]',
  '/o/[org]/e/[event]/sessions/[session]/live',
  '/o/[org]/e/[event]/sessions/[session]/live/present',
  '/o/[org]/e/[event]/speakers/cfp/[submission]',
  '/o/[org]/e/[event]/tracked-links/[link]',
  '/organizers/[slug]/blogs/[post]',
  '/organizers/[slug]/pages/[page]',
  '/pages/[slug]',
  '/t/[org]/blogs/[slug]',
  '/t/[org]/events/[slug]/speakers/[speaker]',
  '/t/[org]/pages/[slug]',
  '/venues/[slug]',
];

for (const p of SIGNED_LINK_PAGES) EXCLUDED[p] = 'signed link emailed to the recipient (no seeded token)';
for (const p of RECORD_PAGES) EXCLUDED[p] = 'detail page of a record the seed does not create';

/** Admin pages the sweep cannot open. */
export const EXCLUDED_ADMIN: Record<string, string> = {
  '/charities/[orgId]': 'detail page of a charity the seed does not create',
};

/** Links the crawl never follows (side effects on GET, or not pages). */
export const NO_FOLLOW =
  /(?:sign-out|logout|\/api\/|unsubscribe|\/lang\/|\.csv|\.pdf|\.ics|\.xml|\.json|\/download|\/export|\/_next\/|\/dev\/(?:mailbox|login))/;
