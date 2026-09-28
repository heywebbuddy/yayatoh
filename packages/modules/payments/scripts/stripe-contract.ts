import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import Stripe from 'stripe';
import { accountState, STRIPE_API_VERSION, stripePaymentProvider } from '../src/stripe.ts';

/**
 * Contract check of the Stripe adapter against Stripe TEST mode (M1.5e3). Not part of CI: run it
 * by hand where the owner's test keys exist and api/connect/files.stripe.com are reachable:
 *   pnpm --filter @yayatoh/payments stripe:contract [-- --capture]
 * Every call `stripePaymentProvider` makes is exercised against real test-mode objects and the
 * adapter's parsing of the real responses is asserted. Real event payloads (`events.list`) are
 * signed locally with a throwaway secret and run through the webhook parser; `--capture` writes
 * them, redacted (no ids, emails or secrets), to tests/fixtures/stripe/ for the unit tests.
 * Prints ids only, never keys. Connected accounts it creates are closed at the end.
 */
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key))
  throw new Error('Set a Stripe TEST key in STRIPE_SECRET_KEY (never a live key)');
const capture = process.argv.includes('--capture');

const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, telemetry: false, maxNetworkRetries: 2 });
/** Throwaway signing secret: events from `events.list` are signed locally, as Stripe would. */
const THROWAWAY = `whsec_contract_${randomUUID().replaceAll('-', '')}`;
const provider = stripePaymentProvider({ secretKey: key, webhookSecrets: [THROWAWAY] });
const started = new Date(Date.now() - 60_000);
const orgId = randomUUID();
const created: string[] = [];
const results: { step: string; ok: boolean; detail: string }[] = [];

