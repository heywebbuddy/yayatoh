/**
 * Server state (M7.1c): TanStack Query with a cache that is persisted encrypted and cleared at
 * sign-out. Phones go offline all the time, so queries pause instead of failing, and an error that
 * retrying cannot fix (a 401, 403, 404, 426) is not retried.
 */
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { YayatohApiError } from '@yayatoh/sdk';
import type { EncryptedPersister } from './persister';

export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Retry network errors, timeouts, 408, 429 and 5xx, a few times; never a decision from the server. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof YayatohApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Must be at least the persister's maxAge, or restored data is collected at once.
        gcTime: CACHE_MAX_AGE_MS,
        staleTime: 30_000,
        networkMode: 'offlineFirst',
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      },
      mutations: { networkMode: 'online', retry: false },
    },
  });
}

/** Options for `PersistQueryClientProvider`. `buster` is the app version: a new build drops old data. */
export function persistOptions(persister: EncryptedPersister, buster: string) {
  return {
    persister,
    maxAge: CACHE_MAX_AGE_MS,
    buster,
    dehydrateOptions: {
      // Only successful queries, and only those that did not opt out with `meta: { persist: false }`.
      shouldDehydrateQuery: (query: { state: { status: string }; meta?: Record<string, unknown> }) =>
        query.state.status === 'success' && query.meta?.persist !== false,
    },
  };
}

/** Forgets everything fetched for the person: memory, the file and the key. */
export async function clearServerState(client: QueryClient, persister: EncryptedPersister): Promise<void> {
  await client.cancelQueries();
  client.clear();
  await persister.wipe();
}

/** Makes Query pause while the phone has no connection and resume when it is back. */
export function bindOnlineManager(
  subscribe: (listener: (online: boolean) => void) => () => void,
): () => void {
  onlineManager.setEventListener((setOnline) => subscribe(setOnline));
  return () => onlineManager.setEventListener(() => () => {});
}
