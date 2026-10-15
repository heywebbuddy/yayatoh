/**
 * Server state for the Tickets screens (M7.3b): query keys, fetchers over `@yayatoh/sdk` through
 * the core's signed client, and the helpers that read a problem. Everything fetched while signed
 * in lands in the core's encrypted query cache, so it is there with the network off and gone at
 * sign-out (`clearServerState`).
 */
import { type Schemas, unwrap, YayatohApiError, type YayatohClient } from '@yayatoh/sdk';
import { randomUUID } from 'expo-crypto';

export type TicketSummary = Schemas['MyTicketSummary'];
export type Ticket = Schemas['MyTicket'];
export type TicketPage = Schemas['MyTicketPage'];
export type TicketWhen = Schemas['TicketWhen'];
export type Order = Schemas['MyOrder'];
export type ClaimDetails = Schemas['ClaimDetails'];
export type TransferResult = Schemas['TicketTransferResult'];
export type WalletLink = Schemas['WalletPassLink'];
export type RefundRequest = Schemas['BuyerRefundRequest'];

/**
 * Tickets per page, for the list and for the sync alike: Query refetches a list page by page from the
 * cursor each fresh page returns, so a list built by the sync and one grown by scrolling must page
 * the same way or a refetch would cut it short.
 */
export const PAGE_SIZE = 50;

export const ticketKeys = {
  all: ['tickets'] as const,
  list: (when: TicketWhen) => ['tickets', 'list', when] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
  order: (id: string) => ['tickets', 'order', id] as const,
  /** When the last full sync finished (an ISO string), kept in the same encrypted cache. */
  synced: ['tickets', 'synced'] as const,
  /** A claim link's token is a credential: this query is never written to the cache file. */
  claim: (token: string) => ['tickets', 'claim', token] as const,
  link: (token: string) => ['tickets', 'link', token] as const,
};

export const newIdempotencyKey = (): string => randomUUID();

export function fetchTicketPage(
  api: YayatohClient,
  when: TicketWhen,
  cursor: string | undefined,
  limit = PAGE_SIZE,
) {
  return unwrap(
    api.GET('/v1/me/tickets', { params: { query: { when, limit, ...(cursor ? { cursor } : {}) } } }),
  );
}

export const fetchTicket = (api: YayatohClient, id: string) =>
  unwrap(api.GET('/v1/me/tickets/{id}', { params: { path: { id } } }));

export const fetchOrder = (api: YayatohClient, id: string) =>
  unwrap(api.GET('/v1/me/orders/{id}', { params: { path: { id } } }));

export const fetchClaim = (api: YayatohClient, token: string) =>
  unwrap(api.GET('/v1/claims/{token}', { params: { path: { token } } }));

export const fetchTicketLink = (api: YayatohClient, token: string) =>
  unwrap(api.GET('/v1/me/ticket-links/{token}', { params: { path: { token } } }));

export const fetchWalletLink = (api: YayatohClient, id: string, platform: 'apple' | 'google') =>
  unwrap(api.GET('/v1/me/tickets/{id}/wallet', { params: { path: { id }, query: { platform } } }));

/** What a failed call means to a person, from the server's stable `code` and `details.reason`. */
export interface ProblemView {
  readonly status: number;
  readonly code: string;
  readonly reason: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  /** No answer at all: offline, a timeout, a dropped connection. */
  readonly network: boolean;
  /** Seconds to wait, when the server said (429). */
  readonly retryAfter: number | null;
}

export function viewProblem(error: unknown): ProblemView {
  if (error instanceof YayatohApiError) {
    const details = (error.problem?.details ?? {}) as Record<string, unknown>;
    return {
      status: error.status,
      code: error.code,
      reason: typeof details.reason === 'string' ? details.reason : null,
      details,
      network: false,
      retryAfter: error.retryAfter,
    };
  }
  return { status: 0, code: 'network', reason: null, details: {}, network: true, retryAfter: null };
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof YayatohApiError && error.status === 404;
