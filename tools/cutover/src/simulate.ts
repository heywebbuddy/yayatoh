import { randomUUID } from 'node:crypto';
import { billingEntitlements } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { rehearsalTarget } from '@yayatoh/legacy-migrate';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  orderByManageToken,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { type PaymentProvider, signFakeWebhook } from '@yayatoh/payments';
import { createCommandPorts } from '@yayatoh/platform';
import { createOrgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
import type { Instance } from './types.ts';

/** The same composition the apps use (billing entitlements, tenancy authorizer, org gate, freeze). */
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: createOrgAuthorizer({ eventRoles: eventRolesOf }),
  orgGate: orgStatusGate,
});

/**
 * Rehearsals only (M2.5a): after the flip, the new platform takes a real sale of a migrated event
 * through the pipeline (a platform_mor order paid through the fake provider's signed webhook) and
 * admits one of its tickets at the door, so the rollback has post-cutover writes to copy back and an
 * SCT order to refund. Never Stripe; never run by the cutover itself.
 */
export async function simulatePostCutover(
  instance: Instance,
  provider: PaymentProvider & { verifyWebhook(body: string, headers: Headers): Promise<unknown> },
  secret: string,
): Promise<{ orderIds: string[]; scans: number } | null> {
  const t = await rehearsalTarget(instance);
  if (!t) return null;
  const ctx = createCtx({ orgId: t.orgId });
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId: t.eventId,
      items: [{ ticketTypeId: t.ticketTypeId, quantity: 2 }],
      buyer: { email: `rehearsal-${randomUUID().slice(0, 8)}@example.test`, name: 'Rehearsal Buyer' },
    },
    ctx,
    ports,
  );
  const pi = `fakepi_rehearsal_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    ctx,
    ports,
  );
  const signed = signFakeWebhook(secret, {
    type: 'payment.succeeded',
    providerPaymentId: pi,
    amountMinor: c.order.totalMinor,
    currency: c.order.currency,
    orgId: t.orgId,
    orderId: c.order.id,
  });
  const evt = await provider.verifyWebhook(
    signed.body,
    new Headers({ 'x-fake-signature': signed.signature }),
  );
  const system = createCtx({ orgId: t.orgId, actor: { type: 'system', name: 'webhook:fake' } });
  await executeCommand(applyProviderEventCommand, evt as never, system, ports);
  let scans = 0;
  const order = await orderByManageToken(c.manageToken);
  for (const code of order?.tickets.slice(0, 1).map((k) => k.code) ?? []) {
    const r = await executeCommand(
      scanTicketCommand,
      { eventId: t.eventId, code },
      createCtx({ orgId: t.orgId, actor: { type: 'system', name: 'rehearsal:door' } }),
      ports,
    );
    if (r.result === 'admitted') scans++;
  }
  return { orderIds: [c.order.id], scans };
}
