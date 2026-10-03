import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { billingEnabled } from './provider/flag.ts';
import type { BillingEvent, BillingProvider, BillingProviderName } from './provider/port.ts';
import { applyBillingEventCommand } from './subscriptions.ts';

export interface BillingWebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  /** False when the delivery failed verification (the route rate-limits those per source IP). */
  readonly verified: boolean;
}

/** The org a provider customer belongs to (SECURITY DEFINER lookup; null when none or ambiguous). */
async function orgForCustomer(provider: BillingProviderName, customerId: string): Promise<string | null> {
  const [row] = await withoutTenant((tx) =>
    tx.execute<{ org_id: string | null }>(
      sql`select billing.org_for_customer(${provider}, ${customerId}) as org_id`,
    ),
  );
  return row?.org_id ?? null;
}

/**
 * The billing provider's webhook (M6.6a), transport-free so the route and the tests share it.
 * Billing off (`BILLING_ENABLED` unset) or another provider's endpoint: 404, nothing read. The
 * body is verified raw, then subscription and entitlement events are applied to the customer's
 * org as a system command, deduplicated by the provider's event id. Catalog changes are
 * acknowledged (the worker's catalog sync mirrors them); other events are acknowledged unread.
 */
export async function processBillingWebhook(
  rawBody: string,
  headers: Headers,
  expected: BillingProviderName,
  deps: { provider: () => BillingProvider; ports: CommandPorts<TenantTx>; enabled?: boolean },
): Promise<BillingWebhookResult> {
  if (!(deps.enabled ?? billingEnabled())) return { status: 404, body: null, verified: true };
  const provider = deps.provider();
  if (provider.name !== expected) return { status: 404, body: null, verified: true };
  let event: BillingEvent;
  try {
    event = await provider.verifyWebhook(rawBody, headers);
  } catch {
    return { status: 400, body: null, verified: false };
  }
  if (event.kind === 'ignored') return { status: 200, body: { outcome: 'ignored' }, verified: true };
  if (event.kind === 'catalog') return { status: 200, body: { outcome: 'catalog_changed' }, verified: true };
  const orgId = await orgForCustomer(event.provider, event.customerId);
  if (!orgId) return { status: 200, body: { outcome: 'unknown_customer' }, verified: true };
  const ctx = createCtx({ orgId, actor: { type: 'system', name: `webhook:billing:${expected}` } });
  try {
    const out = await executeCommand(applyBillingEventCommand, event, ctx, deps.ports);
    return { status: 200, body: { outcome: out.outcome }, verified: true };
  } catch (err) {
    if (isDomainError(err)) return { status: err.status, body: { error: err.code }, verified: true };
    throw err;
  }
}
