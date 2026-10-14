/** Query and mutation hooks for the Tickets screens (M7.3b). */
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useCore } from '@yayatoh/mobile-core';
import { unwrap } from '@yayatoh/sdk';
import { useCallback, useRef, useState } from 'react';
import {
  type ClaimDetails,
  fetchClaim,
  fetchOrder,
  fetchTicket,
  fetchTicketLink,
  fetchTicketPage,
  fetchWalletLink,
  newIdempotencyKey,
  type RefundRequest,
  type Ticket,
  type TicketPage,
  type TicketWhen,
  type TransferResult,
  ticketKeys,
  type WalletLink,
} from './api';
import { SYNC_FRESH_MS, type SyncOutcome, syncTickets } from './sync';

export function useTicketList(when: TicketWhen) {
  const { api } = useCore();
  return useInfiniteQuery({
    queryKey: ticketKeys.list(when),
    queryFn: ({ pageParam }) => fetchTicketPage(api, when, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TicketPage) => last.nextCursor ?? undefined,
  });
}

export function useTicket(id: string) {
  const { api } = useCore();
  return useQuery({ queryKey: ticketKeys.detail(id), queryFn: () => fetchTicket(api, id) });
}

export function useOrder(id: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ticketKeys.order(id ?? 'none'),
    queryFn: () => fetchOrder(api, id as string),
    enabled: Boolean(id),
  });
}

/** What a claim link offers. The link's token is a credential, so the result is not persisted. */
export function useClaimDetails(token: string, enabled: boolean) {
  const { api } = useCore();
  return useQuery<ClaimDetails>({
    queryKey: ticketKeys.claim(token),
    queryFn: () => fetchClaim(api, token),
    enabled,
    meta: { persist: false },
    retry: false,
  });
}

/** The tickets a web ticket link opens for the signed-in person. The token is a credential: not persisted. */
export function useTicketLink(token: string, enabled: boolean) {
  const { api } = useCore();
  return useQuery({
    queryKey: ticketKeys.link(token),
    queryFn: () => fetchTicketLink(api, token),
    enabled,
    meta: { persist: false },
    retry: false,
  });
}

/** When the last full sync finished, from the cache (so it is still there offline). */
export function useLastSynced(): string | null {
  const { data } = useQuery<string | null>({
    queryKey: ticketKeys.synced,
    queryFn: () => null,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: false,
  });
  return data ?? null;
}

export function useTicketSync() {
  const { api, queryClient } = useCore();
  const [syncing, setSyncing] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const running = useRef<Promise<SyncOutcome> | null>(null);

  const sync = useCallback(
    async (options: { force?: boolean; onlyIfStale?: boolean } = {}) => {
      if (options.onlyIfStale) {
        const at = queryClient.getQueryData<string>(ticketKeys.synced);
        if (at && Date.now() - Date.parse(at) < SYNC_FRESH_MS) return null;
      }
      if (running.current) return running.current;
      setSyncing(true);
      const run = syncTickets({ api, queryClient }, options.force ? { force: true } : {});
      running.current = run;
      try {
        const result = await run;
        setOutcome(result);
        return result;
      } finally {
        running.current = null;
        setSyncing(false);
      }
    },
    [api, queryClient],
  );
  return { sync, syncing, outcome };
}

/**
 * One idempotency key per intent: a retry of the same request (a dropped connection, a second tap)
 * reuses it, so the server answers once; changing the request or finishing it makes a new one.
 */
export function useIdempotencyKey() {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    keyFor(fingerprint: string): string {
      if (!ref.current || ref.current.fingerprint !== fingerprint)
        ref.current = { fingerprint, key: newIdempotencyKey() };
      return ref.current.key;
    },
    reset() {
      ref.current = null;
    },
  };
}

/** After something changed a ticket: re-read it and both lists (a sync does all of that). */
export function useRefreshTickets() {
  const { sync } = useTicketSync();
  return useCallback(() => sync({ force: true }), [sync]);
}

export function useStartTransfer(ticketId: string) {
  const { api } = useCore();
  const keys = useIdempotencyKey();
  const refresh = useRefreshTickets();
  return useMutation<TransferResult, unknown, { toName: string; toEmail: string }>({
    mutationFn: async ({ toName, toEmail }) => {
      const key = keys.keyFor(`${toName}\n${toEmail.toLowerCase()}`);
      return unwrap(
        api.POST('/v1/me/tickets/{id}/transfers', {
          params: { path: { id: ticketId }, header: { 'idempotency-key': key } },
          body: { toName, toEmail },
        }),
      );
    },
    onSuccess: (result) => {
      if (result.status === 'started') {
        keys.reset();
        void refresh();
      }
    },
  });
}

export function useCancelTransfer(ticketId: string) {
  const { api } = useCore();
  const keys = useIdempotencyKey();
  const refresh = useRefreshTickets();
  return useMutation<void, unknown, { transferId: string }>({
    mutationFn: async ({ transferId }) => {
      await unwrap(
        api.DELETE('/v1/me/tickets/{id}/transfers/{transferId}', {
          params: {
            path: { id: ticketId, transferId },
            header: { 'idempotency-key': keys.keyFor(transferId) },
          },
        }),
      );
    },
    onSuccess: () => {
      keys.reset();
      void refresh();
    },
  });
}

export function useRequestRefund(orderId: string) {
  const { api, queryClient } = useCore();
  const keys = useIdempotencyKey();
  return useMutation<RefundRequest, unknown, { ticketIds: string[]; message: string }>({
    mutationFn: async ({ ticketIds, message }) => {
      const key = keys.keyFor(`${[...ticketIds].sort().join(',')}\n${message}`);
      return unwrap(
        api.POST('/v1/me/orders/{id}/refund-requests', {
          params: { path: { id: orderId }, header: { 'idempotency-key': key } },
          body: { ticketIds, ...(message ? { message } : {}) },
        }),
      );
    },
    onSuccess: () => {
      keys.reset();
      void queryClient.invalidateQueries({ queryKey: ticketKeys.order(orderId) });
    },
  });
}

export function useClaimTicket(token: string) {
  const { api, queryClient } = useCore();
  const keys = useIdempotencyKey();
  return useMutation<Ticket, unknown, { name: string }>({
    mutationFn: async ({ name }) => {
      const key = keys.keyFor(`${token}\n${name}`);
      return unwrap(
        api.POST('/v1/claims/{token}', {
          params: { path: { token }, header: { 'idempotency-key': key } },
          body: name ? { name } : {},
        }),
      );
    },
    onSuccess: (ticket) => {
      keys.reset();
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: ['tickets', 'list'] });
    },
  });
}

export function useWalletLink(ticketId: string) {
  const { api } = useCore();
  return useMutation<WalletLink, unknown, { platform: 'apple' | 'google' }>({
    mutationFn: ({ platform }) => fetchWalletLink(api, ticketId, platform),
  });
}
