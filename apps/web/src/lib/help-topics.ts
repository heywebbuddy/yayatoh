/**
 * U2: the pages with a "How it works" panel (UX review 1: Domains, Templates, Series, Payouts,
 * Sending, event type and category, Coupons). Copy is `howItWorks.<topic>.{title,intro,stepN}`.
 */
export const HELP_TOPICS = {
  domains: { steps: 4 },
  templates: { steps: 3 },
  series: { steps: 3 },
  payouts: { steps: 4 },
  sending: { steps: 4 },
  eventType: { steps: 3 },
  coupons: { steps: 3 },
  // U5: the Money pages (the payout rules were prose on the Payouts page).
  money: { steps: 4 },
  payoutRules: { steps: 3 },
  fees: { steps: 3 },
} as const satisfies Record<string, { steps: number }>;

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
