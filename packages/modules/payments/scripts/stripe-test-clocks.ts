import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { addBusinessDays } from '../src/settlements.ts';
import { STRIPE_API_VERSION, stripePaymentProvider } from '../src/stripe.ts';
import { testMerchantAccount } from './stripe-test-accounts.ts';

/**
 * Refund-after-transfer against Stripe TEST mode with a test clock (roadmap M1.6 acceptance).
 * Manual, not CI (the automated version runs on the fake provider with a controllable clock:
 * packages/testing/tests/refund-after-transfer.int.test.ts). Run where the owner's test key and
 * api.stripe.com are available:
 *   pnpm --filter @yayatoh/payments stripe:test-clocks [-- --account acct_…]
 * A test clock carries the buyer (a customer frozen at the sale), then advances past the event
 * and the Standard release date (event end + 5 business days); the platform charge is transferred
 * to the organizer, refunded, and taken back by explicit transfer reversals — one that succeeds,
 * and one larger than what is left of the transfer, which fails (the debt stays a receivable).
 * Stripe's clocks move Billing time; charges, transfers and refunds carry real timestamps, so the
 * release date is computed from the clock's frozen time. Prints ids only. Cleans up after itself.
 */
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key))
  throw new Error('Set a Stripe TEST key in STRIPE_SECRET_KEY (never a live key)');
const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, telemetry: false, maxNetworkRetries: 2 });
const provider = stripePaymentProvider({
  secretKey: key,
  webhookSecrets: ['whsec_unused_for_outbound_calls'],
});
const orgId = randomUUID();
const created: string[] = [];
const check = (cond: unknown, what: string) => {
  if (!cond) throw new Error(`assertion failed: ${what}`);
};
const reuse = process.argv.includes('--account')
  ? process.argv[process.argv.indexOf('--account') + 1]
  : undefined;

const frozen = Math.floor(Date.now() / 1000);
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: frozen,
  name: 'yayatoh refund-after-transfer',
});
try {
  const merchant =
    reuse ?? (await testMerchantAccount(stripe, { orgId, onCreated: (id) => created.push(id) }));
  const customer = await stripe.customers.create({ email: 'clock@example.test', test_clock: clock.id });
  // The sale: a platform charge (platform_mor), funds available at once in test mode.
  const orderId = randomUUID();
  const pi = await stripe.paymentIntents.create({
    amount: 60_000,
    currency: 'usd',
    customer: customer.id,
    payment_method: 'pm_card_bypassPending',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    metadata: { orgId, orderId, fundsFlow: 'platform_mor' },
  });
  check(pi.status === 'succeeded', 'sale paid');
  console.info('clock', clock.id, 'sale', pi.id);

  // The event ends three days later; the Standard release is 5 business days after that.
  const eventEnd = new Date((frozen + 3 * 86_400) * 1000);
  const release = addBusinessDays(eventEnd, 5);
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: Math.floor(release.getTime() / 1000) + 3600,
  });
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clock.id);
    if (c.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.info('clock advanced to', release.toISOString().slice(0, 10), '(release date)');

  // Release: 95% transferred, 5% reserve kept.
  const t = await provider.createTransfer({
    destinationAccountId: merchant,
    amount: { amount: 57_000, currency: 'USD' },
    transferGroup: `event:${orderId}`,
    idempotencyKey: `settlement:${randomUUID()}`,
    orgId,
  });
  check(t.status === 'succeeded', `transfer ${t.status} ${t.failure ?? ''}`);

  // A refund after the transfer: 3 000 from the reserve, the rest reversed from the organizer.
  const r1 = await provider.refund({
    providerPaymentId: pi.id,
    amount: { amount: 10_000, currency: 'USD' },
    connectedAccountId: null,
    refundApplicationFee: { amount: 0, currency: 'USD' },
    idempotencyKey: `refund:${randomUUID()}`,
    orgId,
  });
  check(r1.status === 'succeeded', 'first refund');
  const rev1 = await provider.reverseTransfer({
    transferId: t.transferId,
    amount: { amount: 7_000, currency: 'USD' },
    idempotencyKey: `reversal:${randomUUID()}`,
    orgId,
  });
  check(rev1.status === 'succeeded', 'reversal succeeds');

  // The rest of the order refunded; reversing more than is left of the transfer fails.
  const r2 = await provider.refund({
    providerPaymentId: pi.id,
    amount: { amount: 50_000, currency: 'USD' },
    connectedAccountId: null,
    refundApplicationFee: { amount: 0, currency: 'USD' },
    idempotencyKey: `refund:${randomUUID()}`,
    orgId,
  });
  check(r2.status === 'succeeded', 'second refund');
  const rev2 = await provider.reverseTransfer({
    transferId: t.transferId,
    amount: { amount: 60_000, currency: 'USD' },
    idempotencyKey: `reversal:${randomUUID()}`,
    orgId,
  });
  check(rev2.status === 'failed', 'an impossible reversal fails: the debt stays a receivable, netted later');
  const left = await stripe.transfers.retrieve(t.transferId);
  console.info('transfer', t.transferId, 'reversed', left.amount_reversed, 'of', left.amount);
  console.info('refund-after-transfer scenarios passed');
} finally {
  await stripe.testHelpers.testClocks.del(clock.id).catch(() => undefined);
  for (const id of created)
    await stripe.v2.core.accounts
      .close(id, { applied_configurations: ['merchant', 'recipient'] } as Stripe.V2.Core.AccountCloseParams)
      .then(() => console.info('closed', id))
      .catch(() => console.info('could not close', id));
}
