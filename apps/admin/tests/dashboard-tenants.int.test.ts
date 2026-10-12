import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createCtx, uuidv7 } from '@yayatoh/kernel';
import { myOrganizations } from '@yayatoh/tenancy';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { dashboardData } from '../src/server/dashboard.ts';
import { provisionTenant } from '../src/server/provision-tenant.ts';
import type { Staff } from '../src/server/staff.ts';
import { staffCan } from '../src/server/staff-roles.ts';

const db = adminClient();
const ownerId = uuidv7();
const staffId = uuidv7();
const email = `owner-${ownerId}@example.test`;
const slug = `admin-created-${ownerId.slice(-8)}`;
const actor = `staff:${staffId}`;
const staff: Staff = {
  userId: staffId,
  name: 'Test admin',
  email: 'staff@example.test',
  role: 'admin',
  actor,
  can: (action) => staffCan('admin', action),
  ctx: (orgId) => createCtx({ orgId, actor: { type: 'system', name: actor } }),
};
let orgId: string | undefined;
beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  await db`insert into auth.users(id,name,email,email_verified) values (${ownerId},'Test owner',${email},true)`;
});

it('creates a complete organization for its owner and rejects duplicates, missing owners and non-admins', async () => {
  const input = { name: 'Provisioned org', slug, ownerEmail: email, reason: 'Create test organization' };
  const org = await provisionTenant(staff, input);
  orgId = org.id;
  expect(org.status).toBe('active');
  const [membership] = await db`select role,user_id from tenancy.memberships where org_id=${org.id}`;
  expect(membership).toMatchObject({ role: 'owner', user_id: ownerId });
  const [domain] = await db`select managed,status from tenancy.org_domains where org_id=${org.id}`;
  expect(domain).toMatchObject({ managed: true, status: 'active' });
  const [onboarding] = await db`select terms_at from tenancy.org_onboarding where org_id=${org.id}`;
  expect(onboarding?.terms_at).toBeNull();
  const [audit] =
    await db`select data from platform.audit_events where org_id=${org.id} and action='organization.provision'`;
  expect(audit?.data).toMatchObject({ ownerUserId: ownerId, reason: input.reason });
  const mine = await myOrganizations(ownerId);
  expect(mine.some((row) => row.orgId === org.id && row.role === 'owner')).toBe(true);
  await expect(provisionTenant(staff, input)).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    provisionTenant(staff, { ...input, slug: `${slug}-missing`, ownerEmail: 'missing@example.test' }),
  ).rejects.toMatchObject({ code: 'not_found' });
  await expect(provisionTenant({ ...staff, can: () => false }, input)).rejects.toMatchObject({
    code: 'forbidden',
  });
  const [{ count }] = await db`select count(*)::int count from tenancy.organizations where slug=${slug}`;
  expect(count).toBe(1);
});

it('reports live totals, zero-filled daily activity and plan distribution while excluding sandboxes', async () => {
  const before = await dashboardData(staff, 7);
  expect(before.trend).toHaveLength(7);
  expect(before.trend.at(-1)?.day).toBe(new Date().toISOString().slice(0, 10));
  expect(before.recent.some((row) => row.id === orgId)).toBe(true);
  expect(before.trend.reduce((sum, row) => sum + row.organizations, 0)).toBe(before.totals.newOrganizations);
  expect(before.organizationStatus.reduce((sum, row) => sum + row.count, 0)).toBe(
    before.totals.organizations,
  );
  expect(before.plans.reduce((sum, row) => sum + row.count, 0)).toBe(before.totals.organizations);
  const sandboxId = uuidv7();
  await db`insert into tenancy.organizations(id,org_id,name,slug,sandbox,sandbox_parent_org_id) values (${sandboxId},${sandboxId},'Sandbox',${`sandbox-${sandboxId.slice(-8)}`},true,${orgId})`;
  const after = await dashboardData(staff, 7);
  expect(after.totals).toEqual(before.totals);
  expect(after.recent.some((row) => row.id === sandboxId)).toBe(false);
  await db`delete from tenancy.organizations where id=${sandboxId}`;
});

