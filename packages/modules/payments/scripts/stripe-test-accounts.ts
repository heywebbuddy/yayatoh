import type Stripe from 'stripe';
import { accountState } from '../src/stripe.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connected account Stripe lets the platform onboard with test data (requirements owned by us). */
export async function testMerchantAccount(
  stripe: Stripe,
  opts: { orgId: string; onCreated: (id: string) => void },
): Promise<string> {
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
    metadata: { orgId: opts.orgId, purpose: 'stripe-contract' },
  } as Stripe.V2.Core.AccountCreateParams);
  opts.onCreated(a.id);
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
