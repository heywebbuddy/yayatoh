type Env = Readonly<Record<string, string | undefined>>;

/**
 * Subscription billing is off unless `BILLING_ENABLED` is set (P6-1, P6-7). Off, nothing changes
 * for any org: the billing webhook answers 404, no customer is created, and modules come from the
 * org's plan exactly as before. On, it still applies only to orgs that have a billing customer.
 */
export function billingEnabled(env: Env = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.BILLING_ENABLED ?? '').trim().toLowerCase());
}

/**
 * Agency v2 money (M6.8a, P6-1, P6-8): the flag `agency_v2`. Off unless `AGENCY_V2_ENABLED` is set:
 * no offer can be made or accepted, no agency covers a client, no commission accrues. On, it
 * applies to agency orgs with the `agency` entitlement (P6-13). Commission already earned is still
 * transferred and reversed when the flag goes off (money in flight is never stranded).
 */
export function agencyV2Enabled(env: Env = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.AGENCY_V2_ENABLED ?? '').trim().toLowerCase());
}
