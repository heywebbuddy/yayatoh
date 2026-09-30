/**
 * Pre-checkout risk rules (roadmap §5.3 "Yayatoh's pre-checkout risk rules", M1.6e). A small
 * rules config evaluated before an order is created, through a port: today the `rules` adapter
 * evaluates it locally (the fake); Stripe Radar (platform Radar for Fraud Teams on platform_mor,
 * the connected account's Radar on organizer_mor) still scores the card at payment time.
 * Signal names are checkout's own; the door's fraud signals (M1.9: `two_entrances`,
 * `invalid_burst`) are separate and stay with check-in.
 */
export const CHECKOUT_RISK_SIGNALS = ['email_velocity', 'payment_failures', 'country_mismatch'] as const;
export type CheckoutRiskSignal = (typeof CHECKOUT_RISK_SIGNALS)[number];

/** Signals are counted over this window before the checkout. */
export const RISK_WINDOW_MINUTES = 60;

export interface CheckoutRiskRule {
  readonly id: string;
  readonly signal: CheckoutRiskSignal;
  /** Counts (`email_velocity`, `payment_failures`): the rule fires at this many or more. */
  readonly threshold?: number;
  readonly action: 'review' | 'block';
}

/** Defaults pending the owner (D3 / fraud policy): conservative, review before block. */
export const DEFAULT_CHECKOUT_RISK_RULES: readonly CheckoutRiskRule[] = [
  { id: 'email_velocity_block', signal: 'email_velocity', threshold: 10, action: 'block' },
  { id: 'payment_failures_block', signal: 'payment_failures', threshold: 5, action: 'block' },
  { id: 'email_velocity_review', signal: 'email_velocity', threshold: 4, action: 'review' },
  { id: 'country_mismatch_review', signal: 'country_mismatch', action: 'review' },
];

export interface CheckoutRiskInput {
  readonly orgId: string;
  readonly eventId: string;
  /** Orders by the same email in this org in the last hour (any status). */
  readonly emailOrders: number;
  /** Of those, how many failed to pay. */
  readonly paymentFailures: number;
  /** ISO 3166 country of the request (the host's geo header), when known. */
  readonly ipCountry: string | null;
  /** The event's country, when set. */
  readonly eventCountry: string | null;
}

export interface CheckoutRiskDecision {
  readonly action: 'allow' | 'review' | 'block';
  /** The rules that fired. */
  readonly rules: readonly string[];
}

export interface CheckoutRiskProvider {
  readonly name: 'rules';
  assess(input: CheckoutRiskInput): Promise<CheckoutRiskDecision>;
}

const fires = (r: CheckoutRiskRule, i: CheckoutRiskInput) => {
  switch (r.signal) {
    case 'email_velocity':
      return i.emailOrders >= (r.threshold ?? Number.POSITIVE_INFINITY);
    case 'payment_failures':
      return i.paymentFailures >= (r.threshold ?? Number.POSITIVE_INFINITY);
    case 'country_mismatch':
      return Boolean(
        i.ipCountry && i.eventCountry && i.ipCountry.toUpperCase() !== i.eventCountry.toUpperCase(),
      );
  }
};

/** Evaluate the rules (pure): any block wins, then any review. */
export function evaluateCheckoutRisk(
  rules: readonly CheckoutRiskRule[],
  input: CheckoutRiskInput,
): CheckoutRiskDecision {
  const fired = rules.filter((r) => fires(r, input));
  const block = fired.filter((r) => r.action === 'block');
  if (block.length) return { action: 'block', rules: block.map((r) => r.id) };
  return fired.length ? { action: 'review', rules: fired.map((r) => r.id) } : { action: 'allow', rules: [] };
}

/** The local rules adapter (the fake until Radar for Fraud Teams exists on the owner's account). */
export function rulesRiskProvider(
  rules: readonly CheckoutRiskRule[] = DEFAULT_CHECKOUT_RISK_RULES,
): CheckoutRiskProvider {
  return { name: 'rules', assess: async (i) => evaluateCheckoutRisk(rules, i) };
}
