import { checkinFactsTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type FactScope, orderStatusCountsTx, refundFactsTx, salesFactsTx } from '@yayatoh/orders';
import { lostDisputeFactsTx } from '@yayatoh/payments';
import { ticketTypeStatsTx } from '@yayatoh/ticketing';
import { type MetricFacts, reportCurrencies } from './registry.ts';

/**
 * Collect the facts behind the metric registry from each owning module's exported reads, all in
 * the caller's tenant transaction (one org, RLS). With `eventId` in scope the ticket inventory
 * (capacity, valid tickets) is included.
 */
export async function gatherFactsTx(tx: TenantTx, scope: FactScope, defaultCurrency: string) {
  // One connection per transaction: read in sequence.
  const sales = await salesFactsTx(tx, scope);
  const refunds = await refundFactsTx(tx, scope);
  const disputes = await lostDisputeFactsTx(tx, scope);
  const statuses = await orderStatusCountsTx(tx, scope);
  const checkins = await checkinFactsTx(tx, scope);
  const types = scope.eventId ? await ticketTypeStatsTx(tx, scope.eventId) : null;
  const facts: MetricFacts = {
    currencies: reportCurrencies(defaultCurrency, sales, refunds, disputes),
    sales,
    refunds,
    disputes,
    statuses,
    checkins,
    ...(types
      ? {
          tickets: {
            capacity: types.reduce((a, t) => a + t.capacity, 0),
            valid: types.reduce((a, t) => a + t.valid, 0),
          },
        }
      : {}),
  };
  return { facts, sales, statuses, types };
}
