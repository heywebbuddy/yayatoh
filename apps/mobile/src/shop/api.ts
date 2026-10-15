/**
 * The `/v1` calls of the shopping screens (M7.3c) as TanStack Query hooks. Every call goes through the
 * SDK client of the core (`@yayatoh/mobile-core`); nothing here fetches a path by hand.
 *
 * Public pages (search, event, passes) need no sign-in and use the unsigned client. Orders and
 * checkout use the signed one.
 */
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCore } from '@yayatoh/mobile-core';
import { type Schemas, unwrap } from '@yayatoh/sdk';
import { type DiscoverFilters, searchQuery } from './filters';

export type EventSummary = Schemas['PublicEventSummary'];
export type PublicEvent = Schemas['PublicEvent'];
export type Pass = Schemas['PublicTicketType'];
export type EventDate = Schemas['PublicEventDate'];
export type Section = Schemas['PublicEventSection'];
export type Venue = Schemas['PublicVenue'];
export type CheckoutResult = Schemas['AppCheckoutResult'];
export type MyOrder = Schemas['MyOrder'];
export type MyOrderSummary = Schemas['MyOrderSummary'];

export const shopKeys = {
  search: (f: DiscoverFilters) => ['shop', 'search', f] as const,
  event: (slug: string) => ['shop', 'event', slug] as const,
  passes: (slug: string) => ['shop', 'event', slug, 'passes'] as const,
  dates: (slug: string) => ['shop', 'event', slug, 'dates'] as const,
  sections: (slug: string) => ['shop', 'event', slug, 'sections'] as const,
  venue: (slug: string) => ['shop', 'venue', slug] as const,
  orders: ['shop', 'orders'] as const,
  order: (id: string) => ['shop', 'order', id] as const,
  config: ['shop', 'config'] as const,
};

/** Search results, a page at a time, continuing from the API's `nextCursor`. */
export function useEventSearch(filters: DiscoverFilters) {
  const { publicApi } = useCore();
  return useInfiniteQuery({
    queryKey: shopKeys.search(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(publicApi.GET('/v1/public/events', { params: { query: searchQuery(filters, pageParam) } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const flattenEvents = (data: InfiniteData<Schemas['PublicEventPage']> | undefined): EventSummary[] =>
  data?.pages.flatMap((p) => p.data) ?? [];

export function usePublicEvent(slug: string) {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.event(slug),
    queryFn: () => unwrap(publicApi.GET('/v1/public/events/{slug}', { params: { path: { slug } } })),
  });
}

/** The passes with live prices and availability: never kept for offline use, they change by the minute. */
export function usePasses(slug: string) {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.passes(slug),
    meta: { persist: false },
    staleTime: 10_000,
    queryFn: async () =>
      (await unwrap(publicApi.GET('/v1/public/events/{slug}/ticket-types', { params: { path: { slug } } })))
        .data,
  });
}

/** The dates of a multi-date event (empty for a single-date one). */
export function useEventDates(slug: string) {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.dates(slug),
    queryFn: async () =>
      (await unwrap(publicApi.GET('/v1/public/events/{slug}/dates', { params: { path: { slug } } }))).data,
  });
}

/** The event's content blocks (about, location); the page reads the text and location ones. */
export function useEventSections(slug: string) {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.sections(slug),
    queryFn: async () =>
      (await unwrap(publicApi.GET('/v1/public/events/{slug}/sections', { params: { path: { slug } } }))).data,
  });
}

export function useVenue(slug: string | null) {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.venue(slug ?? ''),
    enabled: slug !== null,
    queryFn: () =>
      unwrap(publicApi.GET('/v1/public/venues/{slug}', { params: { path: { slug: slug ?? '' } } })),
  });
}

export function useMyOrders() {
  const { api } = useCore();
  return useInfiniteQuery({
    queryKey: shopKeys.orders,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/me/orders', {
          params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One order. `poll` re-reads it every few seconds, for the moments after paying while the provider confirms. */
export function useMyOrder(id: string, poll = false) {
  const { api } = useCore();
  return useQuery({
    queryKey: shopKeys.order(id),
    queryFn: () => unwrap(api.GET('/v1/me/orders/{id}', { params: { path: { id } } })),
    refetchInterval: poll ? 3_000 : false,
    staleTime: poll ? 0 : 30_000,
  });
}

export interface CheckoutRequest {
  readonly slug: string;
  readonly key: string;
  readonly items: readonly { ticketTypeId: string; quantity: number }[];
  readonly occurrenceId?: string | undefined;
  readonly promoCode?: string | undefined;
  readonly name?: string | undefined;
}

/** Starts the checkout (`POST …/checkout`). The `key` is the Idempotency-Key: the same key never makes a second order. */
export function useStartCheckout() {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (r: CheckoutRequest): Promise<CheckoutResult> =>
      unwrap(
        api.POST('/v1/public/events/{slug}/checkout', {
          params: { path: { slug: r.slug }, header: { 'idempotency-key': r.key } },
          body: {
            items: r.items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
            ...(r.occurrenceId ? { occurrenceId: r.occurrenceId } : {}),
            ...(r.promoCode?.trim() ? { promoCode: r.promoCode.trim() } : {}),
            ...(r.name?.trim() ? { name: r.name.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      // A placed order changes the orders list, My tickets (another screen's keys) and the passes' stock:
      // mark everything stale; only what is on screen is read again.
      void client.invalidateQueries();
    },
  });
}

/** `GET /v1/mobile/config`: the web base URL, used to resolve a short link. */
export function useWebBaseUrl() {
  const { publicApi } = useCore();
  return useQuery({
    queryKey: shopKeys.config,
    staleTime: 60 * 60_000,
    queryFn: async () => (await unwrap(publicApi.GET('/v1/mobile/config'))).baseUrls.web,
  });
}
