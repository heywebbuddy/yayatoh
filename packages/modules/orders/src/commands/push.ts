import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  PushDeviceDto,
  pushDevicesTx,
  removePushDeviceTx,
  upsertWebPushTx,
  WebPushDeviceInput,
} from '@yayatoh/notifications';
import { tenantCommand } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../schema.ts';
import { hashManageToken } from './checkout.ts';

const ManageToken = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);

/** The org a manage link belongs to (SECURITY DEFINER lookup by the token's hash), or null. */
export async function manageTokenOrg(token: string): Promise<string | null> {
  if (!ManageToken.safeParse(token).success) return null;
  const refs = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(
      sql`select org_id from orders.order_ref_by_token(${hashManageToken(token)})`,
    ),
  );
  return refs[0]?.org_id ?? null;
}

/** The buyer's email for a manage token, read under the org's RLS; the link is the credential. */
async function buyerOfTx(tx: TenantTx, token: string): Promise<{ orderId: string; email: string }> {
  const [o] = await tx
    .select({ id: orders.id, email: orders.buyerEmail })
    .from(orders)
    .where(eq(orders.manageTokenHash, hashManageToken(token)));
  if (!o) throw new DomainError('not_found', 'Unknown link');
  return { orderId: o.id, email: o.email };
}

/**
 * A guest buyer opts this browser in to push from their order page (M1.10e). The manage token
 * proves who they are; the device belongs to the order's buyer email, so the org's announcements
 * (and reminders) to that address also reach the browser. Stored through the notifications
 * module's `upsertWebPushTx`, the same path as `registerPushTokenCommand`.
 */
export const registerOrderPushCommand = tenantCommand({
  name: 'orders.registerPush',
  input: z.object({ token: ManageToken, subscription: WebPushDeviceInput }),
  output: z.object({ deviceId: z.uuid() }),
  entitlement: null,
  permission: 'public:order-push',
  handler: async ({ input, ctx, tx }) => {
    const buyer = await buyerOfTx(tx, input.token);
    const { id } = await upsertWebPushTx(
      tx,
      requireOrg(ctx),
      { email: buyer.email },
      input.subscription,
      ctx.now,
    );
    return { deviceId: id, orderId: buyer.orderId };
  },
  present: (r) => ({ deviceId: r.deviceId }),
  audit: (_input, r) => ({
    action: 'orders.register_push',
    targetType: 'order',
    targetId: r.orderId,
    data: { deviceId: r.deviceId },
  }),
});

/** Remove one of the buyer's devices (by id from the list, or this browser's endpoint). */
export const removeOrderPushCommand = tenantCommand({
  name: 'orders.removePush',
  input: z
    .object({ token: ManageToken, deviceId: z.uuid().optional(), endpoint: z.url().max(2048).optional() })
    .refine((v) => Boolean(v.deviceId) !== Boolean(v.endpoint), { message: 'deviceId or endpoint' }),
  output: z.object({ removed: z.boolean() }),
  entitlement: null,
  permission: 'public:order-push',
  handler: async ({ input, tx }) => {
    const buyer = await buyerOfTx(tx, input.token);
    const id = await removePushDeviceTx(tx, { email: buyer.email }, input);
    if (!id && input.deviceId) throw new DomainError('not_found', 'No such device');
    return { removed: Boolean(id), orderId: buyer.orderId, deviceId: id };
  },
  present: (r) => ({ removed: r.removed }),
  audit: (_input, r) => ({
    action: 'orders.remove_push',
    targetType: 'order',
    targetId: r.orderId,
    data: { deviceId: r.deviceId },
  }),
});

/** The buyer's opted-in devices for the order page (allowlisted DTO), or null for a bad link. */
export async function orderPushDevices(token: string): Promise<PushDeviceDto[] | null> {
  const orgId = await manageTokenOrg(token);
  if (!orgId) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.manage-link' } });
  return withTenant(ctx, async (tx) => {
    const buyer = await buyerOfTx(tx, token).catch(() => null);
    if (!buyer) return null;
    return z.array(PushDeviceDto).parse(await pushDevicesTx(tx, { email: buyer.email }));
  });
}
