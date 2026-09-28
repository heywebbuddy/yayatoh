import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeQuery } from '@yayatoh/kernel';
import { fakePaymentProvider, memoryBalanceStore, reconciliationItemsQuery } from '@yayatoh/payments';
import { ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previousDay, runReconciliation } from '../src/reconciliation.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async ({ actor }) => void audited.push(actor)));
afterAll(closePools);

describe('daily reconciliation job (M1.6e)', () => {
  it('reconciles each org once per day from one listing, and does nothing without a balance store', async () => {
    const { a, b } = await twoOrgs();
    const store = memoryBalanceStore();
    const provider = fakePaymentProvider({ secret: 's'.repeat(40), appOrigin: 'http://localhost', store });
    const day = '2031-02-03';
    for (const org of [a, b])
      store.add({
        id: `fakebt_${org.org.id}`,
        kind: 'charge',
        amountMinor: 1234,
        currency: 'USD',
        occurredAt: new Date(`${day}T12:00:00Z`),
        orgId: org.org.id,
        reference: `order:unknown-${org.org.slug}`,
      });
    // Unattributed platform movements (a payout to the bank) are not any org's drift.
    store.add({
      id: 'fakebt_payout',
      kind: 'other',
      amountMinor: -50_000,
      currency: 'USD',
      occurredAt: new Date(`${day}T13:00:00Z`),
      orgId: null,
      reference: null,
    });
    const first = await runReconciliation(provider, { day, onlyOrgs: [a.org.id, b.org.id] });
    expect(first).toEqual({ day, orgs: 2, items: 2, unattributed: 0 });
    expect(await runReconciliation(provider, { day, onlyOrgs: [a.org.id, b.org.id] })).toMatchObject({
      items: 0,
    });
    const items = await executeQuery(reconciliationItemsQuery, {}, systemCtx(a.org.id), ports);
    expect(items.filter((i) => i.day === day)).toEqual([
      expect.objectContaining({
        kind: 'missing_in_ledger',
        reference: `order:unknown-${a.org.slug}`,
        providerMinor: 1234,
      }),
    ]);
    expect(audited).toContain('system:reconciliation');
    const bare = fakePaymentProvider({ secret: 's'.repeat(40), appOrigin: 'http://localhost' });
    expect(await runReconciliation(bare, { day })).toBeNull();
    expect(previousDay(new Date('2031-03-01T00:30:00Z'))).toBe('2031-02-28');
  });
});
