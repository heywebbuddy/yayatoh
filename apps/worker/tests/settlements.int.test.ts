import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyAccountEventCommand, fakePaymentProvider, settlementsQuery } from '@yayatoh/payments';
import { ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSettlements } from '../src/settlements.ts';

const audited: string[] = [];
beforeAll(() => setPlatformAuditSink(async ({ actor }) => void audited.push(actor)));
afterAll(closePools);

describe('payout release job (M1.6c)', () => {
  it('transfers a settlement that waited for a payout account, once, with the fake provider', async () => {
    const { a, b } = await twoOrgs();
    const provider = fakePaymentProvider({ secret: 's'.repeat(40), appOrigin: 'http://localhost' });
    // The fixture's order was released in 2030 and waits for an account.
    const [waiting] = await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports);
    expect(waiting).toMatchObject({ status: 'waiting_account' });
    expect(
      await runSettlements(provider, { now: new Date('2030-01-02T00:00:00Z'), onlyOrgs: [a.org.id] }),
    ).toEqual({
      orgs: 1,
      transferred: 0,
      failed: 0,
    });
    await executeCommand(
      applyAccountEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${uuidv7()}`,
        type: 'account.updated',
        orgId: a.org.id,
        account: {
          accountId: `fakeacct_${a.org.slug}`,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          requirementsDue: [],
          country: 'US',
          defaultCurrency: 'usd',
        },
      },
      systemCtx(a.org.id),
      ports,
    );
    const now = new Date('2030-01-03T00:00:00Z');
    expect(await runSettlements(provider, { now, onlyOrgs: [a.org.id, b.org.id] })).toMatchObject({
      transferred: 1,
      failed: 0,
    });
    expect(await runSettlements(provider, { now, onlyOrgs: [a.org.id] })).toMatchObject({ transferred: 0 });
    const [done] = await executeQuery(settlementsQuery, {}, systemCtx(a.org.id), ports);
    expect(done).toMatchObject({ status: 'transferred' });
    // Org B has no payout account: its settlement keeps waiting.
    const [other] = await executeQuery(settlementsQuery, {}, systemCtx(b.org.id), ports);
    expect(other).toMatchObject({ status: 'waiting_account' });
    expect(audited).toContain('system:settlements');
  });
});