function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${what}`);
}
async function step(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, detail });
    console.info(`ok   ${name}: ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0]?.slice(0, 300) : String(err);
    results.push({ step: name, ok: false, detail: detail ?? '' });
    console.info(`FAIL ${name}: ${detail}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (amount: number) => ({ amount, currency: 'USD' });

/** A connected account Stripe lets the platform onboard with test data (requirements owned by us). */
async function testMerchantAccount(): Promise<string> {
  const a = await stripe.v2.core.accounts.create({
    contact_email: 'contract-org@example.test',
    display_name: 'Contract Org',
    dashboard: 'none',
    identity: {
      country: 'us',
      entity_type: 'individual',
      attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '8.8.8.8' } } },
      individual: {
        given_name: 'Jenny',
        surname: 'Rosen',
        email: 'contract-org@example.test',
        phone: '0000000000',
        date_of_birth: { day: 1, month: 1, year: 1901 },
        address: {
          line1: 'address_full_match',
          city: 'Washington',
          state: 'DC',
          postal_code: '20001',
          country: 'us',
        },
        id_numbers: [{ type: 'us_ssn', value: '000000000' }],
      },
    },
    configuration: {
      merchant: {
        capabilities: { card_payments: { requested: true } },
        mcc: '7922',
        support: { url: 'https://accessible.stripe.com', phone: '0000000000' },
        statement_descriptor: { descriptor: 'CONTRACT ORG' },
      },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    defaults: {
      currency: 'usd',
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
    },
    metadata: { orgId, purpose: 'stripe-contract' },
  } as Stripe.V2.Core.AccountCreateParams);
  created.push(a.id);
  await stripe.accounts.createExternalAccount(a.id, { external_account: 'btok_us_verified' });
  await stripe.accounts.update(a.id, {
    business_profile: { url: 'https://accessible.stripe.com', product_description: 'Event tickets' },
    settings: { payments: { statement_descriptor: 'CONTRACT ORG' } },
  });
  for (let i = 0; i < 180; i++) {
    const s = accountState(await stripe.accounts.retrieve(a.id));
    if (s.chargesEnabled && s.payoutsEnabled) return a.id;
    await sleep(5_000);
  }
  throw new Error(
    `${a.id} did not become charges_enabled within 15 minutes (rerun with --account once it is)`,
  );
}

/** A confirmed test card payment (what a completed Checkout Session leaves behind). */
async function paidIntent(opts: {
  amount: number;
  card: string;
  orderId: string;
  account?: string;
  fee?: number;
}): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.create(
    {
      amount: opts.amount,
      currency: 'usd',
      payment_method: opts.card,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { orgId, orderId: opts.orderId, fundsFlow: opts.account ? 'organizer_mor' : 'platform_mor' },
      ...(opts.fee ? { application_fee_amount: opts.fee } : {}),
    },
    opts.account ? { stripeAccount: opts.account } : {},
  );
}

let merchant = '';
let fullAccount = '';
const platformOrder = randomUUID();
const directOrder = randomUUID();
const disputeOrder = randomUUID();
const refundKey = `refund:${randomUUID()}`;
const feeRefundKey = `refund:${randomUUID()}`;
const settlementKey = `settlement:${randomUUID()}`;
const reversalKey = `reversal:${randomUUID()}`;
let transferId = '';
let disputeId = '';

await step('platform_mor Checkout Session (managed payments off)', async () => {
  const r = await provider.createPayment({
    orgId,
    orderId: platformOrder,
    amount: usd(1250),
    fundsFlow: 'platform_mor',
    connectedAccountId: null,
    applicationFee: usd(0),
    buyerEmail: 'contract@example.test',
    description: 'Yayatoh contract test',
    idempotencyKey: `contract:${platformOrder}`,
    returnUrl: 'https://example.test/orders/contract',
  });
  const s = await stripe.checkout.sessions.retrieve(r.providerPaymentId);
  check(s.amount_total === 1250 && s.currency === 'usd', 'session amount');
  check(s.metadata?.orderId === platformOrder, 'session metadata');
  check(!s.managed_payments?.enabled, 'managed payments disabled');
  check(r.redirectUrl.startsWith('https://checkout.stripe.com/'), 'hosted URL');
  await stripe.checkout.sessions.expire(s.id);
  return s.id;
});

await step('Connect account (Accounts v2, Standard-equivalent) + onboarding link', async () => {
  const { accountId } = await provider.createConnectedAccount({
    orgId,
    country: 'US',
    email: 'contract-full@example.test',
  });
  created.push(accountId);
  fullAccount = accountId;
  const again = await provider.createConnectedAccount({
    orgId,
    country: 'US',
    email: 'contract-full@example.test',
  });
  check(again.accountId === accountId, 'idempotent per org');
  const a = await stripe.accounts.retrieve(accountId);
  const s = accountState(a);
  check(s.accountId === accountId && s.country === 'US', 'accountState parses the v1 view');
  check(!s.chargesEnabled && s.requirementsDue.length > 0, 'not yet onboarded');
  check(a.metadata?.orgId === orgId, 'org metadata visible to account.updated');
  const link = await provider.createOnboardingLink({
    orgId,
    accountId,
    returnUrl: 'https://example.test/payouts?onboarding=returned',
    refreshUrl: 'https://example.test/payouts?onboarding=refresh',
  });
  check(link.url.startsWith('https://connect.stripe.com/'), 'hosted onboarding');
  return `${accountId}; ${s.requirementsDue.length} requirements due`;
});

await step('test merchant account onboarded with test data', async () => {
  // `--account acct_…` reuses a test merchant account a previous run onboarded (verification of a
  // new one can take several minutes in test mode). It is not closed at the end.
  const reuse = process.argv[process.argv.indexOf('--account') + 1];
  merchant = process.argv.includes('--account') && reuse ? reuse : await testMerchantAccount();
  const s = accountState(await stripe.accounts.retrieve(merchant));
  check(s.chargesEnabled && s.payoutsEnabled && s.detailsSubmitted, 'active');
  return merchant;
});

await step('organizer_mor direct-charge Checkout Session with application fee', async () => {
  check(merchant, 'needs the merchant account');
  const r = await provider.createPayment({
    orgId,
    orderId: directOrder,
    amount: usd(5000),
    fundsFlow: 'organizer_mor',
    connectedAccountId: merchant,
    applicationFee: usd(500),
    buyerEmail: 'contract@example.test',
    description: 'Yayatoh contract test (direct)',
    idempotencyKey: `contract:${directOrder}`,
    returnUrl: 'https://example.test/orders/contract',
  });
  const s = await stripe.checkout.sessions.retrieve(r.providerPaymentId, {}, { stripeAccount: merchant });
  check(s.amount_total === 5000 && s.metadata?.fundsFlow === 'organizer_mor', 'direct session');
  await stripe.checkout.sessions.expire(s.id, {}, { stripeAccount: merchant });
  return s.id;
});

await step('organizer_mor refund on the connected account with an application-fee refund', async () => {
  check(merchant, 'needs the merchant account');
  const pi = await paidIntent({
    amount: 5000,
    card: 'pm_card_visa',
    orderId: directOrder,
    account: merchant,
    fee: 500,
  });
  check(pi.status === 'succeeded', 'direct charge paid');
  const r = await provider.refund({
    providerPaymentId: pi.id,
    amount: usd(2000),
    connectedAccountId: merchant,
    refundApplicationFee: usd(200),
    idempotencyKey: feeRefundKey,
    orgId,
  });
  check(r.status === 'succeeded', `refund ${r.status}`);
  const charge = await stripe.charges.retrieve(String(pi.latest_charge), {}, { stripeAccount: merchant });
  const fee = await stripe.applicationFees.retrieve(String(charge.application_fee));
  check(fee.amount_refunded === 200, `application fee refunded ${fee.amount_refunded}`);
  return `${pi.id} → ${r.refundId}; fee ${fee.id} refunded 200`;
});

await step('platform_mor refund (partial) on the platform charge', async () => {
  const pi = await paidIntent({ amount: 10_000, card: 'pm_card_bypassPending', orderId: platformOrder });
  const r = await provider.refund({
    providerPaymentId: pi.id,
    amount: usd(1000),
    connectedAccountId: null,
    refundApplicationFee: usd(0),
    idempotencyKey: refundKey,
    orgId,
  });
  check(r.status === 'succeeded', `refund ${r.status}`);
  const again = await provider.refund({
    providerPaymentId: pi.id,
    amount: usd(1000),
    connectedAccountId: null,
    refundApplicationFee: usd(0),
    idempotencyKey: refundKey,
    orgId,
  });
  check(again.refundId === r.refundId, 'idempotent per key');
  return `${pi.id} → ${r.refundId}`;
});

await step('transfer at release, then an explicit transfer reversal', async () => {
  check(merchant, 'needs the merchant account');
  const t = await provider.createTransfer({
    destinationAccountId: merchant,
    amount: usd(3000),
    transferGroup: `event:${randomUUID()}`,
    idempotencyKey: settlementKey,
    orgId,
  });
  check(t.status === 'succeeded', `transfer ${t.status} ${t.failure ?? ''}`);
  transferId = t.transferId;
  const rev = await provider.reverseTransfer({
    transferId,
    amount: usd(1000),
    idempotencyKey: reversalKey,
    orgId,
  });
  check(rev.status === 'succeeded', `reversal ${rev.status}`);
  const tooMuch = await provider.reverseTransfer({
    transferId,
    amount: usd(99_000),
    idempotencyKey: `reversal:${randomUUID()}`,
    orgId,
  });
  check(tooMuch.status === 'failed', 'an impossible reversal is a failure (the debt stays a receivable)');
  return `${transferId}, reversal ${rev.reversalId}`;
});

await step('a transfer to an account that cannot receive one fails cleanly', async () => {
  check(fullAccount, 'needs the unonboarded account');
  const t = await provider.createTransfer({
    destinationAccountId: fullAccount,
    amount: usd(100),
    transferGroup: 'event:contract',
    idempotencyKey: `settlement:${randomUUID()}`,
    orgId,
  });
  check(t.status === 'failed' && t.failure, 'failed with a code');
  return `failure=${t.failure}`;
});

await step('dispute lookup and evidence submission (platform charge)', async () => {
  const pi = await paidIntent({ amount: 1500, card: 'pm_card_createDispute', orderId: disputeOrder });
  let dispute: Stripe.Dispute | undefined;
  for (let i = 0; i < 24 && !dispute; i++) {
    dispute = (await stripe.disputes.list({ payment_intent: pi.id, limit: 1 })).data[0];
    if (!dispute) await sleep(5_000);
  }
  check(dispute, 'Stripe opened the test dispute');
  disputeId = dispute.id;
  // The adapter resolves disputes to orders through the Checkout Session (none here: no browser).
  const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
  const pdf = minimalPdf('Yayatoh contract test evidence');
  const r = await provider.submitDisputeEvidence({
    providerDisputeId: dispute.id,
    // Stripe's magic text: the test dispute closes as won.
    summary: 'winning_evidence',
    packet: { bytes: pdf, filename: 'evidence.pdf' },
    idempotencyKey: `evidence:${dispute.id}`,
  });
  check(r.status === 'submitted', `evidence ${r.status}`);
  const after = await stripe.disputes.retrieve(dispute.id);
  check(after.evidence.uncategorized_file, 'the packet file is attached');
  return `${dispute.id} (${sessions.data.length} session(s) for its payment); evidence ${after.status}`;
});

await step('balance transactions are attributed to the org and the ledger references', async () => {
  await sleep(5_000);
  const bts =
    (await provider.listBalanceTransactions({ from: started, to: new Date(Date.now() + 60_000) })) ?? [];
  const mine = bts.filter((b) => b.orgId === orgId);
  const refs = new Set(mine.map((b) => `${b.kind}:${b.reference}`));
  const want = [
    `charge:order:${platformOrder}`,
    `refund:${refundKey}`,
    `application_fee:order:${directOrder}`,
    `application_fee_refund:${feeRefundKey}`,
    `transfer:${settlementKey}`,
    `transfer_reversal:${reversalKey}`,
    `charge:order:${disputeOrder}`,
  ];
  const missing = want.filter((w) => !refs.has(w));
  const disputeBt = mine.find((b) => b.kind === 'dispute');
  if (capture) {
    // The raw (redacted) transactions behind this run's objects: the adapter's mapping fixtures.
    const raw: unknown[] = [];
    const ids = new Set(mine.map((b) => b.id));
    for await (const bt of stripe.balanceTransactions.list({
      created: { gte: Math.floor(started.getTime() / 1000) },
      limit: 100,
      expand: ['data.source'],
    }))
      if (ids.has(bt.id)) raw.push(redact(bt));
    const dir = new URL('../tests/fixtures/stripe/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('balance_transactions.json', dir), `${JSON.stringify(raw, null, 2)}\n`);
  }
  check(missing.length === 0, `missing ${missing.join(', ')} (saw ${[...refs].join(', ')})`);
  return `${bts.length} listed, ${mine.length} attributed; dispute movement ${disputeBt ? 'attributed' : 'not yet listed'}`;
});

await step('real event payloads parse through the webhook verifier', async () => {
  const events: Stripe.Event[] = [];
  for await (const e of stripe.events.list({
    created: { gte: Math.floor(started.getTime() / 1000) - 3600 },
    limit: 100,
  })) {
    events.push(e);
    if (events.length >= 300) break;
  }
  const counts = new Map<string, number>();
  const fixtures = new Map<string, unknown>();
  for (const e of events) {
    const payload = JSON.stringify(e);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', THROWAWAY).update(`${t}.${payload}`).digest('hex');
    const out = await provider.verifyWebhook(
      payload,
      new Headers({ 'stripe-signature': `t=${t},v1=${sig}` }),
    );
    const k = `${e.type} → ${out.type}${out.type === 'ignored' ? ` (${out.reason})` : ''}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!fixtures.has(e.type)) fixtures.set(e.type, redact(e));
  }
  if (capture) {
    const dir = new URL('../tests/fixtures/stripe/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    for (const [type, body] of fixtures)
      writeFileSync(new URL(`${type}.json`, dir), `${JSON.stringify(body, null, 2)}\n`);
  }
  return [...counts].map(([k, n]) => `${n}× ${k}`).join('; ');
});

