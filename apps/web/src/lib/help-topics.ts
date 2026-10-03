/**
 * U2: the pages with a "How it works" panel (UX review 1: Domains, Templates, Series, Payouts,
 * Sending, event type and category, Coupons). Copy is `howItWorks.<topic>.{title,intro,stepN}`;
 * `query` searches the platform help center (`/help/search`), so the link never breaks when the
 * help team renames an article.
 */
export const HELP_TOPICS = {
  domains: { steps: 4, query: 'custom domain' },
  templates: { steps: 3, query: 'event template' },
  series: { steps: 3, query: 'event series' },
  payouts: { steps: 4, query: 'payouts' },
  sending: { steps: 4, query: 'sending domain' },
  eventType: { steps: 3, query: 'event type' },
  coupons: { steps: 3, query: 'promo code' },
} as const satisfies Record<string, { steps: number; query: string }>;

export type HelpTopic = keyof typeof HELP_TOPICS;
export const HELP_TOPIC_KEYS = Object.keys(HELP_TOPICS) as HelpTopic[];

/** The help panels a member collapsed (dot-separated topic keys). */
export const HELP_COOKIE = 'yy_help_closed';

export function parseClosedHelp(raw: string | undefined): Set<HelpTopic> {
  const known = new Set<string>(HELP_TOPIC_KEYS);
  return new Set((raw ?? '').split('.').filter((k): k is HelpTopic => known.has(k)));
}

export function serializeClosedHelp(closed: Iterable<HelpTopic>): string {
  const set = new Set(closed);
  return HELP_TOPIC_KEYS.filter((k) => set.has(k)).join('.');
}
