type Env = Readonly<Record<string, string | undefined>>;

/**
 * Subscription billing is off unless `BILLING_ENABLED` is set (P6-1, P6-7). Off, nothing changes
 * for any org: the billing webhook answers 404, no customer is created, and modules come from the
 * org's plan exactly as before. On, it still applies only to orgs that have a billing customer.
 */
export function billingEnabled(env: Env = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.BILLING_ENABLED ?? '').trim().toLowerCase());
}
