import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, currencyExponent, executeCommand, executeQuery } from '@yayatoh/kernel';
import type { AuthRef, IntegrationAuth } from '../auth/port.ts';
import { isProviderError } from '../auth/port.ts';
import { connectorByKey } from '../connectors/index.ts';
import { originStamp } from '../domain/sync.ts';
import type { ConnectorDefinition, SyncIO } from '../sdk/connector.ts';
import { type AccountCategory, journalMemo, journalReference, type ProviderAccount } from './domain.ts';
import {
  accountingRefQuery,
  type JournalResult,
  parseJournalLines,
  prepareJournalsCommand,
  recordJournalResultsCommand,
  sendableJournalsTx,
} from './journals.ts';

/** What each line says in the books (English: the organizer's accountant reads them). */
const LINE_TEXT: Record<AccountCategory, string> = {
  sales: 'Ticket sales',
  donations: 'Donations',
  refunds: 'Refunds',
  fees: 'Yayatoh fees',
  payouts: 'Payouts',
  clearing: 'Yayatoh clearing',
};

/** Results recorded per command. */
const RECORD_BATCH = 25;

/**
 * The accounting step of a sync run (M6.5d), after the connector's objects: prepare the days that
 * changed (one command), then send each journal through the connector, oldest first, a day at a
 * time — a reversal always before the revision that replaces it, and nothing after a row that
 * failed. Results are recorded in batches. A refusal (401/403) records what was sent and stops the
 * run, which then marks the connection revoked; an answer that may have reached the provider (429,
 * 5xx, network) stops sending until the next run, whose retry keeps the same idempotency key.
 */
export async function postAccounting(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  connector: ConnectorDefinition,
  io: SyncIO,
  runId: string,
  connectionId: string,
): Promise<void> {
  const accounting = connector.accounting;
  if (!accounting) return;
  await executeCommand(prepareJournalsCommand, { runId }, ctx, ports);
  const rows = await withTenant(ctx, (tx) => sendableJournalsTx(tx, ctx, connectionId));
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.day}|${r.currency}`;
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  let pending: JournalResult[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const results = pending;
    pending = [];
    await executeCommand(recordJournalResultsCommand, { runId, results }, ctx, ports);
  };
  let stop = false;
  for (const group of byDay.values()) {
    if (stop) break;
    for (const row of group) {
      if (row.held) break;
      const kind = row.kind as 'journal' | 'reversal';
      try {
        const sent = await accounting.postJournal(io, {
          day: row.day,
          currency: row.currency,
          exponent: currencyExponent(row.currency),
          reference: journalReference(row.day, row.currency, row.revision, kind),
          memo: journalMemo(row.day, row.currency, row.revision, kind),
          lines: parseJournalLines(row.lines).map((l) => ({
            accountId: l.accountId,
            accountCode: l.accountCode,
            amountMinor: l.amountMinor,
            description: LINE_TEXT[l.category],
          })),
          idempotencyKey: row.idempotencyKey,
        });
        pending.push({ outcome: 'posted', journalId: row.id, externalId: sent.externalId });
      } catch (err) {
        if (isProviderError(err) && err.auth) {
          // The connection no longer works: keep what was posted, then stop the run.
          await flush();
          throw err;
        }
        const uncertain = !isProviderError(err) || err.retryable;
        pending.push({
          outcome: 'failed',
          journalId: row.id,
          code: isProviderError(err) ? err.code : 'post_failed',
          uncertain,
        });
        // A provider outage or rate limit: stop sending for this run.
        if (uncertain) stop = true;
        break;
      }
      if (pending.length >= RECORD_BATCH) await flush();
    }
  }
  await flush();
}

/**
 * The org's chart of accounts at the provider, for the mapping form (`integrations:read`). The
 * connection's provider reference stays here; only accounts come back. Null when the connection
 * is not live or the provider does not answer.
 */
export async function chartOfAccounts(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  auth: IntegrationAuth,
  connectionId: string,
): Promise<ProviderAccount[] | null> {
  const ref = await executeQuery(accountingRefQuery, { connectionId }, ctx, ports);
  const connector = connectorByKey(ref.connector);
  if (!connector?.accounting || !ref.authConnectionId || (ref.status !== 'active' && ref.status !== 'paused'))
    return null;
  const authRef: AuthRef = {
    orgId: ctx.orgId as string,
    connectionId,
    providerConfigKey: connector.providerConfigKey,
    authConnectionId: ref.authConnectionId,
  };
  try {
    const io: SyncIO = { client: auth.client(authRef), origin: originStamp(connectionId), now: ctx.now };
    const accounts = await connector.accounting.listAccounts(io);
    return accounts.sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
  } catch (err) {
    if (isProviderError(err)) return null;
    throw err;
  }
}
