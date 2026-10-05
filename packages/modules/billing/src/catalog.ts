import type { ModuleKey } from '@yayatoh/platform';

/**
 * The subscription tiers from the pricing research (docs/research/32-gap-pricing-billing.md:
 * $0 / $29 / $99 / $249 / Enterprise), seeded as **placeholders, switched off** (P6-7). The owner
 * sets real prices and module sets with launch data (D22); until then nothing is sold. The
 * migration seeds exactly this catalog (an integration test keeps the two in step) and the fake
 * provider serves it, so dev and CI exercise the same plans Stripe will carry.
 */
export interface PlaceholderPlan {
  readonly key: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly modules: readonly ModuleKey[];
  readonly prices: readonly {
    readonly lookupKey: string;
    readonly currency: string;
    readonly interval: 'month' | 'year';
    /** Minor units; null = quoted (Enterprise). */
    readonly unitAmountMinor: number | null;
  }[];
}

const FREE: readonly ModuleKey[] = [
  'core',
  'events',
  'ticketing',
  'orders',
  'attendees',
  'checkin',
  'seating',
  'seat_finder',
  'guests',
  'rsvp',
  'access_codes',
  'marketing',
  'messaging',
  'reports',
  'ai',
  'chat',
  'donations',
  'gallery',
  'website',
  'api_access',
];
const STARTER: readonly ModuleKey[] = [...FREE, 'distribution', 'registration', 'whitelabel'];
const PRO: readonly ModuleKey[] = [...STARTER, 'sessions', 'speakers', 'integrations', 'advanced_seating'];
const AGENCY: readonly ModuleKey[] = [...PRO, 'agency', 'analytics_pro'];
const ENTERPRISE: readonly ModuleKey[] = [
  ...AGENCY,
  'exhibitors',
  'sponsors',
  'badges',
  'enterprise',
  'virtual',
  'ai_seating',
];

type Price = PlaceholderPlan['prices'][number];
const price = (plan: string, interval: 'month' | 'year', unitAmountMinor: number | null): Price => ({
  lookupKey: `${plan}_${interval}_usd`,
  currency: 'USD',
  interval,
  unitAmountMinor,
});

export const PLACEHOLDER_PLANS: readonly PlaceholderPlan[] = [
  { key: 'tier_free', name: 'Free', sortOrder: 1, modules: FREE, prices: [price('tier_free', 'month', 0)] },
  {
    key: 'tier_starter',
    name: 'Starter',
    sortOrder: 2,
    modules: STARTER,
    prices: [price('tier_starter', 'month', 2900), price('tier_starter', 'year', 29000)],
  },
  {
    key: 'tier_pro',
    name: 'Pro',
    sortOrder: 3,
    modules: PRO,
    prices: [price('tier_pro', 'month', 9900), price('tier_pro', 'year', 99000)],
  },
  {
    key: 'tier_agency',
    name: 'Agency',
    sortOrder: 4,
    modules: AGENCY,
    prices: [price('tier_agency', 'month', 24900), price('tier_agency', 'year', 249000)],
  },
  {
    key: 'tier_enterprise',
    name: 'Enterprise',
    sortOrder: 5,
    modules: ENTERPRISE,
    prices: [price('tier_enterprise', 'year', null)],
  },
];

/** Plan keys the catalog sync may create or update (never the legacy `launch_standard`). */
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;