it('counts paid and failed orders correctly and separates sales and completed refunds by currency', async () => {
  // Platform-wide totals: the integration suite shares one database, so count what this test adds.
  const base = await dashboardData(staff, 7);
  const usdEvent = uuidv7();
  const inrEvent = uuidv7();
  const usdOrder = uuidv7();
  const inrOrder = uuidv7();
  const failedOrder = uuidv7();
  const oldOrder = uuidv7();
  await db`insert into events.events(id,org_id,slug,name,status,timezone,starts_at,ends_at,currency) values
    (${usdEvent},${orgId},${`usd-${usdEvent.slice(-8)}`},'USD event','published','UTC',now()+interval '1 day',now()+interval '2 days','USD'),
    (${inrEvent},${orgId},${`inr-${inrEvent.slice(-8)}`},'INR event','draft','UTC',now()+interval '1 day',now()+interval '2 days','INR')`;
  for (const row of [
    { id: usdOrder, event: usdEvent, currency: 'USD', amount: 1100, status: 'paid', old: false },
    { id: inrOrder, event: inrEvent, currency: 'INR', amount: 2200, status: 'paid', old: false },
    { id: failedOrder, event: usdEvent, currency: 'USD', amount: 500, status: 'payment_failed', old: false },
    { id: oldOrder, event: usdEvent, currency: 'USD', amount: 3300, status: 'paid', old: true },
  ]) {
    const when = new Date(Date.now() - (row.old ? 100 : 0) * 86_400_000);
    await db`insert into orders.orders(id,org_id,event_id,status,buyer_email,buyer_name,currency,subtotal_minor,fee_minor,total_minor,funds_flow,fee_schedule,manage_token_hash,paid_at,created_at) values
      (${row.id},${orgId},${row.event},${row.status},'buyer@example.test','Test buyer',${row.currency},${row.amount},0,${row.amount},'platform_mor','{}',${row.id},${row.status === 'paid' ? when : null},${when})`;
  }
  await db`insert into orders.refunds(org_id,order_id,status,reason,amount_minor,currency,requested_by,completed_at) values (${orgId},${usdOrder},'succeeded','goodwill',100,'USD',${actor},now())`;
  const data = await dashboardData(staff, 7);
  const added = (k: 'events' | 'upcoming' | 'orders' | 'periodOrders' | 'paidOrders' | 'paymentFailed') =>
    Number(data.totals[k]) - Number(base.totals[k]);
  expect({
    events: added('events'),
    upcoming: added('upcoming'),
    orders: added('orders'),
    periodOrders: added('periodOrders'),
    paidOrders: added('paidOrders'),
    paymentFailed: added('paymentFailed'),
  }).toEqual({ events: 2, upcoming: 1, orders: 4, periodOrders: 3, paidOrders: 2, paymentFailed: 1 });
  const trendOrders = (d: typeof data) => d.trend.reduce((sum, row) => sum + row.orders, 0);
  expect(trendOrders(data) - trendOrders(base)).toBe(3);
  const money = (d: typeof data, currency: string) => {
    const f = d.financials.find((x) => x.currency === currency);
    return {
      gross: BigInt(f?.gross ?? '0'),
      refunds: BigInt(f?.refunds ?? '0'),
      commission: BigInt(f?.commission ?? '0'),
    };
  };
  const delta = (currency: string) => {
    const [now, then] = [money(data, currency), money(base, currency)];
    return {
      gross: String(now.gross - then.gross),
      refunds: String(now.refunds - then.refunds),
      commission: String(now.commission - then.commission),
    };
  };
  expect(delta('INR')).toEqual({ gross: '2200', refunds: '0', commission: '0' });
  expect(delta('USD')).toEqual({ gross: '1100', refunds: '100', commission: '0' });
});

afterAll(async () => {
  await closePools();
  await db.end();
});
