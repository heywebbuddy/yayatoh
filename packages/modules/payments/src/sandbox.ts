import type { PaymentProvider, WebhookEvent } from './port.ts';

/** Is this org a sandbox (M6.3a)? The tenancy module answers (`isSandboxOrg`). */
export type SandboxCheck = (orgId: string) => Promise<boolean>;

/** Provider ids the fake provider mints (payments, accounts, refunds, transfers, disputes). */
const FAKE_ID = /^fake[a-z]*_/;

function sandboxRefused(): never {
  throw new Error('Sandbox orgs take fake payments only, and no fake provider is configured');
}

/**
 * M6.3a: a sandbox org can never take real money. Wraps the deployment's provider: every call for
 * a sandbox org (or on an object the fake provider minted) goes to the fake provider, whatever
 * `PAYMENTS_PROVIDER` says, and fails closed when no fake is configured. A fake-signed webhook is
 * accepted on a real deployment only for a sandbox org, so it can never settle a real org's order.
 * With the fake as the deployment's provider, this is the fake itself.
 */
export function sandboxSafeProvider(opts: {
  live: PaymentProvider;
  fake: PaymentProvider | null;
  isSandboxOrg: SandboxCheck;
}): PaymentProvider & { readonly sandboxSafe: true; forSandbox(): PaymentProvider } {
  const { live, isSandboxOrg } = opts;
  const fake = live.name === 'fake' ? live : opts.fake;
  const fakeOr = () => fake ?? sandboxRefused();
  const byOrg = async (orgId: string | null | undefined) =>
    orgId && (await isSandboxOrg(orgId)) ? fakeOr() : live;
  const byId = (id: string | null | undefined) => (id && FAKE_ID.test(id) ? fakeOr() : null);
  return {
    name: live.name,
    sandboxSafe: true,
    forSandbox: fakeOr,
    async createPayment(i) {
      const p = await byOrg(i.orgId);
      return { ...(await p.createPayment(i)), provider: p.name };
    },
    async verifyWebhook(rawBody, headers) {
      if (live.name === 'fake' || !headers.has('x-fake-signature'))
        return live.verifyWebhook(rawBody, headers);
      const event: WebhookEvent = await fakeOr().verifyWebhook(rawBody, headers);
      if (event.type !== 'ignored' && !(await isSandboxOrg(event.orgId)))
        throw new Error('A fake payment notification is accepted for sandbox orgs only');
      return event;
    },
    async createConnectedAccount(i) {
      return (await byOrg(i.orgId)).createConnectedAccount(i);
    },
    async createOnboardingLink(i) {
      return (byId(i.accountId) ?? (await byOrg(i.orgId))).createOnboardingLink(i);
    },
    async registerPaymentMethodDomain(i) {
      return (byId(i.accountId) ?? live).registerPaymentMethodDomain(i);
    },
    async refund(i) {
      return (byId(i.providerPaymentId) ?? (await byOrg(i.orgId))).refund(i);
    },
    async createTransfer(i) {
      return (byId(i.destinationAccountId) ?? (await byOrg(i.orgId))).createTransfer(i);
    },
    async reverseTransfer(i) {
      return (byId(i.transferId) ?? (await byOrg(i.orgId))).reverseTransfer(i);
    },
    async submitDisputeEvidence(i) {
      return (byId(i.providerDisputeId) ?? live).submitDisputeEvidence(i);
    },
    listBalanceTransactions(i) {
      return live.listBalanceTransactions(i);
    },
  };
}