// Clean up: close the connected accounts this run created.
for (const id of new Set(created)) {
  await stripe.v2.core.accounts
    .close(id, { applied_configurations: ['merchant', 'recipient'] } as Stripe.V2.Core.AccountCloseParams)
    .then(() => console.info(`closed ${id}`))
    .catch(async () => {
      await stripe.accounts.del(id).then(
        () => console.info(`deleted ${id}`),
        (err: Error) => console.info(`could not remove ${id}: ${err.message.split('\n')[0]}`),
      );
    });
}
void disputeId;
void transferId;
const failed = results.filter((r) => !r.ok);
console.info(`\n${results.length - failed.length}/${results.length} contract steps passed`);
if (failed.length) process.exitCode = 1;

/** Keep a payload's shape; drop ids, emails, names, urls and anything secret-looking. */
function redact(v: unknown, keyName = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => redact(x, keyName));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x, k)]));
  if (typeof v !== 'string' || keyName === 'object' || keyName === 'type') return v;
  if (/email|name|phone|url|secret|client_secret|ip|line1|line2|postal_code|city/i.test(keyName))
    return 'redacted';
  // Ids become stable stand-ins (the same id maps to the same stand-in), so links survive.
  const h = (x: string) => createHash('sha256').update(x).digest('hex');
  const m =
    /^(acct|ch|pi|py|re|tr|trr|txn|evt|cs|cus|pm|fee|fr|du|file|req|ba|card|src|seti|po|sub|in|prod|price|pmd|ich|iauth)_/.exec(
      v,
    );
  if (m) return `${m[1]}_${v.startsWith('cs_test_') ? 'test_' : ''}${h(v).slice(0, 16)}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) {
    const x = h(v);
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-7${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
  }
  // References embed uuids (`refund:<uuid>`).
  return v.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => String(redact(u)));
}

/** A small, valid one-page PDF (Stripe rejects malformed uploads). */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 770 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
