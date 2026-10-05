/**
 * Pure helpers of the Scan PWA's sync queue (M3.4a), unit-tested in `tests/scan-sync-queue.test.ts`.
 * The queue itself lives in IndexedDB (`store.ts`), keyed by `scanId`, so a scan is queued once
 * however often it is saved; the server applies each `scanId` once (idempotency key).
 */

/** Split into batches of at most `size` (the server takes ≤ 500 scans per request). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The queue with repeats of a scan id dropped (first kept), oldest first by device time. */
export function dedupeQueue<T extends { readonly scanId: string; readonly deviceTs: string }>(
  items: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of items) {
    if (seen.has(s.scanId)) continue;
    seen.add(s.scanId);
    out.push(s);
  }
  return out.sort((a, b) => a.deviceTs.localeCompare(b.deviceTs) || a.scanId.localeCompare(b.scanId));
}

/**
 * One run at a time: calls made while a run is in flight share its promise (the `online` event,
 * a scan and the 30 s tick can all ask for a flush at once; only one request goes out).
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (running) return running;
    running = fn().finally(() => {
      running = null;
    });
    return running;
  };
}

/** A supervisor's directive (ISO time) is new when the device hasn't applied that one yet. */
export function isNewDirective(
  requestedAt: string | null | undefined,
  applied: string | null | undefined,
): boolean {
  if (!requestedAt) return false;
  if (!applied) return true;
  return new Date(requestedAt).getTime() > new Date(applied).getTime();
}
