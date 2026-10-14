/**
 * The ticket sync (M7.3b): one pass that makes My tickets work with the network off.
 *
 * It walks every page of the upcoming list, takes the first page of the past list, and keeps each
 * ticket's full record (its QR code, seat, entrances, transfer options) in the query cache, which
 * the core persists encrypted. A ticket's record is fetched again only when its `rev`, status or
 * transfer state changed (a transfer or a re-send bumps `rev`), or when the person pulled to
 * refresh. Tickets that left the list (transferred away, refunded) are dropped from the cache.
 */
import { type InfiniteData, onlineManager, type QueryClient } from '@tanstack/react-query';
import type { YayatohClient } from '@yayatoh/sdk';
import {
  fetchTicket,
  fetchTicketPage,
  PAGE_SIZE,
  type Ticket,
  type TicketPage,
  type TicketSummary,
  type TicketWhen,
  ticketKeys,
} from './api';

/** A guard against a runaway cursor, not a limit people meet: 20 pages of 50 is 1000 tickets. */
export const MAX_SYNC_PAGES = 20;
const DETAIL_CONCURRENCY = 4;
/** Opening the tab again within this long does not sync again; pulling to refresh always does. */
export const SYNC_FRESH_MS = 60_000;

export type SyncOutcome =
  | { readonly kind: 'synced'; readonly at: string; readonly failedDetails: number }
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed' };

type ListData = InfiniteData<TicketPage, string | undefined>;

const idsOf = (data: ListData | undefined): string[] =>
  data?.pages.flatMap((p) => p.data.map((t) => t.id)) ?? [];

/** Whether the cached record still matches what the list says about the ticket. */
export function detailIsCurrent(cached: Ticket | undefined, summary: TicketSummary): boolean {
  return (
    cached !== undefined &&
    cached.rev === summary.rev &&
    cached.status === summary.status &&
    (cached.transfer.pendingTransferId !== null) === summary.pendingTransfer
  );
}

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function walk(api: YayatohClient, when: TicketWhen, all: boolean): Promise<ListData> {
  const pages: TicketPage[] = [];
  const params: (string | undefined)[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchTicketPage(api, when, cursor, PAGE_SIZE);
    pages.push(page);
    params.push(cursor);
    cursor = page.nextCursor ?? undefined;
  } while (all && cursor && pages.length < MAX_SYNC_PAGES);
  return { pages, pageParams: params };
}

export interface SyncDeps {
  readonly api: YayatohClient;
  readonly queryClient: QueryClient;
  readonly now?: () => Date;
}

export async function syncTickets(deps: SyncDeps, options: { force?: boolean } = {}): Promise<SyncOutcome> {
  const { api, queryClient } = deps;
  if (!onlineManager.isOnline()) return { kind: 'offline' };
  try {
    const [upcoming, past] = await Promise.all([walk(api, 'upcoming', true), walk(api, 'past', false)]);
    const before = new Set([
      ...idsOf(queryClient.getQueryData<ListData>(ticketKeys.list('upcoming'))),
      ...idsOf(queryClient.getQueryData<ListData>(ticketKeys.list('past'))),
    ]);
    const summaries = [...upcoming.pages, ...past.pages].flatMap((p) => p.data);
    const live = new Set(summaries.map((s) => s.id));

    let failedDetails = 0;
    await inBatches(summaries, DETAIL_CONCURRENCY, async (summary) => {
      const key = ticketKeys.detail(summary.id);
      if (!options.force && detailIsCurrent(queryClient.getQueryData<Ticket>(key), summary)) return;
      try {
        queryClient.setQueryData(key, await fetchTicket(api, summary.id));
      } catch {
        failedDetails += 1;
      }
    });

    queryClient.setQueryData(ticketKeys.list('upcoming'), upcoming);
    queryClient.setQueryData(ticketKeys.list('past'), past);
    for (const id of before)
      if (!live.has(id)) queryClient.removeQueries({ queryKey: ticketKeys.detail(id) });
    const at = (deps.now?.() ?? new Date()).toISOString();
    // A ticket whose record could not be fetched is not "synced": keep the old stamp then.
    if (failedDetails === 0) queryClient.setQueryData(ticketKeys.synced, at);
    return { kind: 'synced', at, failedDetails };
  } catch {
    return { kind: 'failed' };
  }
}
